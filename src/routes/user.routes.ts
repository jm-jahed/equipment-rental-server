import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { User, UserRole } from "../models/User";
import { verifyToken, verifyAdmin, AuthRequest } from "../middlewares/auth";

const router = Router();

/**
 * GET /api/users
 * Admin-only: list all platform users with search, role filtering, and pagination.
 */
router.get("/", verifyToken, verifyAdmin, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    const role = req.query.role as string;
    const search = req.query.search as string;

    const filter: Record<string, any> = {};

    if (role && ["Customer", "Owner", "Admin"].includes(role)) {
      filter.role = role;
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: users.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: users,
    });
  } catch (error: any) {
    console.error("Admin fetch users error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch platform users.",
      error: error.message,
    });
  }
});

/**
 * PATCH /api/users/:id/role
 * Admin-only: change user role (Customer <-> Owner <-> Admin).
 */
router.patch("/:id/role", verifyToken, verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    if (!role || !["Customer", "Owner", "Admin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Role must be Customer, Owner, or Admin.",
      });
    }

    // Safety: prevent admin from accidentally demoting themselves if they are the only admin
    if (req.user?.id === id && role !== "Admin") {
      const adminCount = await User.countDocuments({ role: "Admin" });
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: "Cannot demote the only remaining administrator.",
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role: role as UserRole },
      { new: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.status(200).json({
      success: true,
      message: `User role successfully updated to ${role}.`,
      data: user,
    });
  } catch (error: any) {
    console.error("Admin update user role error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user role.",
      error: error.message,
    });
  }
});

/**
 * DELETE /api/users/:id
 * Admin-only: delete user with confirmation.
 */
router.delete("/:id", verifyToken, verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    // Safety: Admin cannot delete themselves
    if (req.user?.id === id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own administrator account.",
      });
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully.",
    });
  } catch (error: any) {
    console.error("Admin delete user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete user.",
      error: error.message,
    });
  }
});

export default router;
