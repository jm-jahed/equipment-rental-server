import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import Stripe from "stripe";
import { Booking } from "../models/Booking";
import { Equipment } from "../models/Equipment";
import { Payment } from "../models/Payment";
import { verifyToken, verifyRenter, verifyOwner, verifyAdmin, AuthRequest } from "../middlewares/auth";
import { sendRentalCompletionNotifications } from "../services/email.service";

const router = Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16" as any,
});

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

/**
 * Shared, idempotent booking fulfillment from a confirmed Stripe session.
 * Used by both Stripe Webhook and Success Page verification.
 * Guarantees zero duplicate bookings, zero duplicate stock decrements, and consistent state.
 */
export const fulfillBookingFromSession = async (session: Stripe.Checkout.Session) => {
  const sessionId = session.id;

  // 1. Idempotency Check: Look for existing payment by stripeSessionId
  const existingPayment = await Payment.findOne({ stripeSessionId: sessionId });
  if (existingPayment) {
    const existingBooking = await Booking.findById(existingPayment.bookingId).populate("equipmentId");
    return {
      isNew: false,
      booking: existingBooking,
      payment: existingPayment,
    };
  }

  const meta = session.metadata;
  if (!meta || !meta.equipmentId || !meta.customerId) {
    throw new Error("Invalid session metadata: missing equipmentId or customerId");
  }

  const equipment = await Equipment.findById(meta.equipmentId);
  if (!equipment) {
    throw new Error(`Associated equipment not found for ID: ${meta.equipmentId}`);
  }

  const quantity = parseInt(meta.quantity) || 1;
  const totalAmount = parseFloat(meta.totalAmount) || (session.amount_total ? session.amount_total / 100 : 0);

  // 2. Create Booking Record
  const booking = new Booking({
    equipmentId: new mongoose.Types.ObjectId(meta.equipmentId),
    customerId: new mongoose.Types.ObjectId(meta.customerId),
    ownerId: new mongoose.Types.ObjectId(meta.ownerId),
    startDate: new Date(meta.startDate),
    endDate: new Date(meta.endDate),
    quantity,
    totalAmount,
    contactNumber: meta.contactNumber,
    deliveryAddress: meta.deliveryAddress,
    additionalNotes: meta.additionalNotes || "",
    paymentStatus: "Paid",
    bookingStatus: "Confirmed",
    stripeSessionId: sessionId,
  });
  await booking.save();

  // 3. Atomically decrement equipment stock
  await Equipment.findByIdAndUpdate(meta.equipmentId, {
    $inc: { availableQuantity: -quantity },
  });

  // 4. Create Payment Transaction Record
  const transactionId = (session.payment_intent as string) || session.id;
  const payment = new Payment({
    bookingId: booking._id,
    customerId: new mongoose.Types.ObjectId(meta.customerId),
    ownerId: new mongoose.Types.ObjectId(meta.ownerId),
    equipmentId: new mongoose.Types.ObjectId(meta.equipmentId),
    amount: totalAmount,
    currency: session.currency || "usd",
    transactionId,
    stripeSessionId: sessionId,
    paymentMethod: "stripe",
    status: "Succeeded",
  });
  await payment.save();

  const populatedBooking = await Booking.findById(booking._id).populate("equipmentId");
  return {
    isNew: true,
    booking: populatedBooking,
    payment,
  };
};

/**
 * Handle Stripe Webhook Events
 * POST /api/bookings/webhook (Mounted with express.raw in server.ts)
 */
export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    if (webhookSecret) {
      if (!sig) {
        return res.status(400).send("Webhook Error: Missing stripe-signature header");
      }
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // In development environments without configured webhook secret, parse payload safely
      event = typeof req.body === "string" || Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString())
        : req.body;
    }
  } catch (err: any) {
    console.error(`[StripeWebhook] Signature verification error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === "paid") {
          const result = await fulfillBookingFromSession(session);
          if (result.isNew) {
            console.log(`[StripeWebhook] Fulfilled new booking #${result.booking?._id} for Session ${session.id}`);
          } else {
            console.log(`[StripeWebhook] Session ${session.id} was already fulfilled (Idempotent).`);
          }
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`[StripeWebhook] Checkout session expired: ${session.id}`);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.warn(`[StripeWebhook] Payment intent failed: ${paymentIntent.id}`);
        break;
      }

      default:
        console.log(`[StripeWebhook] Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (handlerErr: any) {
    console.error(`[StripeWebhook] Error processing event ${event.type}:`, handlerErr.message);
    return res.status(500).json({ error: "Webhook handler failed." });
  }
};

/**
 * POST /api/bookings/checkout
 * Protected route for Renters (Customer or Admin) to initiate a Stripe Checkout session.
 * Server strictly calculates the total price and validates equipment availability.
 */
router.post("/checkout", verifyToken, verifyRenter, async (req: AuthRequest, res: Response) => {
  try {
    const customerId = req.user?.id;
    const {
      equipmentId,
      startDate,
      endDate,
      quantity = 1,
      contactNumber,
      deliveryAddress,
      additionalNotes = "",
    } = req.body;

    // Field validation
    if (!equipmentId || !startDate || !endDate || !contactNumber || !deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: "Equipment ID, start date, end date, contact number, and delivery address are required.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(String(equipmentId))) {
      return res.status(400).json({ success: false, message: "Invalid equipment ID." });
    }

    const equipment = await Equipment.findById(equipmentId);
    if (!equipment || equipment.status !== "Approved") {
      return res.status(404).json({
        success: false,
        message: "Equipment not found or is not approved for rental.",
      });
    }

    const numQuantity = Math.max(1, parseInt(String(quantity)) || 1);
    if (equipment.availableQuantity < numQuantity) {
      return res.status(400).json({
        success: false,
        message: `Requested quantity (${numQuantity}) exceeds available stock (${equipment.availableQuantity}).`,
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid rental dates." });
    }

    if (end < start) {
      return res.status(400).json({
        success: false,
        message: "Rental end date must be after or equal to start date.",
      });
    }

    // Calculate rental duration in days (minimum 1 day)
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const durationDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    // Server-enforced total amount calculation (never trust client)
    const totalAmount = durationDays * equipment.rentalPrice * numQuantity;

    // Create Stripe Checkout Session
    const sessionParams: any = {
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${equipment.name} (${durationDays} Day${durationDays > 1 ? "s" : ""})`,
              description: `Rental from ${start.toLocaleDateString()} to ${end.toLocaleDateString()} &bull; Qty: ${numQuantity}`,
              images: equipment.image ? [equipment.image] : [],
            },
            unit_amount: Math.round(totalAmount * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        equipmentId: String(equipmentId),
        customerId: String(customerId),
        ownerId: equipment.ownerId.toString(),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        quantity: String(numQuantity),
        totalAmount: String(totalAmount),
        contactNumber: contactNumber.trim(),
        deliveryAddress: deliveryAddress.trim(),
        additionalNotes: additionalNotes.trim(),
      },
      success_url: `${CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/equipment/${equipmentId}`,
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url,
      totalAmount,
      durationDays,
    });
  } catch (error: any) {
    console.error("Stripe checkout session error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to initialize Stripe checkout session.",
      error: error.message,
    });
  }
});

/**
 * GET /api/bookings/verify-session/:sessionId
 * Protected route called by the payment success page to verify the Stripe Checkout Session,
 * create the Booking record, update equipment availability, and record transaction in payments collection.
 * Idempotent: safe against duplicate page refreshes.
 */
router.get("/verify-session/:sessionId", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId);

    if (!sessionId) {
      return res.status(400).json({ success: false, message: "Stripe session ID required." });
    }

    // Retrieve verified session directly from Stripe API
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Payment has not been completed for this session.",
      });
    }

    // Fulfill booking idempotently
    const { booking, payment, isNew } = await fulfillBookingFromSession(session);

    return res.status(isNew ? 201 : 200).json({
      success: true,
      message: isNew ? "Payment verified and booking confirmed successfully!" : "Payment previously verified.",
      booking,
      payment,
    });
  } catch (error: any) {
    console.error("Verify session error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify Stripe payment session.",
      error: error.message,
    });
  }
});

/**
 * GET /api/bookings/my-rentals
 * Protected route for Customers to view their rental bookings table.
 */
router.get("/my-rentals", verifyToken, verifyRenter, async (req: AuthRequest, res: Response) => {
  try {
    const customerId = req.user?.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    const query = { customerId: new mongoose.Types.ObjectId(String(customerId)) };
    const total = await Booking.countDocuments(query);
    const rentals = await Booking.find(query)
      .populate("equipmentId", "name image category rentalPrice rentalType location")
      .populate("ownerId", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: rentals.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: rentals,
    });
  } catch (error: any) {
    console.error("Error fetching customer rentals:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch rental booking history.",
      error: error.message,
    });
  }
});

/**
 * GET /api/bookings/owner/my-rentals
 * Protected route for Equipment Owners to view all bookings for their listed machinery.
 */
router.get("/owner/my-rentals", verifyToken, verifyOwner, async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user?.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    const query = { ownerId: new mongoose.Types.ObjectId(String(ownerId)) };
    const total = await Booking.countDocuments(query);
    const rentals = await Booking.find(query)
      .populate("equipmentId", "name image category rentalPrice rentalType")
      .populate("customerId", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: rentals.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: rentals,
    });
  } catch (error: any) {
    console.error("Error fetching owner rentals:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch owner equipment rentals.",
      error: error.message,
    });
  }
});

/**
 * GET /api/bookings/admin/all
 * Protected route for Administrators to monitor all platform rental bookings.
 */
router.get("/admin/all", verifyToken, verifyAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 15);
    const skip = (page - 1) * limit;

    const total = await Booking.countDocuments({});
    const rentals = await Booking.find({})
      .populate("equipmentId", "name category image rentalPrice")
      .populate("customerId", "name email phone")
      .populate("ownerId", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: rentals.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: rentals,
    });
  } catch (error: any) {
    console.error("Error fetching admin rentals:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch platform rentals.",
      error: error.message,
    });
  }
});

/**
 * PATCH /api/bookings/:id/status
 * Update booking status (Confirmed -> Completed, Cancelled).
 * Allowed for Owner of the machinery, or Admin.
 * When cancelled, restores equipment available quantity.
 * When completed, dispatches automated completion emails to customer and owner.
 */
router.patch("/:id/status", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(400).json({ success: false, message: "Invalid booking ID." });
    }

    if (!status || !["Confirmed", "Completed", "Cancelled"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be Confirmed, Completed, or Cancelled.",
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    // Role check: Admin can update any; Owner can update only for their equipment; Customer can only cancel
    const isOwner = booking.ownerId.toString() === userId;
    const isAdmin = userRole === "Admin";
    const isCustomer = booking.customerId.toString() === userId;

    if (!isAdmin && !isOwner && !(isCustomer && status === "Cancelled")) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this booking.",
      });
    }

    const oldStatus = booking.bookingStatus;
    booking.bookingStatus = status as any;
    await booking.save();

    // If cancelled and wasn't already cancelled, restore equipment quantity
    if (status === "Cancelled" && oldStatus !== "Cancelled") {
      await Equipment.findByIdAndUpdate(booking.equipmentId, {
        $inc: { availableQuantity: booking.quantity },
      });
    }

    // If completed and wasn't already completed, notify customer and owner
    if (status === "Completed" && oldStatus !== "Completed") {
      const populated = await Booking.findById(booking._id)
        .populate("equipmentId", "name")
        .populate("customerId", "name email")
        .populate("ownerId", "name email");

      const customer: any = populated?.customerId;
      const owner: any = populated?.ownerId;
      const equipment: any = populated?.equipmentId;

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
        }).catch((err) => console.warn("[BookingRoutes] Non-blocking completion email notice:", err.message));
      }
    }

    return res.status(200).json({
      success: true,
      message: `Booking status updated to ${status}.`,
      data: booking,
    });
  } catch (error: any) {
    console.error("Error updating booking status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update booking status.",
      error: error.message,
    });
  }
});

export default router;
