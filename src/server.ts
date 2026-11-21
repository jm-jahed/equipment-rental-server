import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { toNodeHandler } from "better-auth/node";
import { connectDB } from "./config/db";
import { auth } from "./config/auth";
import authRoutes from "./routes/auth.routes";
import uploadRoutes from "./routes/upload.routes";
import equipmentRoutes from "./routes/equipment.routes";
import favoriteRoutes from "./routes/favorite.routes";
import bookingRoutes, { handleStripeWebhook } from "./routes/booking.routes";
import userRoutes from "./routes/user.routes";
import analyticsRoutes from "./routes/analytics.routes";
import { initBookingCronJob, processExpiredRentals } from "./services/cron.service";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Middlewares: CORS
app.use(cors({
  origin: [CLIENT_URL, "http://localhost:3000", "https://equipment-rental-client-nine.vercel.app"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "stripe-signature"],
}));

// 1. Stripe Webhook Endpoint (Mounted with express.raw before express.json to preserve signature)
app.post(
  "/api/bookings/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

// 2. Global JSON Body Parser (10mb limit for image base64 uploads)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 3. Custom API Authentication Routes (Register, Login, Google, Me, Profile)
app.use("/api/auth", authRoutes);

// 4. BetterAuth Official Endpoints (JWKS, Social Callbacks, BetterAuth Client Plugins)
app.all("/api/auth/*splat", toNodeHandler(auth));

// 5. Secure Image Upload Route (ImgBB Server-Side API Proxy)
app.use("/api/upload", uploadRoutes);

// 6. Equipment Routes (CRUD, Search, Filter, Sort, Pagination, Featured)
app.use("/api/equipment", equipmentRoutes);

// 7. Customer Favorites Routes
app.use("/api/favorites", favoriteRoutes);

// 8. Rental Bookings & Stripe Payment Routes
app.use("/api/bookings", bookingRoutes);

// 9. Admin User Management Routes
app.use("/api/users", userRoutes);

// 10. Dynamic Analytics Routes (Admin & Owner Dashboards)
app.use("/api/analytics", analyticsRoutes);

// Root endpoint
app.get("/", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "Equipment Rental API is running",
    timestamp: new Date().toISOString()
  });
});

// Accurate health check endpoint reporting database status
app.get("/api/health", (req: Request, res: Response) => {
  const dbReadyState = mongoose.connection.readyState;
  const isDbConnected = dbReadyState === 1;

  const responseData = {
    status: isDbConnected ? "ok" : "degraded",
    database: {
      connected: isDbConnected,
      readyState: dbReadyState,
      stateDescription: getReadyStateDescription(dbReadyState)
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };

  if (!isDbConnected) {
    return res.status(503).json(responseData);
  }

  return res.status(200).json(responseData);
});

function getReadyStateDescription(state: number): string {
  switch (state) {
    case 0: return "disconnected";
    case 1: return "connected";
    case 2: return "connecting";
    case 3: return "disconnecting";
    default: return "unknown";
  }
}

// Start server
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await connectDB();
    // Run initial scan for expired rentals and start node-cron scheduler
    await processExpiredRentals();
    initBookingCronJob("0 * * * *");
  });
}

export default app;
