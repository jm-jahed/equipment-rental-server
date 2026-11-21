import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();

// Ensure Node.js c-ares DNS resolver can look up MongoDB Atlas SRV records on Windows
const currentDns = dns.getServers();
if (!currentDns || currentDns.length === 0 || (currentDns.length === 1 && currentDns[0] === "127.0.0.1")) {
  dns.setServers(["192.168.0.1", "8.8.8.8", "1.1.1.1"]);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not defined in environment variables.");
}

declare global {
  var _mongoClientInstance: MongoClient | undefined;
}

if (!global._mongoClientInstance) {
  global._mongoClientInstance = new MongoClient(uri);
}

export const mongoClient: MongoClient = global._mongoClientInstance;

// Support explicit test database isolation (e.g. equipment_rental_test_verify)
const testDbName = process.env.NODE_ENV === "test" && process.env.TEST_DB_NAME
  ? process.env.TEST_DB_NAME
  : undefined;

// Derive database from test configuration or directly from connection URI
export const mongoDb = mongoClient.db(testDbName);
