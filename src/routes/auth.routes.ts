import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User, IUser } from "../models/User";
import { verifyToken, AuthRequest } from "../middlewares/auth";

const router = Router();

// Helper to issue JWT access token
const generateToken = (user: IUser & { _id: any }) => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key";
  return jwt.sign(
    {
      id: user._id,
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

    // Create user (default role: Customer)
    const newUser = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "Customer",
      image: image || "",
    });

    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: "Registration successful! Welcome to RentEquip.",
      token,
      user: {
        id: newUser._id,
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

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful! Welcome back.",
      token,
      user: {
        id: user._id,
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
        id: user._id,
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
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
        phone: user.phone,
        address: user.address,
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

export default router;
