import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "./config/db";
import { getAuth } from "./config/auth";
import authRoutes from "./routes/auth.routes";
import uploadRoutes from "./routes/upload.routes";
import equipmentRoutes from "./routes/equipment.routes";
import favoriteRoutes from "./routes/favorite.routes";
import bookingRoutes, { handleStripeWebhook } from "./routes/booking.routes";
import userRoutes from "./routes/user.routes";
import analyticsRoutes from "./routes/analytics.routes";
import cronRoutes from "./routes/cron.routes";
import { initBookingCronJob, processExpiredRentals } from "./services/cron.service";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

const allowedOrigins = [
  "http://localhost:3000",
  "https://equipment-rental-client-nine.vercel.app",
];
if (process.env.CLIENT_URL) {
  const cleanUrl = process.env.CLIENT_URL.replace(/\/$/, "");
  if (!allowedOrigins.includes(cleanUrl)) allowedOrigins.push(cleanUrl);
}

// Middlewares: Resilient CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/$/, "");
      if (
        allowedOrigins.includes(cleanOrigin) ||
        cleanOrigin.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "stripe-signature",
      "x-requested-with",
      "accept",
      "origin",
      "cookie",
      "x-better-auth-client",
      "better-auth-csrf-token",
    ],
    exposedHeaders: ["set-cookie"],
  })
);

// Vercel Serverless Route Normalization: normalize duplicate prefixes (/api/api/*)
app.use((req: Request, res: Response, next) => {
  if (req.url.startsWith("/api/api/")) {
    req.url = req.url.replace(/^\/api\/api\//, "/api/");
  }
  next();
});

// Database connection middleware (guarantees DB is active in Vercel Serverless before routing)
app.use(async (req: Request, res: Response, next) => {
  const isBypassRoute =
    req.path === "/" ||
    req.path === "/api" ||
    req.path === "/api/health" ||
    req.path === "/health";

  try {
    if (mongoose.connection.readyState !== 1) {
      const connected = await connectDB();
      if (!connected && !isBypassRoute) {
        return res.status(503).json({
          success: false,
          message: "Database service temporarily unavailable. Please retry shortly.",
        });
      }
    }
  } catch (err: any) {
    console.error("[Database] Serverless connection error:", err.message);
    if (!isBypassRoute) {
      return res.status(503).json({
        success: false,
        message: "Database service temporarily unavailable. Please retry shortly.",
      });
    }
  }

  if (!isBypassRoute && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      message: "Database service temporarily unavailable. Please retry shortly.",
    });
  }

  next();
});

// Defensive URL rewrite: normalize redundant /api/api/* prefixes to /api/*
app.use((req: Request, res: Response, next) => {
  if (req.url.startsWith("/api/api/")) {
    req.url = req.url.replace(/^\/api\/api\//, "/api/");
  }
  next();
});

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
// Use lazy dynamic import to prevent CommonJS ERR_REQUIRE_ESM crashes in serverless environments
let cachedBetterAuthHandler: any = null;
const dynamicImport = new Function("s", "return import(s)");

app.all("/api/auth/*splat", async (req: Request, res: Response, next) => {
  try {
    if (!cachedBetterAuthHandler) {
      const { toNodeHandler } = await dynamicImport("better-auth/node");
      const auth = await getAuth();
      cachedBetterAuthHandler = toNodeHandler(auth);
    }
    return cachedBetterAuthHandler(req, res);
  } catch (err: any) {
    console.error("[BetterAuth] Handler error:", err.message || err);
    next(err);
  }
});

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

// 11. Vercel Cron & Scheduled Jobs Endpoint
app.use("/api/cron", cronRoutes);

// Root and API status endpoints
app.get(["/", "/api"], (req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "Equipment Rental API is running",
    timestamp: new Date().toISOString()
  });
});

// Accurate health check endpoint reporting database status
app.get(["/api/health", "/health"], (req: Request, res: Response) => {
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

// Start server in non-test and non-serverless environments
if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await connectDB();
    // Run initial scan for expired rentals and start node-cron scheduler
    await processExpiredRentals();
    initBookingCronJob("0 * * * *");
  });
}

export default app;
