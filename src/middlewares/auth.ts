import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User, UserRole } from "../models/User";

const dynamicImport = new Function("s", "return import(s)");
let cachedJose: any = null;
const getJose = async () => {
  if (!cachedJose) {
    cachedJose = await dynamicImport("jose");
  }
  return cachedJose;
};

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
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key";

// Remote JWKS set pointing to BetterAuth's official JWKS endpoint
let jwksInstance: any = null;
const getJWKS = async () => {
  if (!jwksInstance) {
    const { createRemoteJWKSet } = await getJose();
    jwksInstance = createRemoteJWKSet(new URL(`${AUTH_URL}/api/auth/jwks`));
  }
  return jwksInstance;
};

/**
 * Middleware: verifyToken
 * Validates the JWT Bearer token using BetterAuth JWKS (RS256) or JWT_SECRET (HS256)
 * and loads fresh user role from MongoDB to prevent stale role authorization.
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
  let userId: string | undefined;

  // 1. Try RS256 JWKS verification (BetterAuth standard)
  try {
    const { jwtVerify } = await getJose();
    const jwks = await getJWKS();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: AUTH_URL,
      audience: AUTH_URL,
    });
    userId = payload.sub || (payload.id as string);
  } catch (jwksError) {
    // 2. Fallback to HS256 verification (symmetric secret)
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      userId = decoded.id || decoded.sub;
    } catch (hsError) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired JWT token.",
      });
    }
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Invalid token payload: missing subject identifier.",
    });
  }

  try {
    // Load fresh user data directly from MongoDB Atlas to enforce real-time RBAC
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
  } catch (dbError: any) {
    return res.status(500).json({
      success: false,
      message: "Database error during authentication verification.",
      error: dbError.message,
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
