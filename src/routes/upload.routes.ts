import { Router, Request, Response } from "express";

const router = Router();

/**
 * POST /api/upload/image
 * Securely uploads an image to ImgBB using the server-side API key.
 * Accepts either:
 * 1. Base64 encoded string: { image: "data:image/jpeg;base64,..." or raw base64 }
 * 2. Remote image URL: { image: "https://..." }
 */
router.post("/image", async (req: Request, res: Response) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        message: "Image payload is required (base64 string or image URL).",
      });
    }

    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error: IMGBB_API_KEY is not defined.",
      });
    }

    // Strip base64 data URI header if present
    const cleanImage = image.replace(/^data:image\/\w+;base64,/, "");

    const formData = new URLSearchParams();
    formData.append("image", cleanImage);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return res.status(response.status || 400).json({
        success: false,
        message: data.error?.message || "Failed to upload image to ImgBB.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully.",
      url: data.data.url,
      display_url: data.data.display_url,
      thumb_url: data.data.thumb?.url || data.data.url,
      delete_url: data.data.delete_url,
    });
  } catch (error: any) {
    console.error("ImgBB upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while processing image upload.",
      error: error.message,
    });
  }
});

export default router;
