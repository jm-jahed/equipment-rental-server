import mongoose, { Schema, Document, Types } from "mongoose";

export type NotificationJobStatus = "Pending" | "Processing" | "Sent" | "Failed";
export type NotificationRecipientType = "Customer" | "Owner";

export interface INotificationJob extends Document {
  bookingId: Types.ObjectId;
  recipientType: NotificationRecipientType;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  status: NotificationJobStatus;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date;
  lastError?: string;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationJobSchema = new Schema<INotificationJob>(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    recipientType: {
      type: String,
      enum: ["Customer", "Owner"],
      required: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
    },
    recipientName: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
    },
    html: {
      type: String,
      required: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Processing", "Sent", "Failed"],
      default: "Pending",
      index: true,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
    },
    nextRetryAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastError: {
      type: String,
      default: "",
    },
    lockedAt: {
      type: Date,
      default: null,
    },
    lockedBy: {
      type: String,
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient polling of pending/retryable jobs
notificationJobSchema.index({ status: 1, nextRetryAt: 1, retryCount: 1 });

export const NotificationJob = mongoose.model<INotificationJob>("NotificationJob", notificationJobSchema);
