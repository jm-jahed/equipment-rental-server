import cron from "node-cron";
import { Booking } from "../models/Booking";
import { sendRentalCompletionNotifications } from "./email.service";

let isCronRegistered = false;

/**
 * Scan database for expired confirmed rentals and transition them to "Completed",
 * then dispatch completion email notifications to renter and machinery owner.
 * Safe and idempotent: ignores already completed, cancelled, or unpaid bookings.
 */
export const processExpiredRentals = async (): Promise<{
  scanned: number;
  completed: number;
  errors: number;
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
        await booking.save();
        completedCount++;

        // Dispatch completion email notifications
        const customer: any = booking.customerId;
        const owner: any = booking.ownerId;
        const equipment: any = booking.equipmentId;

        if (customer?.email && owner?.email) {
          sendRentalCompletionNotifications({
            bookingId: booking._id.toString(),
            equipmentName: equipment?.name || "Equipment Item",
            customerName: customer?.name || "Valued Customer",
            customerEmail: customer.email,
            ownerName: owner?.name || "Equipment Provider",
            ownerEmail: owner.email,
            startDate: booking.startDate,
            endDate: booking.endDate,
            totalAmount: booking.totalAmount,
          }).catch((mailErr) => {
            console.warn(`[CronService] Non-blocking email dispatch warning for #${booking._id}:`, mailErr.message);
          });
        }
      } catch (itemErr: any) {
        errorCount++;
        console.error(`[CronService] Error completing expired booking #${booking._id}:`, itemErr.message);
      }
    }

    if (completedCount > 0) {
      console.log(`[CronService] Successfully transitioned ${completedCount} expired rental(s) to 'Completed'.`);
    }

    return {
      scanned: expiredBookings.length,
      completed: completedCount,
      errors: errorCount,
    };
  } catch (error: any) {
    console.error("[CronService] Error processing expired rentals:", error.message);
    return { scanned: 0, completed: 0, errors: 1 };
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
