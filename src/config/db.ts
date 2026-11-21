import mongoose from "mongoose";
import dns from "dns";

// If Node's c-ares resolver defaults to loopback 127.0.0.1 (common on some Windows setups without local DNS),
// fallback to system router / public DNS to resolve Atlas SRV records.
const currentDns = dns.getServers();
if (!currentDns || currentDns.length === 0 || (currentDns.length === 1 && currentDns[0] === "127.0.0.1")) {
  dns.setServers(["192.168.0.1", "8.8.8.8"]);
}

export const connectDB = async (): Promise<boolean> => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("MONGODB_URI is not defined in environment variables");
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });
    console.log("Connected to MongoDB Atlas successfully");
    return true;
  } catch (error: any) {
    console.error("MongoDB Atlas connection error:", error.message || error);
    return false;
  }
};
