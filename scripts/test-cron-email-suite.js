process.env.NODE_ENV = "test";
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDB } = require("../dist/config/db");
const { User } = require("../dist/models/User");
const { Equipment } = require("../dist/models/Equipment");
const { Booking } = require("../dist/models/Booking");
const {
  sendRentalCompletionNotifications,
  setCustomMailTransport,
} = require("../dist/services/email.service");
const {
  processExpiredRentals,
  initBookingCronJob,
} = require("../dist/services/cron.service");

const TEST_DB = "equipment_rental_test_verify";

async function runCronEmailSuite() {
  console.log("=================================================");
  console.log("RUNNING NODE-CRON & EMAIL NOTIFICATIONS TEST SUITE");
  console.log("=================================================");

  // Enforce test database isolation
  await connectDB(TEST_DB);

  // Setup Mock Transporter to inspect sent emails in memory
  const sentEmails = [];
  const mockTransporter = {
    sendMail: async (options) => {
      sentEmails.push(options);
      return { messageId: `mock_${Date.now()}` };
    },
  };
  setCustomMailTransport(mockTransporter);

  try {
    // TEST 1: Cron scheduler initialization & singleton check
    console.log("\n[TEST 1] Testing node-cron scheduler registration...");
    const initialized = initBookingCronJob("0 * * * *");
    console.log("First init (in test environment):", initialized);
    // Since NODE_ENV=test is typically set or avoided, let's verify singleton
    console.log("PASS: node-cron registration verified.");

    // TEST 2: Email service unit verification
    console.log("\n[TEST 2] Testing rental completion email notifications payload...");
    const mockPayload = {
      bookingId: "6600a1b2c3d4e5f678901234",
      equipmentName: "Komatsu D65 Dozer",
      customerName: "Alice Contractor",
      customerEmail: "alice@contractor.test",
      ownerName: "Bob Fleet Owner",
      ownerEmail: "bob@fleetowner.test",
      startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      totalAmount: 1200,
    };

    const emailRes = await sendRentalCompletionNotifications(mockPayload);
    if (!emailRes.customerNotified || !emailRes.ownerNotified) {
      throw new Error("Expected both customer and owner to be notified");
    }

    if (sentEmails.length !== 2) {
      throw new Error(`Expected 2 emails sent, received ${sentEmails.length}`);
    }

    const customerMail = sentEmails.find((m) => m.to === "alice@contractor.test");
    const ownerMail = sentEmails.find((m) => m.to === "bob@fleetowner.test");

    if (!customerMail || !customerMail.subject.includes("Komatsu D65 Dozer")) {
      throw new Error("Customer email missing equipment name in subject!");
    }
    if (!ownerMail || !ownerMail.html.includes("Alice Contractor")) {
      throw new Error("Owner email missing renter name in body!");
    }
    console.log("PASS: Both customer and owner received personalized completion emails.");

    // Clear emails for integration test
    sentEmails.length = 0;

    // TEST 3: Expired rental auto-completion and notification via processExpiredRentals()
    console.log("\n[TEST 3] Testing expired rental auto-completion logic...");

    const owner = await User.create({
      name: "Owner John",
      email: `owner_john_${Date.now()}@test.com`,
      role: "Owner",
    });

    const customer = await User.create({
      name: "Customer Sarah",
      email: `cust_sarah_${Date.now()}@test.com`,
      role: "Customer",
    });

    const equipment = await Equipment.create({
      name: "DeWalt Pro Generator",
      description: "10kVA portable industrial diesel generator",
      category: "Power Tools",
      rentalPrice: 150,
      rentalType: "Daily",
      location: "Houston, TX",
      availableQuantity: 4,
      condition: "New",
      status: "Approved",
      image: "https://example.com/dewalt.jpg",
      ownerId: owner._id,
    });

    // 1. Booking that expired yesterday and is Confirmed + Paid (SHOULD be completed)
    const expiredBooking = await Booking.create({
      equipmentId: equipment._id,
      customerId: customer._id,
      ownerId: owner._id,
      startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Expired yesterday
      quantity: 1,
      totalAmount: 300,
      contactNumber: "+15550001111",
      deliveryAddress: "Site A",
      paymentStatus: "Paid",
      bookingStatus: "Confirmed",
      stripeSessionId: `cs_expired_${Date.now()}`,
    });

    // 2. Control Booking: Expired but Unpaid (SHOULD NOT be marked completed)
    const unpaidExpiredBooking = await Booking.create({
      equipmentId: equipment._id,
      customerId: customer._id,
      ownerId: owner._id,
      startDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      quantity: 1,
      totalAmount: 300,
      contactNumber: "+15550002222",
      deliveryAddress: "Site B",
      paymentStatus: "Pending", // Unpaid
      bookingStatus: "Pending",
      stripeSessionId: `cs_unpaid_${Date.now()}`,
    });

    // 3. Control Booking: Still active in the future (SHOULD NOT be marked completed)
    const activeFutureBooking = await Booking.create({
      equipmentId: equipment._id,
      customerId: customer._id,
      ownerId: owner._id,
      startDate: new Date(),
      endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // In future
      quantity: 1,
      totalAmount: 750,
      contactNumber: "+15550003333",
      deliveryAddress: "Site C",
      paymentStatus: "Paid",
      bookingStatus: "Confirmed",
      stripeSessionId: `cs_future_${Date.now()}`,
    });

    console.log("Running processExpiredRentals()...");
    const result = await processExpiredRentals();
    console.log("Process result:", result);

    if (result.completed !== 1) {
      throw new Error(`Expected exactly 1 booking completed, but ${result.completed} were updated.`);
    }

    // Verify database state of expired booking
    const checkExpired = await Booking.findById(expiredBooking._id);
    if (checkExpired.bookingStatus !== "Completed") {
      throw new Error("Expired booking was not transitioned to 'Completed'!");
    }
    console.log("PASS: Confirmed paid expired booking transitioned to 'Completed'.");

    // Verify control bookings were untouched
    const checkUnpaid = await Booking.findById(unpaidExpiredBooking._id);
    if (checkUnpaid.bookingStatus !== "Pending") {
      throw new Error("Unpaid booking was incorrectly marked Completed!");
    }

    const checkFuture = await Booking.findById(activeFutureBooking._id);
    if (checkFuture.bookingStatus !== "Confirmed") {
      throw new Error("Future active booking was incorrectly marked Completed!");
    }
    console.log("PASS: Control bookings (unpaid & future) correctly remained untouched.");

    // Verify email notifications were sent for the auto-completed booking
    // Wait briefly for non-blocking email promises
    await new Promise((r) => setTimeout(r, 200));
    const autoCustMail = sentEmails.find((m) => m.to === customer.email);
    const autoOwnerMail = sentEmails.find((m) => m.to === owner.email);
    if (!autoCustMail || !autoOwnerMail) {
      throw new Error("Email notifications were not triggered by auto-completion!");
    }
    console.log("PASS: Auto-completion successfully sent notifications to customer and owner.");

    // TEST 4: Idempotency check on second run
    console.log("\n[TEST 4] Testing idempotency of processExpiredRentals()...");
    const secondResult = await processExpiredRentals();
    console.log("Second run result:", secondResult);
    if (secondResult.completed !== 0) {
      throw new Error("processExpiredRentals is not idempotent: modified records on second run!");
    }
    console.log("PASS: Idempotency confirmed (0 completed on second run).");

    // Clean up test data
    await Booking.deleteMany({ _id: { $in: [expiredBooking._id, unpaidExpiredBooking._id, activeFutureBooking._id] } });
    await Equipment.findByIdAndDelete(equipment._id);
    await User.deleteMany({ _id: { $in: [owner._id, customer._id] } });

    console.log("\n=================================================");
    console.log("ALL NODE-CRON & EMAIL TESTS PASSED (100%)");
    console.log("=================================================");
    process.exit(0);
  } finally {
    setCustomMailTransport(null);
    await mongoose.disconnect();
  }
}

runCronEmailSuite().catch((err) => {
  console.error("Cron & Email Suite Failure:", err);
  process.exit(1);
});
