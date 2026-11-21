import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "./config/db";
import authRoutes from "./routes/auth.routes";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Middlewares
app.use(cors({
  origin: [CLIENT_URL, "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());

// API Routes
app.use("/api/auth", authRoutes);

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
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await connectDB();
});

export default app;
