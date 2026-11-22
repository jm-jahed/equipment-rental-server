import mongoose, { Schema, Types } from "mongoose";

export type RentalType = "Daily" | "Weekly" | "Monthly";
export type EquipmentStatus = "Pending" | "Approved" | "Rejected";

export interface IEquipment {
  name: string;
  description: string;
  category: string;
  rentalPrice: number;
  rentalType: RentalType;
  location: string;
  availableQuantity: number;
  condition?: string;
  brand?: string;
  model?: string;
  image: string;
  rentalTerms?: string;
  currency?: string;
  status: EquipmentStatus;
  ownerId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const equipmentSchema = new Schema<IEquipment>(
  {
    name: {
      type: String,
      required: [true, "Equipment name is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
    },
    rentalPrice: {
      type: Number,
      required: [true, "Rental price is required"],
      min: [0, "Rental price cannot be negative"],
    },
    rentalType: {
      type: String,
      enum: ["Daily", "Weekly", "Monthly"],
      default: "Daily",
    },
    location: {
      type: String,
      required: [true, "Location is required"],
      trim: true,
    },
    availableQuantity: {
      type: Number,
      required: [true, "Available quantity is required"],
      min: [0, "Available quantity cannot be negative"],
      default: 1,
    },
    condition: {
      type: String,
      default: "Good",
    },
    brand: {
      type: String,
      default: "",
    },
    model: {
      type: String,
      default: "",
    },
    image: {
      type: String,
      required: [true, "Equipment image is required"],
    },
    rentalTerms: {
      type: String,
      default: "",
    },
    currency: {
      type: String,
      default: "BDT",
      trim: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner ID is required"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
equipmentSchema.index({ name: "text", category: "text", location: "text" });
equipmentSchema.index({ status: 1 });
equipmentSchema.index({ category: 1 });
equipmentSchema.index({ rentalType: 1 });
equipmentSchema.index({ rentalPrice: 1 });
equipmentSchema.index({ ownerId: 1 });
equipmentSchema.index({ createdAt: -1 });

export const Equipment = mongoose.model<IEquipment>("Equipment", equipmentSchema);
