import bcrypt from "bcryptjs";
import { mongoClient, mongoDb } from "./mongoClient";

const dynamicImport = new Function("s", "return import(s)");

// Static trace hints for Vercel NFT (Node File Trace) to bundle ESM dependencies
if (false as boolean) {
  require("better-auth");
  require("@better-auth/mongo-adapter");
  require("better-auth/plugins");
  require("better-auth/node");
  require("jose");
}

const AUTH_URL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NODE_ENV === "production"
    ? "https://equipment-rental-server-delta.vercel.app"
    : "http://localhost:5000");

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

const hasGoogleAuth = !!(
  googleClientId &&
  googleClientSecret &&
  !googleClientId.includes("placeholder") &&
  !googleClientSecret.includes("placeholder")
);

let cachedAuth: any = null;

export async function getAuth() {
  if (cachedAuth) return cachedAuth;

  const [{ betterAuth }, { mongodbAdapter }, { jwt }] = await Promise.all([
    dynamicImport("better-auth"),
    dynamicImport("@better-auth/mongo-adapter"),
    dynamicImport("better-auth/plugins"),
  ]);

  cachedAuth = betterAuth({
    baseURL: AUTH_URL,
    database: mongodbAdapter(mongoDb, { client: mongoClient }),
    advanced: {
      database: {
        generateId: false, // Ensures MongoDB driver creates native BSON ObjectIds
      },
      cookiePrefix: "better-auth",
      crossSubDomainCookies: {
        enabled: false,
      },
      defaultCookieAttributes: {
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    user: {
      modelName: "users", // Target existing users collection
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "Customer",
          input: false, // Prevents privilege escalation during registration
          returned: true,
        },
        phone: {
          type: "string",
          required: false,
        },
        address: {
          type: "string",
          required: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      password: {
        hash: async (password: string) => {
          return await bcrypt.hash(password, 10);
        },
        verify: async ({ hash, password }: { hash: string; password: string }) => {
          return await bcrypt.compare(password, hash);
        },
      },
    },
    socialProviders: {
      ...(hasGoogleAuth
        ? {
            google: {
              clientId: googleClientId as string,
              clientSecret: googleClientSecret as string,
            },
          }
        : {}),
    },
    plugins: [
      jwt({
        jwt: {
          issuer: AUTH_URL,
          audience: AUTH_URL, // Express API Backend is the resource server
          expirationTime: "1h",
        },
        jwks: {
          keyPairConfig: {
            alg: "RS256",
          },
        },
      }),
    ],
    trustedOrigins: [
      "http://localhost:3000",
      "https://equipment-rental-client-nine.vercel.app",
    ],
  });

  return cachedAuth;
}
