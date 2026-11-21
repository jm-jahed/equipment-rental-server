import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import { mongoClient, mongoDb } from "./mongoClient";

const AUTH_URL = process.env.BETTER_AUTH_URL || "http://localhost:5000";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

const hasGoogleAuth = !!(
  googleClientId &&
  googleClientSecret &&
  !googleClientId.includes("placeholder") &&
  !googleClientSecret.includes("placeholder")
);

export const auth = betterAuth({
  baseURL: AUTH_URL,
  database: mongodbAdapter(mongoDb, { client: mongoClient }),
  advanced: {
    database: {
      generateId: false, // Ensures MongoDB driver creates native BSON ObjectIds
    },
  },
  user: {
    modelName: "users", // Target existing users collection
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "Customer",
        input: false, // Prevents privilege escalation during public registration
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
      verify: async ({ hash, password }) => {
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
