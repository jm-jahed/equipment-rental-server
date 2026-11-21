import { Router, Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/User";
import { Equipment } from "../models/Equipment";
import { Booking } from "../models/Booking";
import { Payment } from "../models/Payment";
import { verifyToken, verifyOwner, verifyAdmin, AuthRequest } from "../middlewares/auth";

const router = Router();

/**
 * GET /api/analytics/admin
 * Admin-only: Dynamic statistics calculated using MongoDB aggregations.
 * Includes: total users, equipment, bookings, revenue, category breakdown, monthly stats.
 */
router.get("/admin", verifyToken, verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // 1. User metrics
    const [totalUsers, customerCount, ownerCount, adminCount] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: "Customer" }),
      User.countDocuments({ role: "Owner" }),
      User.countDocuments({ role: "Admin" }),
    ]);

    // 2. Equipment metrics
    const [totalEquipment, approvedEquipment, pendingEquipment, rejectedEquipment] = await Promise.all([
      Equipment.countDocuments({}),
      Equipment.countDocuments({ status: "Approved" }),
      Equipment.countDocuments({ status: "Pending" }),
      Equipment.countDocuments({ status: "Rejected" }),
    ]);

    // 3. Equipment category breakdown
    const categoryBreakdown = await Equipment.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $project: { category: "$_id", count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ]);

    // 4. Booking metrics
    const [totalBookings, confirmedBookings, completedBookings, cancelledBookings] = await Promise.all([
      Booking.countDocuments({}),
      Booking.countDocuments({ bookingStatus: "Confirmed" }),
      Booking.countDocuments({ bookingStatus: "Completed" }),
      Booking.countDocuments({ bookingStatus: "Cancelled" }),
    ]);

    // 5. Total revenue calculation from Paid bookings
    const revenueAgg = await Booking.aggregate([
      { $match: { paymentStatus: "Paid" } },
      { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" } } },
    ]);
    const totalRevenue = revenueAgg.length > 0 ? revenueAgg[0].totalRevenue : 0;

    // 6. Monthly statistics (last 6 months) for dynamic charts
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyStats = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo },
          paymentStatus: "Paid",
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          revenue: { $sum: "$totalAmount" },
          bookings: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ]);

    // Format monthly data for client chart rendering
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedMonthly = monthlyStats.map((item) => ({
      month: `${monthNames[item._id.month - 1]} ${item._id.year}`,
      revenue: Math.round(item.revenue),
      bookings: item.bookings,
    }));

    return res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          customers: customerCount,
          owners: ownerCount,
          admins: adminCount,
        },
        equipment: {
          total: totalEquipment,
          approved: approvedEquipment,
          pending: pendingEquipment,
          rejected: rejectedEquipment,
          categoryBreakdown,
        },
        bookings: {
          total: totalBookings,
          confirmed: confirmedBookings,
          completed: completedBookings,
          cancelled: cancelledBookings,
        },
        revenue: {
          total: totalRevenue,
        },
        monthlyStats: formattedMonthly,
      },
    });
  } catch (error: any) {
    console.error("Admin analytics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate admin platform analytics.",
      error: error.message,
    });
  }
});

/**
 * GET /api/analytics/owner
 * Owner-only: Dynamic statistics for the authenticated equipment owner.
 * Includes: total equipment, active rentals, completed rentals, total earnings, monthly breakdown.
 */
router.get("/owner", verifyToken, verifyOwner, async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.user?.id);

    // 1. Equipment counts
    const [totalEquipment, approvedEquipment, pendingEquipment] = await Promise.all([
      Equipment.countDocuments({ ownerId }),
      Equipment.countDocuments({ ownerId, status: "Approved" }),
      Equipment.countDocuments({ ownerId, status: "Pending" }),
    ]);

    // 2. Rental booking counts
    const [totalRentals, activeRentals, completedRentals] = await Promise.all([
      Booking.countDocuments({ ownerId }),
      Booking.countDocuments({ ownerId, bookingStatus: "Confirmed" }),
      Booking.countDocuments({ ownerId, bookingStatus: "Completed" }),
    ]);

    // 3. Total earnings from Paid bookings
    const earningsAgg = await Booking.aggregate([
      { $match: { ownerId, paymentStatus: "Paid" } },
      { $group: { _id: null, totalEarnings: { $sum: "$totalAmount" } } },
    ]);
    const totalEarnings = earningsAgg.length > 0 ? earningsAgg[0].totalEarnings : 0;

    // 4. Monthly earnings (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyStats = await Booking.aggregate([
      {
        $match: {
          ownerId,
          createdAt: { $gte: sixMonthsAgo },
          paymentStatus: "Paid",
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          earnings: { $sum: "$totalAmount" },
          rentals: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1 },
      },
    ]);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedMonthly = monthlyStats.map((item) => ({
      month: `${monthNames[item._id.month - 1]} ${item._id.year}`,
      earnings: Math.round(item.earnings),
      rentals: item.rentals,
    }));

    return res.status(200).json({
      success: true,
      data: {
        equipment: {
          total: totalEquipment,
          approved: approvedEquipment,
          pending: pendingEquipment,
        },
        rentals: {
          total: totalRentals,
          active: activeRentals,
          completed: completedRentals,
        },
        earnings: {
          total: totalEarnings,
        },
        monthlyStats: formattedMonthly,
      },
    });
  } catch (error: any) {
    console.error("Owner analytics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate owner analytics.",
      error: error.message,
    });
  }
});

export default router;
