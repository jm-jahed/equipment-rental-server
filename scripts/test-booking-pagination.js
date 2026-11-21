process.env.NODE_ENV = "test";
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../dist/server").default;
const { connectDB } = require("../dist/config/db");
const { User } = require("../dist/models/User");
const { Equipment } = require("../dist/models/Equipment");
const { Booking } = require("../dist/models/Booking");

const PORT = 5099;
const TEST_DB = "equipment_rental_test_verify";
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key";

async function runPaginationSuite() {
  console.log("=================================================");
  console.log("RUNNING BOOKING HISTORY PAGINATION TEST SUITE");
  console.log("=================================================");

  await connectDB(TEST_DB);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Test server running on port ${PORT}`);

  try {
    const owner = await User.create({
      name: "Pagination Owner",
      email: `pag_owner_${Date.now()}@test.com`,
      role: "Owner",
    });

    const customer = await User.create({
      name: "Pagination Customer",
      email: `pag_cust_${Date.now()}@test.com`,
      role: "Customer",
    });

    const token = jwt.sign(
      { id: customer._id.toString(), email: customer.email, role: "Customer", name: customer.name },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const equipment = await Equipment.create({
      name: "Pagination Excavator",
      description: "Mini excavator",
      category: "Construction",
      rentalPrice: 200,
      rentalType: "Daily",
      location: "Dallas, TX",
      availableQuantity: 10,
      condition: "Good",
      status: "Approved",
      image: "https://example.com/pagination_exc.jpg",
      ownerId: owner._id,
    });

    // Create 5 test bookings for this customer
    const createdBookings = [];
    for (let i = 1; i <= 5; i++) {
      const b = await Booking.create({
        equipmentId: equipment._id,
        customerId: customer._id,
        ownerId: owner._id,
        startDate: new Date(Date.now() + i * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + (i + 2) * 24 * 60 * 60 * 1000),
        quantity: 1,
        totalAmount: 400,
        contactNumber: `+1555000000${i}`,
        deliveryAddress: `Address ${i}`,
        paymentStatus: "Paid",
        bookingStatus: "Confirmed",
        stripeSessionId: `cs_pag_${i}_${Date.now()}`,
      });
      createdBookings.push(b);
    }

    // TEST 1: Page 1 with limit 2
    console.log("\n[TEST 1] Fetching Page 1 with limit=2...");
    const resP1 = await fetch(`http://localhost:${PORT}/api/bookings/my-rentals?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dataP1 = await resP1.json();
    console.log("Page 1 count:", dataP1.count, "Pagination:", dataP1.pagination);

    if (dataP1.count !== 2) throw new Error(`Expected 2 items on Page 1, got ${dataP1.count}`);
    if (dataP1.pagination.total !== 5) throw new Error(`Expected total 5, got ${dataP1.pagination.total}`);
    if (dataP1.pagination.totalPages !== 3) throw new Error(`Expected 3 total pages, got ${dataP1.pagination.totalPages}`);
    if (dataP1.pagination.page !== 1) throw new Error(`Expected page 1, got ${dataP1.pagination.page}`);
    console.log("PASS: Page 1 pagination metadata and slice accurate.");

    // TEST 2: Page 2 with limit 2
    console.log("\n[TEST 2] Fetching Page 2 with limit=2...");
    const resP2 = await fetch(`http://localhost:${PORT}/api/bookings/my-rentals?page=2&limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dataP2 = await resP2.json();
    console.log("Page 2 count:", dataP2.count, "Pagination:", dataP2.pagination);

    if (dataP2.count !== 2) throw new Error(`Expected 2 items on Page 2, got ${dataP2.count}`);
    if (dataP2.pagination.page !== 2) throw new Error(`Expected page 2, got ${dataP2.pagination.page}`);
    // Check distinct records between page 1 and page 2
    if (dataP1.data[0]._id === dataP2.data[0]._id) {
      throw new Error("Page 1 and Page 2 returned overlapping records!");
    }
    console.log("PASS: Page 2 returned distinct subsequent record slice.");

    // TEST 3: Page 3 with limit 2 (last page, should have 1 item)
    console.log("\n[TEST 3] Fetching Page 3 with limit=2 (boundary)...");
    const resP3 = await fetch(`http://localhost:${PORT}/api/bookings/my-rentals?page=3&limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dataP3 = await resP3.json();
    console.log("Page 3 count:", dataP3.count, "Pagination:", dataP3.pagination);
    if (dataP3.count !== 1) throw new Error(`Expected 1 item on Page 3, got ${dataP3.count}`);
    console.log("PASS: Boundary page accurately returned remainder record.");

    // Clean up
    await Booking.deleteMany({ customerId: customer._id });
    await Equipment.findByIdAndDelete(equipment._id);
    await User.deleteMany({ _id: { $in: [owner._id, customer._id] } });

    console.log("\n=================================================");
    console.log("ALL BOOKING PAGINATION TESTS PASSED (100%)");
    console.log("=================================================");
    process.exit(0);
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runPaginationSuite().catch((err) => {
  console.error("Pagination Suite Failure:", err);
  process.exit(1);
});
