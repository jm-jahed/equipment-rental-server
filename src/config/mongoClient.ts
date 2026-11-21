import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables.");
}

// Reusable singleton client for serverless environments (e.g. Vercel) and hot reloads
declare global {
  var _mongoClientInstance: MongoClient | undefined;
}

if (!global._mongoClientInstance) {
  global._mongoClientInstance = new MongoClient(uri);
}

export const mongoClient: MongoClient = global._mongoClientInstance;
export const mongoDb = mongoClient.db("equipment_rental");
