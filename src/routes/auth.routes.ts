import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User, IUser } from "../models/User";
import { mongoDb } from "../config/mongoClient";
import { verifyToken, AuthRequest } from "../middlewares/auth";

const router = Router();

// Helper to issue JWT access token (HS256 fallback and compatibility)
const generateToken = (user: IUser & { _id: any }) => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key";
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
    },
    secret,
    { expiresIn: "7d" }
  );
};

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, image } = req.body;

    // Field validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    // Password validation per assignment specification:
    // Must have uppercase, lowercase, and minimum 6 characters.
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const isMinLength = password.length >= 6;

    if (!hasUpperCase || !hasLowerCase || !isMinLength) {
      return res.status(400).json({
        success: false,
        message: "Password must have at least one uppercase letter, one lowercase letter, and be at least 6 characters long.",
      });
    }

    // Check if user already exists
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this email already exists. Please log in.",
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user (strictly enforce default role: Customer)
    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "Customer",
      image: image || "",
    });

    // Idempotently create BetterAuth account record for full dual-compatibility
    try {
      await mongoDb.collection("account").insertOne({
        userId: newUser._id,
        accountId: newUser._id.toString(),
        providerId: "credential",
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (accountError) {
      console.warn("Notice: account record could not be pre-created, will be linked on first login:", accountError);
    }

    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: "Registration successful! Welcome to RentEquip.",
      token,
      user: {
        id: newUser._id.toString(),
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        image: newUser.image,
      },
    });
  } catch (error: any) {
    console.error("Register error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred during registration. Please try again.",
    });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please enter both email and password.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Verify password against legacy password or account record
    let isMatch = false;
    if (user.password) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      // Check BetterAuth account collection
      const accountDoc = await mongoDb.collection("account").findOne({
        userId: user._id,
        providerId: "credential",
      });
      if (accountDoc && accountDoc.password) {
        isMatch = await bcrypt.compare(password, accountDoc.password);
      }
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Ensure BetterAuth account document exists for existing user
    try {
      const existingAccount = await mongoDb.collection("account").findOne({
        userId: user._id,
        providerId: "credential",
      });
      if (!existingAccount && user.password) {
        await mongoDb.collection("account").insertOne({
          userId: user._id,
          accountId: user._id.toString(),
          providerId: "credential",
          password: user.password,
          createdAt: user.createdAt || new Date(),
          updatedAt: new Date(),
        });
      }
    } catch (syncErr) {
      console.warn("Notice: account synchronization warning:", syncErr);
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful! Welcome back.",
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred during login. Please try again.",
    });
  }
});

// POST /api/auth/google
router.post("/google", async (req: Request, res: Response) => {
  try {
    const { name, email, image } = req.body;

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        message: "Valid Google account details required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });

    // If new user via Google, register with Customer role by default
    if (!user) {
      user = await User.create({
        name,
        email: normalizedEmail,
        image: image || "",
        role: "Customer",
      });
    } else if (image && !user.image) {
      user.image = image;
      await user.save();
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Google login successful!",
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
    });
  } catch (error: any) {
    console.error("Google auth error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred during Google authentication.",
    });
  }
});

// GET /api/auth/session-token
// Bridges BetterAuth social/OAuth session cookies to application JWT token
router.get("/session-token", async (req: Request, res: Response) => {
  try {
    const rawCookies = req.headers.cookie || "";
    const match = rawCookies.match(/(?:better-auth\.|__Secure-better-auth\.)session_token=([^;]+)/);
    const sessionToken = match ? decodeURIComponent(match[1]) : null;

    if (!sessionToken) {
      return res.status(200).json({ success: false, authenticated: false, message: "No active session cookie found." });
    }

    const sessionDoc = await mongoDb.collection("session").findOne({
      token: sessionToken,
      expiresAt: { $gt: new Date() },
    });

    if (!sessionDoc || !sessionDoc.userId) {
      return res.status(401).json({ success: false, message: "Session expired or invalid." });
    }

    const user = mongoose.Types.ObjectId.isValid(sessionDoc.userId)
      ? await User.findById(sessionDoc.userId)
      : await User.findOne({ _id: sessionDoc.userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "Associated user not found." });
    }

    const token = generateToken(user);
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
    });
  } catch (err: any) {
    console.error("Session token bridge error:", err);
    return res.status(500).json({ success: false, message: "Failed to bridge session." });
  }
});

// GET /api/auth/me
router.get("/me", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user?.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
        phone: user.phone || "",
        address: user.address || "",
      },
    });
  } catch (error: any) {
    console.error("Get user error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user profile.",
    });
  }
});

// PATCH /api/auth/profile
router.patch("/profile", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { name, image, phone, address } = req.body;
    const user = await User.findById(req.user?.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found.",
      });
    }

    if (name) user.name = name.trim();
    if (image !== undefined) user.image = image;
    if (phone !== undefined) user.phone = phone.trim();
    if (address !== undefined) user.address = address.trim();

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
        phone: user.phone || "",
        address: user.address || "",
      },
    });
  } catch (error: any) {
    console.error("Profile update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update profile.",
    });
  }
});

export default router;
