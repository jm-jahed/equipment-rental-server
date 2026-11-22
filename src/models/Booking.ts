import mongoose, { Schema, Types } from "mongoose";

export type PaymentStatus = "Pending" | "Paid" | "Failed" | "Refunded";
export type BookingStatus = "Pending" | "Confirmed" | "Completed" | "Cancelled";

export interface IBooking {
  equipmentId: Types.ObjectId;
  customerId: Types.ObjectId;
  ownerId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
  quantity: number;
  totalAmount: number;
  currency?: string;
  contactNumber: string;
  deliveryAddress: string;
  additionalNotes?: string;
  paymentStatus: PaymentStatus;
  bookingStatus: BookingStatus;
  stripeSessionId?: string;
  notificationsEnqueued?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const bookingSchema = new Schema<IBooking>(
  {
    equipmentId: {
      type: Schema.Types.ObjectId,
      ref: "Equipment",
      required: [true, "Equipment ID is required"],
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Customer ID is required"],
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner ID is required"],
    },
    startDate: {
      type: Date,
      required: [true, "Rental start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "Rental end date is required"],
    },
    quantity: {
      type: Number,
      required: [true, "Required quantity is required"],
      min: [1, "Quantity must be at least 1"],
      default: 1,
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
    },
    currency: {
      type: String,
      default: "BDT",
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, "Contact number is required"],
      trim: true,
    },
    deliveryAddress: {
      type: String,
      required: [true, "Delivery address is required"],
      trim: true,
    },
    additionalNotes: {
      type: String,
      default: "",
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed", "Refunded"],
      default: "Pending",
    },
    bookingStatus: {
      type: String,
      enum: ["Pending", "Confirmed", "Completed", "Cancelled"],
      default: "Pending",
    },
    stripeSessionId: {
      type: String,
      default: "",
    },
    notificationsEnqueued: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ ownerId: 1, createdAt: -1 });
bookingSchema.index({ equipmentId: 1 });
bookingSchema.index({ bookingStatus: 1 });
bookingSchema.index({ paymentStatus: 1 });
bookingSchema.index({ stripeSessionId: 1 });
bookingSchema.index({ bookingStatus: 1, paymentStatus: 1, notificationsEnqueued: 1 });

export const Booking = mongoose.model<IBooking>("Booking", bookingSchema);
