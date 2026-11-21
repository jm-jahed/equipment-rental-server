import { Router, Response } from "express";
import mongoose from "mongoose";
import { Favorite } from "../models/Favorite";
import { Equipment } from "../models/Equipment";
import { verifyToken, AuthRequest } from "../middlewares/auth";

const router = Router();

/**
 * GET /api/favorites
 * Protected route to retrieve all favorite equipment items of the authenticated customer.
 */
router.get("/", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    const favorites = await Favorite.find({
      userId: new mongoose.Types.ObjectId(String(userId)),
    })
      .populate({
        path: "equipmentId",
        populate: { path: "ownerId", select: "name image" },
      })
      .sort({ createdAt: -1 });

    // Filter out any favorites where the equipment might have been deleted
    const validFavorites = favorites.filter((f) => f.equipmentId !== null);

    return res.status(200).json({
      success: true,
      count: validFavorites.length,
      data: validFavorites,
    });
  } catch (error: any) {
    console.error("Error fetching favorites:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve favorites list.",
      error: error.message,
    });
  }
});

/**
 * GET /api/favorites/check/:equipmentId
 * Check if a specific equipment item is already favorited by the authenticated user.
 */
router.get("/check/:equipmentId", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { equipmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(equipmentId))) {
      return res.status(400).json({ success: false, message: "Invalid equipment ID." });
    }

    const exists = await Favorite.findOne({
      userId: new mongoose.Types.ObjectId(String(userId)),
      equipmentId: new mongoose.Types.ObjectId(String(equipmentId)),
    });

    return res.status(200).json({
      success: true,
      isFavorite: !!exists,
    });
  } catch (error: any) {
    console.error("Error checking favorite status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check favorite status.",
      error: error.message,
    });
  }
});

/**
 * POST /api/favorites/:equipmentId
 * Add equipment to favorites. Idempotent check ensures no duplicate keys.
 */
router.post("/:equipmentId", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { equipmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(equipmentId))) {
      return res.status(400).json({ success: false, message: "Invalid equipment ID." });
    }

    const equipment = await Equipment.findById(equipmentId);
    if (!equipment) {
      return res.status(404).json({ success: false, message: "Equipment not found." });
    }

    // Check if already favorited
    let favorite = await Favorite.findOne({
      userId: new mongoose.Types.ObjectId(String(userId)),
      equipmentId: new mongoose.Types.ObjectId(String(equipmentId)),
    });

    if (!favorite) {
      favorite = await Favorite.create({
        userId: new mongoose.Types.ObjectId(String(userId)),
        equipmentId: new mongoose.Types.ObjectId(String(equipmentId)),
      });
    }

    return res.status(201).json({
      success: true,
      message: "Equipment added to favorites successfully.",
      data: favorite,
    });
  } catch (error: any) {
    console.error("Error adding favorite:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add equipment to favorites.",
      error: error.message,
    });
  }
});

/**
 * DELETE /api/favorites/:equipmentId
 * Remove equipment from user's favorites list.
 */
router.delete("/:equipmentId", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { equipmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(equipmentId))) {
      return res.status(400).json({ success: false, message: "Invalid equipment ID." });
    }

    await Favorite.findOneAndDelete({
      userId: new mongoose.Types.ObjectId(String(userId)),
      equipmentId: new mongoose.Types.ObjectId(String(equipmentId)),
    });

    return res.status(200).json({
      success: true,
      message: "Equipment removed from favorites successfully.",
    });
  } catch (error: any) {
    console.error("Error removing favorite:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove equipment from favorites.",
      error: error.message,
    });
  }
});

export default router;
