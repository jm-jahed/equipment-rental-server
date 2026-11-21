import { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { User, UserRole } from "../models/User";

export interface AuthUserPayload {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}

export interface AuthRequest extends Request {
  user?: AuthUserPayload;
}

const AUTH_URL = process.env.BETTER_AUTH_URL || "http://localhost:5000";

// Remote JWKS set pointing to BetterAuth's official JWKS endpoint
const JWKS = createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));

/**
 * Middleware: verifyToken
 * Validates the JWT Bearer token using BetterAuth JWKS and loads fresh user role from MongoDB.
 */
export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No Bearer token provided.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Validate cryptographic signature, expiration, issuer, and audience
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: AUTH_URL,
      audience: AUTH_URL,
    });

    const userId = payload.sub;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload: missing subject claim.",
      });
    }

    // Load fresh user data directly from MongoDB Atlas to prevent stale role authorization
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account not found or has been deactivated.",
      });
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
    };

    next();
  } catch (error: any) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired JWT token.",
      error: error.message,
    });
  }
};

/**
 * Middleware: verifyRenter
 * Ensures the authenticated user has Customer (Renter) or Admin permissions.
 */
export const verifyRenter = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
  }

  if (req.user.role === "Customer" || req.user.role === "Admin") {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Forbidden. Customer (Renter) access required.",
  });
};

/**
 * Middleware: verifyOwner
 * Ensures the authenticated user has Equipment Owner or Admin permissions.
 */
export const verifyOwner = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
  }

  if (req.user.role === "Owner" || req.user.role === "Admin") {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Forbidden. Equipment Owner access required.",
  });
};

/**
 * Middleware: verifyAdmin
 * Strictly ensures the authenticated user has Admin permissions.
 */
export const verifyAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
  }

  if (req.user.role === "Admin") {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Forbidden. Administrator access required.",
  });
};
