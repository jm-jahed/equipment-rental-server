require("dotenv").config();
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { connectDB } = require("../dist/config/db");
const { User } = require("../dist/models/User");
const { verifyToken, verifyRenter, verifyOwner, verifyAdmin } = require("../dist/middlewares/auth");

const PORT = 5095;
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key";
const TEST_DB = "equipment_rental_test_verify";

async function runRbacSuite() {
  // Strict test database isolation
  await connectDB(TEST_DB);

  const app = express();
  app.use(express.json());

  app.get("/test/renter", verifyToken, verifyRenter, (req, res) => {
    res.json({ success: true, message: "Renter access granted", role: req.user.role });
  });

  app.get("/test/owner", verifyToken, verifyOwner, (req, res) => {
    res.json({ success: true, message: "Owner access granted", role: req.user.role });
  });

  app.get("/test/admin", verifyToken, verifyAdmin, (req, res) => {
    res.json({ success: true, message: "Admin access granted", role: req.user.role });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`RBAC test server running on port ${PORT}`);

  const createdUsers = [];

  try {
    // Create 3 test users in DB
    const customer = await User.create({
      name: "RBAC Customer",
      email: `customer_${Date.now()}@test.com`,
      role: "Customer",
    });
    createdUsers.push(customer._id);

    const owner = await User.create({
      name: "RBAC Owner",
      email: `owner_${Date.now()}@test.com`,
      role: "Owner",
    });
    createdUsers.push(owner._id);

    const admin = await User.create({
      name: "RBAC Admin",
      email: `admin_${Date.now()}@test.com`,
      role: "Admin",
    });
    createdUsers.push(admin._id);

    const customerToken = jwt.sign({ id: customer._id.toString() }, JWT_SECRET, { expiresIn: "1h" });
    const ownerToken = jwt.sign({ id: owner._id.toString() }, JWT_SECRET, { expiresIn: "1h" });
    const adminToken = jwt.sign({ id: admin._id.toString() }, JWT_SECRET, { expiresIn: "1h" });

    // Customer tests
    console.log("TEST 1: Customer accessing /test/renter");
    const resCustRenter = await fetch(`http://localhost:${PORT}/test/renter`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (resCustRenter.status !== 200) throw new Error("Customer should have access to /test/renter");
    console.log("Customer -> /test/renter: PASS (200)");

    console.log("TEST 2: Customer accessing /test/owner");
    const resCustOwner = await fetch(`http://localhost:${PORT}/test/owner`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (resCustOwner.status !== 403) throw new Error("Customer must be blocked from /test/owner");
    console.log("Customer -> /test/owner: PASS (403 Forbidden)");

    console.log("TEST 3: Customer accessing /test/admin");
    const resCustAdmin = await fetch(`http://localhost:${PORT}/test/admin`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (resCustAdmin.status !== 403) throw new Error("Customer must be blocked from /test/admin");
    console.log("Customer -> /test/admin: PASS (403 Forbidden)");

    // Owner tests
    console.log("TEST 4: Owner accessing /test/owner");
    const resOwnerOwner = await fetch(`http://localhost:${PORT}/test/owner`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    if (resOwnerOwner.status !== 200) throw new Error("Owner should have access to /test/owner");
    console.log("Owner -> /test/owner: PASS (200)");

    console.log("TEST 5: Owner accessing /test/admin");
    const resOwnerAdmin = await fetch(`http://localhost:${PORT}/test/admin`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    if (resOwnerAdmin.status !== 403) throw new Error("Owner must be blocked from /test/admin");
    console.log("Owner -> /test/admin: PASS (403 Forbidden)");

    // Admin tests
    console.log("TEST 6: Admin accessing /test/admin");
    const resAdminAdmin = await fetch(`http://localhost:${PORT}/test/admin`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resAdminAdmin.status !== 200) throw new Error("Admin should have access to /test/admin");
    console.log("Admin -> /test/admin: PASS (200)");

    console.log("TEST 7: Admin accessing /test/owner and /test/renter (Superuser check)");
    const resAdminOwner = await fetch(`http://localhost:${PORT}/test/owner`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const resAdminRenter = await fetch(`http://localhost:${PORT}/test/renter`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resAdminOwner.status !== 200 || resAdminRenter.status !== 200) {
      throw new Error("Admin must have access to owner and renter routes");
    }
    console.log("Admin -> /test/owner & /test/renter: PASS (200)");

    console.log("RBAC_SUITE_RESULT: ALL 7 TESTS PASSED");
  } finally {
    for (const uid of createdUsers) {
      await User.findByIdAndDelete(uid);
    }
    console.log("Cleaned up RBAC test users");
    server.close();
  }
}

runRbacSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RBAC_SUITE_ERROR:", err);
    process.exit(1);
  });
