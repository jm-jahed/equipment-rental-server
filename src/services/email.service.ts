import nodemailer, { Transporter } from "nodemailer";
import mongoose from "mongoose";
import { NotificationJob, INotificationJob } from "../models/NotificationJob";

export interface RentalCompletionNotificationData {
  bookingId: string;
  equipmentName: string;
  customerName: string;
  customerEmail: string;
  ownerName: string;
  ownerEmail: string;
  startDate: Date | string;
  endDate: Date | string;
  totalAmount: number;
}

let customTransport: Transporter | null = null;

/**
 * Mask email address for privacy and security in logs (e.g. j***d@example.com)
 */
export const maskEmail = (email: string): string => {
  if (!email || !email.includes("@")) return "***";
  const [user, domain] = email.split("@");
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
};

/**
 * Allow test suites to inject a mock transporter
 */
export const setCustomMailTransport = (transporter: Transporter | null) => {
  customTransport = transporter;
};

/**
 * Get active nodemailer transporter based on server environment variables
 */
const getTransporter = (): Transporter => {
  if (customTransport) {
    return customTransport;
  }

  const host = process.env.SMTP_HOST || "smtp.mailtrap.io";
  const port = parseInt(process.env.SMTP_PORT || "2525", 10);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
};

/**
 * Enqueue persistent Outbox Notification Jobs for a completed rental.
 * Guarantees duplicate-safe creation via MongoDB unique idempotency keys.
 */
export const enqueueRentalCompletionJobs = async (
  data: RentalCompletionNotificationData,
  session?: mongoose.ClientSession
): Promise<{ customerJobId: string; ownerJobId: string }> => {
  const fromAddress = process.env.SMTP_FROM || '"RentEquip Notifications" <no-reply@rentequip.com>';
  const formattedStart = new Date(data.startDate).toLocaleDateString();
  const formattedEnd = new Date(data.endDate).toLocaleDateString();

  // 1. Customer Notification Content
  const customerSubject = `Rental Completed: ${data.equipmentName} (#${data.bookingId.slice(-6)})`;
  const customerHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
      <h2 style="color: #d97706; margin-top: 0;">Rental Completed Successfully</h2>
      <p>Hello <strong>${data.customerName}</strong>,</p>
      <p>Your rental of <strong>${data.equipmentName}</strong> has been officially marked as <strong>Completed</strong>.</p>
      <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 4px 0;"><strong>Booking Reference:</strong> #${data.bookingId}</p>
        <p style="margin: 4px 0;"><strong>Rental Period:</strong> ${formattedStart} &ndash; ${formattedEnd}</p>
        <p style="margin: 4px 0;"><strong>Total Amount Paid:</strong> $${data.totalAmount.toLocaleString()} USD</p>
        <p style="margin: 4px 0;"><strong>Equipment Provider:</strong> ${data.ownerName}</p>
      </div>
      <p>Thank you for choosing RentEquip for your equipment needs. We look forward to powering your next job!</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #64748b;">RentEquip Platform &bull; Automated System Notification</p>
    </div>
  `;

  // 2. Owner Notification Content
  const ownerSubject = `Machinery Returned: ${data.equipmentName} Rental Completed`;
  const ownerHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
      <h2 style="color: #059669; margin-top: 0;">Machinery Rental Completed</h2>
      <p>Hello <strong>${data.ownerName}</strong>,</p>
      <p>The rental period for your machinery <strong>${data.equipmentName}</strong> has ended and the order is now <strong>Completed</strong>.</p>
      <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 4px 0;"><strong>Booking Reference:</strong> #${data.bookingId}</p>
        <p style="margin: 4px 0;"><strong>Renter Name:</strong> ${data.customerName}</p>
        <p style="margin: 4px 0;"><strong>Rental Period:</strong> ${formattedStart} &ndash; ${formattedEnd}</p>
        <p style="margin: 4px 0;"><strong>Net Revenue:</strong> $${data.totalAmount.toLocaleString()} USD</p>
      </div>
      <p>Your equipment has been returned to your inventory and is available for subsequent client reservations.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 12px; color: #64748b;">RentEquip Owner Fleet Services</p>
    </div>
  `;

  const customerKey = `${data.bookingId}_Customer_completion`;
  const ownerKey = `${data.bookingId}_Owner_completion`;

  // Upsert Customer Job (Idempotent)
  const custRes = await NotificationJob.findOneAndUpdate(
    { idempotencyKey: customerKey },
    {
      $setOnInsert: {
        bookingId: new mongoose.Types.ObjectId(data.bookingId),
        recipientType: "Customer",
        recipientEmail: data.customerEmail,
        recipientName: data.customerName,
        subject: customerSubject,
        html: customerHtml,
        idempotencyKey: customerKey,
        status: "Pending",
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: new Date(),
      },
    },
    { upsert: true, new: true, session }
  );

  // Upsert Owner Job (Idempotent)
  const ownerRes = await NotificationJob.findOneAndUpdate(
    { idempotencyKey: ownerKey },
    {
      $setOnInsert: {
        bookingId: new mongoose.Types.ObjectId(data.bookingId),
        recipientType: "Owner",
        recipientEmail: data.ownerEmail,
        recipientName: data.ownerName,
        subject: ownerSubject,
        html: ownerHtml,
        idempotencyKey: ownerKey,
        status: "Pending",
        retryCount: 0,
        maxRetries: 3,
        nextRetryAt: new Date(),
      },
    },
    { upsert: true, new: true, session }
  );

  return {
    customerJobId: custRes._id.toString(),
    ownerJobId: ownerRes._id.toString(),
  };
};

/**
 * Process pending and retryable notification jobs from the MongoDB Outbox.
 * Concurrency-safe: atomically locks jobs using findOneAndUpdate to prevent duplicate dispatch across concurrent Cron instances.
 */
export const processPendingNotificationJobs = async (
  workerId = `worker_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  batchLimit = 10
): Promise<{ processed: number; sent: number; failed: number; retried: number }> => {
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let retried = 0;

  const transporter = getTransporter();
  const fromAddress = process.env.SMTP_FROM || '"RentEquip Notifications" <no-reply@rentequip.com>';
  const lockTimeout = new Date(Date.now() - 5 * 60 * 1000); // 5 min lock expiration

  for (let i = 0; i < batchLimit; i++) {
    // Atomically find and lock a single pending/retryable job
    const job = await NotificationJob.findOneAndUpdate(
      {
        status: { $in: ["Pending", "Failed"] },
        retryCount: { $lt: 3 },
        nextRetryAt: { $lte: new Date() },
        $or: [
          { lockedAt: null },
          { lockedAt: { $lt: lockTimeout } },
        ],
      },
      {
        $set: {
          status: "Processing",
          lockedAt: new Date(),
          lockedBy: workerId,
        },
      },
      { new: true }
    );

    if (!job) {
      break; // No more eligible jobs in queue
    }

    processed++;

    try {
      // If no SMTP credentials and no custom transport, simulate delivery
      if (!process.env.SMTP_USER && !customTransport) {
        console.log(
          `[EmailService] Simulated delivery to ${maskEmail(job.recipientEmail)} (${job.recipientType}) for Booking #${job.bookingId}`
        );
        job.status = "Sent";
        job.sentAt = new Date();
        job.lockedAt = null;
        job.lockedBy = null;
        await job.save();
        sent++;
        continue;
      }

      await transporter.sendMail({
        from: fromAddress,
        to: job.recipientEmail,
        subject: job.subject,
        html: job.html,
      });

      console.log(
        `[EmailService] Delivered ${job.recipientType} email to ${maskEmail(job.recipientEmail)} (Job #${job._id})`
      );

      job.status = "Sent";
      job.sentAt = new Date();
      job.lockedAt = null;
      job.lockedBy = null;
      await job.save();
      sent++;
    } catch (err: any) {
      const nextRetryCount = job.retryCount + 1;
      const isPermanentlyFailed = nextRetryCount >= job.maxRetries;
      const backoffMs = nextRetryCount * 60 * 1000; // Linear backoff: 1 min, 2 min, etc.

      console.warn(
        `[EmailService] Dispatch attempt ${nextRetryCount}/${job.maxRetries} failed for ${maskEmail(job.recipientEmail)}: ${err.message}`
      );

      job.retryCount = nextRetryCount;
      job.lastError = err.message;
      job.lockedAt = null;
      job.lockedBy = null;

      if (isPermanentlyFailed) {
        job.status = "Failed";
        failed++;
      } else {
        job.status = "Pending";
        job.nextRetryAt = new Date(Date.now() + backoffMs);
        retried++;
      }

      await job.save();
    }
  }

  return { processed, sent, failed, retried };
};

/**
 * Backward-compatible helper: enqueues completion notifications and triggers outbox processing.
 */
export const sendRentalCompletionNotifications = async (
  data: RentalCompletionNotificationData
): Promise<{ success: boolean; customerNotified: boolean; ownerNotified: boolean; error?: string }> => {
  try {
    await enqueueRentalCompletionJobs(data);
    const result = await processPendingNotificationJobs();
    return {
      success: result.sent > 0 || result.retried > 0,
      customerNotified: result.sent > 0,
      ownerNotified: result.sent > 0,
    };
  } catch (error: any) {
    console.error("[EmailService] Error in completion notifications handler:", error.message);
    return {
      success: false,
      customerNotified: false,
      ownerNotified: false,
      error: error.message,
    };
  }
};
