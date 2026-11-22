import mongoose, { Schema, Types } from "mongoose";

export type PaymentGatewayStatus = "Pending" | "Succeeded" | "Failed";

export interface IPayment {
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  ownerId: Types.ObjectId;
  equipmentId: Types.ObjectId;
  amount: number;
  currency: string;
  transactionId: string;
  stripeSessionId?: string;
  paymentMethod: string;
  status: PaymentGatewayStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: [true, "Booking ID is required"],
      unique: true,
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
    equipmentId: {
      type: Schema.Types.ObjectId,
      ref: "Equipment",
      required: [true, "Equipment ID is required"],
    },
    amount: {
      type: Number,
      required: [true, "Payment amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    currency: {
      type: String,
      default: "BDT",
      uppercase: true,
      trim: true,
    },
    transactionId: {
      type: String,
      required: [true, "Transaction ID is required"],
      unique: true,
    },
    stripeSessionId: {
      type: String,
      default: "",
    },
    paymentMethod: {
      type: String,
      default: "stripe",
    },
    status: {
      type: String,
      enum: ["Pending", "Succeeded", "Failed"],
      default: "Pending",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
paymentSchema.index({ customerId: 1 });
paymentSchema.index({ ownerId: 1 });
paymentSchema.index({ stripeSessionId: 1 });

export const Payment = mongoose.model<IPayment>("Payment", paymentSchema);
