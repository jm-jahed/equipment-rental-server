import cron from "node-cron";
import { Booking } from "../models/Booking";
import { NotificationJob } from "../models/NotificationJob";
import {
  enqueueRentalCompletionJobs,
  processPendingNotificationJobs,
} from "./email.service";

let isCronRegistered = false;

/**
 * Scan database for expired confirmed rentals and transition them to "Completed",
 * then dispatch completion email notifications to renter and machinery owner.
 * Safe and idempotent: ignores already completed, cancelled, or unpaid bookings.
 */
export const processExpiredRentals = async (): Promise<{
  scanned: number;
  completed: number;
  recovered?: number;
  errors: number;
  outbox?: any;
}> => {
  try {
    const now = new Date();
    // Only target bookings that are:
    // 1. past their rental end date
    // 2. currently Confirmed
    // 3. Paid
    const expiredBookings = await Booking.find({
      endDate: { $lt: now },
      bookingStatus: "Confirmed",
      paymentStatus: "Paid",
    })
      .populate("equipmentId", "name")
      .populate("customerId", "name email")
      .populate("ownerId", "name email");

    let completedCount = 0;
    let errorCount = 0;

    for (const booking of expiredBookings) {
      try {
        booking.bookingStatus = "Completed";

        // Enqueue transactional outbox notification jobs (persisted in MongoDB)
        const customer: any = booking.customerId;
        const owner: any = booking.ownerId;
        const equipment: any = booking.equipmentId;

        if (customer?.email && owner?.email) {
          await enqueueRentalCompletionJobs({
            bookingId: booking._id.toString(),
            equipmentName: equipment?.name || "Equipment Item",
            customerName: customer?.name || "Valued Customer",
            customerEmail: customer.email,
            ownerName: owner?.name || "Equipment Provider",
            ownerEmail: owner.email,
            startDate: booking.startDate,
            endDate: booking.endDate,
            totalAmount: booking.totalAmount,
          });
          booking.notificationsEnqueued = true;
        }
        await booking.save();
        completedCount++;
      } catch (itemErr: any) {
        errorCount++;
        console.error(`[CronService] Error completing expired booking #${booking._id}:`, itemErr.message);
      }
    }

    if (completedCount > 0) {
      console.log(`[CronService] Successfully transitioned ${completedCount} expired rental(s) to 'Completed'.`);
    }

    // Recover any orphaned notification jobs where process terminated before enqueue
    const recovered = await recoverMissingNotificationJobs();

    // Process all pending and retryable jobs in the Outbox
    const outboxResult = await processPendingNotificationJobs();

    return {
      scanned: expiredBookings.length,
      completed: completedCount,
      recovered,
      errors: errorCount,
      outbox: outboxResult,
    };
  } catch (error: any) {
    console.error("[CronService] Error processing expired rentals:", error.message);
    return { scanned: 0, completed: 0, recovered: 0, errors: 1 };
  }
};

/**
 * Scans for completed bookings that are missing outbox notification jobs
 * (e.g., due to an unexpected process termination, crash, or network failure during completion).
 * Queries records with notificationsEnqueued !== true.
 * Safely enqueues missing Customer and Owner jobs using deterministic idempotency keys,
 * then atomically marks notificationsEnqueued = true only after both jobs exist.
 */
export const recoverMissingNotificationJobs = async (batchLimit = 50): Promise<number> => {
  try {
    const unenqueuedBookings = await Booking.find({
      bookingStatus: "Completed",
      paymentStatus: "Paid",
      notificationsEnqueued: { $ne: true },
    })
      .limit(batchLimit)
      .populate("equipmentId", "name")
      .populate("customerId", "name email")
      .populate("ownerId", "name email");

    let recovered = 0;
    for (const booking of unenqueuedBookings) {
      const customer: any = booking.customerId;
      const owner: any = booking.ownerId;
      const equipment: any = booking.equipmentId;

      if (!customer?.email || !owner?.email) {
        // If booking lacks valid recipient emails, acknowledge to avoid infinite retry loops
        await Booking.updateOne({ _id: booking._id }, { $set: { notificationsEnqueued: true } });
        continue;
      }

      const customerKey = `${booking._id}_Customer_completion`;
      const ownerKey = `${booking._id}_Owner_completion`;

      // 1. Independently check existing notification jobs
      const [hasCustomerJob, hasOwnerJob] = await Promise.all([
        NotificationJob.exists({ idempotencyKey: customerKey }),
        NotificationJob.exists({ idempotencyKey: ownerKey }),
      ]);

      let enqueueSuccess = true;

      // 2. Enqueue missing jobs if either is absent
      if (!hasCustomerJob || !hasOwnerJob) {
        try {
          await enqueueRentalCompletionJobs({
            bookingId: booking._id.toString(),
            equipmentName: equipment?.name || "Equipment Item",
            customerName: customer?.name || "Valued Customer",
            customerEmail: customer.email,
            ownerName: owner?.name || "Equipment Provider",
            ownerEmail: owner.email,
            startDate: booking.startDate,
            endDate: booking.endDate,
            totalAmount: booking.totalAmount,
          });
          recovered++;
        } catch (enqueueErr: any) {
          enqueueSuccess = false;
          console.error(`[CronService] Failed to enqueue missing jobs for booking #${booking._id}:`, enqueueErr.message);
        }
      }

      // 3. Atomically acknowledge booking only after verifying persistence
      if (enqueueSuccess) {
        const [verifiedCust, verifiedOwner] = await Promise.all([
          NotificationJob.exists({ idempotencyKey: customerKey }),
          NotificationJob.exists({ idempotencyKey: ownerKey }),
        ]);

        if (verifiedCust && verifiedOwner) {
          await Booking.updateOne(
            { _id: booking._id },
            { $set: { notificationsEnqueued: true } }
          );
        }
      }
    }

    if (recovered > 0) {
      console.log(`[CronService] Reconciled and recovered ${recovered} missing notification job(s).`);
    }
    return recovered;
  } catch (err: any) {
    console.error("[CronService] Reconciliation recovery error:", err.message);
    return 0;
  }
};

/**
 * Initialize node-cron scheduled job.
 * Expression: "0 * * * *" runs at minute 0 of every hour.
 * Ensures singleton registration to avoid duplicate schedulers.
 */
export const initBookingCronJob = (cronExpression = "0 * * * *"): boolean => {
  if (isCronRegistered) {
    console.log("[CronService] Cron job already active; skipping duplicate registration.");
    return false;
  }

  if (process.env.NODE_ENV === "test") {
    console.log("[CronService] Test environment detected; scheduler not auto-started.");
    return false;
  }

  isCronRegistered = true;
  console.log(`[CronService] Initializing node-cron scheduler with expression: '${cronExpression}'`);

  cron.schedule(cronExpression, async () => {
    console.log(`[CronService] Triggered scheduled check for expired rentals at ${new Date().toISOString()}`);
    await processExpiredRentals();
  });

  return true;
};
