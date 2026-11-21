import mongoose, { Schema, Types } from "mongoose";

export interface IFavorite {
  userId: Types.ObjectId;
  equipmentId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const favoriteSchema = new Schema<IFavorite>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    equipmentId: {
      type: Schema.Types.ObjectId,
      ref: "Equipment",
      required: [true, "Equipment ID is required"],
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index to strictly prevent duplicate favorites
favoriteSchema.index({ userId: 1, equipmentId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, createdAt: -1 });

export const Favorite = mongoose.model<IFavorite>("Favorite", favoriteSchema);
