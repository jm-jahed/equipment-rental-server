process.env.NODE_ENV = "test";
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();
const http = require("http");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const app = require("../dist/server").default;
const { connectDB } = require("../dist/config/db");
const { User } = require("../dist/models/User");
const { Equipment } = require("../dist/models/Equipment");
const { Booking } = require("../dist/models/Booking");
const { Payment } = require("../dist/models/Payment");
const { fulfillBookingFromSession } = require("../dist/routes/booking.routes");

const PORT = 5098;
const TEST_DB = "equipment_rental_test_verify";
const TEST_WEBHOOK_SECRET = "whsec_test_secret_for_suite";

async function runStripeWebhookSuite() {
  console.log("=================================================");
  console.log("RUNNING STRIPE WEBHOOK & IDEMPOTENCY TEST SUITE");
  console.log("=================================================");

  // Enforce isolated test database
  await connectDB(TEST_DB);

  // Set test webhook secret in environment for signature generation
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Test server running on port ${PORT}`);

  try {
    // 1. Create Test Owner, Customer, and Equipment
    const owner = await User.create({
      name: "Webhook Owner",
      email: `webhook_owner_${Date.now()}@test.com`,
      role: "Owner",
    });

    const customer = await User.create({
      name: "Webhook Customer",
      email: `webhook_cust_${Date.now()}@test.com`,
      role: "Customer",
    });

    const equipment = await Equipment.create({
      name: "Caterpillar 320D Excavator",
      description: "20-ton tracked hydraulic excavator",
      category: "Heavy Machinery",
      rentalPrice: 500,
      rentalType: "Daily",
      location: "Austin, TX",
      availableQuantity: 5,
      condition: "Good",
      status: "Approved",
      image: "https://example.com/cat320d.jpg",
      ownerId: owner._id,
    });

    const initialQuantity = equipment.availableQuantity;
    const testSessionId = `cs_test_${Date.now()}`;
    const testRentDays = 3;
    const testQty = 2;
    const testTotalAmount = testRentDays * equipment.rentalPrice * testQty;

    // Construct mock Stripe Checkout Session
    const mockSession = {
      id: testSessionId,
      object: "checkout.session",
      payment_status: "paid",
      currency: "usd",
      amount_total: testTotalAmount * 100,
      payment_intent: `pi_test_${Date.now()}`,
      metadata: {
        equipmentId: equipment._id.toString(),
        customerId: customer._id.toString(),
        ownerId: owner._id.toString(),
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + testRentDays * 24 * 60 * 60 * 1000).toISOString(),
        quantity: String(testQty),
        totalAmount: String(testTotalAmount),
        contactNumber: "+15551234567",
        deliveryAddress: "100 Construction Site Rd",
        additionalNotes: "Handle with care",
      },
    };

    const mockPayload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      object: "event",
      type: "checkout.session.completed",
      data: { object: mockSession },
    });

    // TEST 1: Reject missing signature
    console.log("\n[TEST 1] Testing Webhook rejection on missing signature header...");
    const resNoSig = await fetch(`http://localhost:${PORT}/api/bookings/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: mockPayload,
    });
    console.log("Status without signature:", resNoSig.status);
    if (resNoSig.status !== 400) {
      throw new Error(`Expected 400 for missing signature, received ${resNoSig.status}`);
    }
    console.log("PASS: Webhook rejected request without signature.");

    // TEST 2: Reject invalid signature
    console.log("\n[TEST 2] Testing Webhook rejection on invalid signature...");
    const resBadSig = await fetch(`http://localhost:${PORT}/api/bookings/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=123456789,v1=invalid_fake_signature_hash",
      },
      body: mockPayload,
    });
    console.log("Status with invalid signature:", resBadSig.status);
    if (resBadSig.status !== 400) {
      throw new Error(`Expected 400 for invalid signature, received ${resBadSig.status}`);
    }
    console.log("PASS: Webhook rejected invalid signature.");

    // TEST 3: Generate valid Stripe signature using Stripe test helpers and test fulfillment
    console.log("\n[TEST 3] Generating valid Stripe signature and testing fulfillment...");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
      apiVersion: "2023-10-16",
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const validSignature = stripe.webhooks.generateTestHeaderString({
      payload: mockPayload,
      secret: TEST_WEBHOOK_SECRET,
      timestamp,
    });

    const resValid = await fetch(`http://localhost:${PORT}/api/bookings/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": validSignature,
      },
      body: mockPayload,
    });

    console.log("Status with valid signature:", resValid.status);
    if (resValid.status !== 200) {
      const errText = await resValid.text();
      throw new Error(`Expected 200 for valid webhook, received ${resValid.status}: ${errText}`);
    }

    // Verify booking record in database
    const createdBooking = await Booking.findOne({ stripeSessionId: testSessionId });
    if (!createdBooking) throw new Error("Booking was not created by webhook!");
    if (createdBooking.bookingStatus !== "Confirmed") throw new Error("Booking status is not Confirmed!");
    if (createdBooking.paymentStatus !== "Paid") throw new Error("Payment status is not Paid!");
    console.log("PASS: Booking successfully created with Confirmed/Paid status.");

    // Verify payment transaction record
    const createdPayment = await Payment.findOne({ stripeSessionId: testSessionId });
    if (!createdPayment) throw new Error("Payment record was not created by webhook!");
    if (createdPayment.status !== "Succeeded") throw new Error("Payment record status is not Succeeded!");
    console.log("PASS: Payment record successfully stored with transactionId.");

    // Verify stock was decremented by testQty
    const updatedEq = await Equipment.findById(equipment._id);
    if (updatedEq.availableQuantity !== initialQuantity - testQty) {
      throw new Error(`Expected availableQuantity ${initialQuantity - testQty}, got ${updatedEq.availableQuantity}`);
    }
    console.log(`PASS: Equipment stock decremented from ${initialQuantity} to ${updatedEq.availableQuantity}.`);

    // TEST 4: Idempotency Verification (Deliver duplicate webhook event)
    console.log("\n[TEST 4] Testing Webhook Idempotency (Duplicate delivery)...");
    const resDuplicate = await fetch(`http://localhost:${PORT}/api/bookings/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": validSignature,
      },
      body: mockPayload,
    });

    console.log("Duplicate webhook delivery status:", resDuplicate.status);
    if (resDuplicate.status !== 200) {
      throw new Error(`Expected 200 for duplicate webhook, received ${resDuplicate.status}`);
    }

    // Verify no duplicate bookings were created
    const bookingCount = await Booking.countDocuments({ stripeSessionId: testSessionId });
    if (bookingCount !== 1) {
      throw new Error(`Duplicate booking created! Expected 1 booking, found ${bookingCount}`);
    }

    const paymentCount = await Payment.countDocuments({ stripeSessionId: testSessionId });
    if (paymentCount !== 1) {
      throw new Error(`Duplicate payment created! Expected 1 payment, found ${paymentCount}`);
    }

    // Verify stock was NOT decremented again
    const eqAfterDuplicate = await Equipment.findById(equipment._id);
    if (eqAfterDuplicate.availableQuantity !== initialQuantity - testQty) {
      throw new Error(`Stock double-decremented! Quantity is ${eqAfterDuplicate.availableQuantity}`);
    }
    console.log("PASS: Idempotency verified: zero duplicate bookings, zero duplicate stock decrements.");

    // Clean up test records
    await Booking.deleteMany({ stripeSessionId: testSessionId });
    await Payment.deleteMany({ stripeSessionId: testSessionId });
    await Equipment.findByIdAndDelete(equipment._id);
    await User.findByIdAndDelete(owner._id);
    await User.findByIdAndDelete(customer._id);

    console.log("\n=================================================");
    console.log("ALL STRIPE WEBHOOK TESTS PASSED (100%)");
    console.log("=================================================");
    process.exit(0);
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runStripeWebhookSuite().catch((err) => {
  console.error("Stripe Webhook Suite Failure:", err);
  process.exit(1);
});
