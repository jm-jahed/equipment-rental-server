import { Router, Request, Response } from "express";
import { processExpiredRentals } from "../services/cron.service";

const router = Router();

/**
 * GET /api/cron/process-expired-rentals
 * Protected endpoint for Vercel Cron or external schedulers.
 * Protected via Authorization: Bearer <CRON_SECRET> header.
 */
router.get("/process-expired-rentals", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // Enforce CRON_SECRET authorization when configured
    if (cronSecret) {
      if (authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: Invalid or missing CRON_SECRET bearer token.",
        });
      }
    } else if (process.env.NODE_ENV === "production") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: CRON_SECRET must be configured in production environment.",
      });
    }

    const result = await processExpiredRentals();
    return res.status(200).json({
      success: true,
      message: "Expired rentals scanned and processed.",
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (error: any) {
    console.error("[CronRoute] Error processing scheduled rentals:", error.message);
    return res.status(500).json({
      success: false,
      message: "Cron execution failed.",
      error: error.message,
    });
  }
});

export default router;
