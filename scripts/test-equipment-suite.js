require("dotenv").config();
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../dist/server").default;
const { connectDB } = require("../dist/config/db");
const { User } = require("../dist/models/User");
const { Equipment } = require("../dist/models/Equipment");

const PORT = 5094;
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key";
const TEST_DB = "equipment_rental_test_verify";

async function runEquipmentSuite() {
  // Strict test database isolation: never run automated tests against the production/main database
  await connectDB(TEST_DB);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Equipment test server running on port ${PORT}`);

  const testUsers = [];
  const testEquipmentIds = [];

  try {
    // 1. Create Test Users: Owner A, Owner B, Admin, Customer
    const ownerA = await User.create({
      name: "Owner A",
      email: `ownerA_${Date.now()}@test.com`,
      role: "Owner",
    });
    testUsers.push(ownerA._id);

    const ownerB = await User.create({
      name: "Owner B",
      email: `ownerB_${Date.now()}@test.com`,
      role: "Owner",
    });
    testUsers.push(ownerB._id);

    const admin = await User.create({
      name: "Admin User",
      email: `admin_${Date.now()}@test.com`,
      role: "Admin",
    });
    testUsers.push(admin._id);

    const customer = await User.create({
      name: "Customer User",
      email: `customer_${Date.now()}@test.com`,
      role: "Customer",
    });
    testUsers.push(customer._id);

    const tokenOwnerA = jwt.sign({ id: ownerA._id.toString() }, JWT_SECRET, { expiresIn: "1h" });
    const tokenOwnerB = jwt.sign({ id: ownerB._id.toString() }, JWT_SECRET, { expiresIn: "1h" });
    const tokenAdmin = jwt.sign({ id: admin._id.toString() }, JWT_SECRET, { expiresIn: "1h" });
    const tokenCustomer = jwt.sign({ id: customer._id.toString() }, JWT_SECRET, { expiresIn: "1h" });

    // TEST 1: Unauthorized create attempts
    console.log("TEST 1: Customer attempting to create equipment (Expect 403)");
    const resCustCreate = await fetch(`http://localhost:${PORT}/api/equipment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenCustomer}`,
      },
      body: JSON.stringify({
        name: "Customer Camera",
        description: "Test description",
        category: "Photography Equipment",
        rentalPrice: 50,
        location: "Austin, TX",
        image: "https://example.com/cam.jpg",
      }),
    });
    if (resCustCreate.status !== 403) throw new Error("Customer should not be able to create equipment");
    console.log("Customer -> create equipment: PASS (403 Forbidden)");

    // TEST 2: Owner A creates equipment
    console.log("TEST 2: Owner A creates equipment (Expect 201, status Pending)");
    const resCreateA = await fetch(`http://localhost:${PORT}/api/equipment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenOwnerA}`,
      },
      body: JSON.stringify({
        name: "Heavy Duty Excavator CAT 320",
        description: "Professional hydraulic excavator for earthmoving",
        category: "Construction Equipment",
        rentalPrice: 250,
        rentalType: "Daily",
        location: "Dallas, TX",
        availableQuantity: 2,
        image: "https://example.com/excavator.jpg",
      }),
    });
    const dataCreateA = await resCreateA.json();
    if (resCreateA.status !== 201 || dataCreateA.data?.status !== "Pending") {
      throw new Error("Failed to create equipment as Owner A with Pending status");
    }
    const equipAId = dataCreateA.data._id;
    testEquipmentIds.push(equipAId);
    console.log("Owner A -> create equipment: PASS (201 Created, Pending)");

    // TEST 3: Admin approves Equipment A
    console.log("TEST 3: Admin approves Equipment A (Expect 200, status Approved)");
    const resApprove = await fetch(`http://localhost:${PORT}/api/equipment/${equipAId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAdmin}`,
      },
      body: JSON.stringify({ status: "Approved" }),
    });
    const dataApprove = await resApprove.json();
    if (resApprove.status !== 200 || dataApprove.data?.status !== "Approved") {
      throw new Error("Admin status approval failed");
    }
    console.log("Admin -> approve equipment: PASS (200 Approved)");

    // TEST 4: Seed additional approved items for search, filter, sort & pagination
    console.log("TEST 4: Seed test catalog items");
    const catalogSeed = [
      {
        name: "Sony Alpha A7 IV Mirrorless Camera",
        description: "Full-frame hybrid camera with 4K video",
        category: "Photography Equipment",
        rentalPrice: 75,
        rentalType: "Daily",
        location: "Austin, TX",
        availableQuantity: 4,
        image: "https://example.com/sony.jpg",
        status: "Approved",
        ownerId: ownerA._id,
      },
      {
        name: "Canon EOS R5 Professional Camera",
        description: "8K video full-frame mirrorless camera",
        category: "Photography Equipment",
        rentalPrice: 120,
        rentalType: "Daily",
        location: "Dallas, TX",
        availableQuantity: 1,
        image: "https://example.com/canon.jpg",
        status: "Approved",
        ownerId: ownerB._id,
      },
      {
        name: "John Deere 5075E Utility Tractor",
        description: "75HP reliable utility agricultural tractor",
        category: "Agriculture Equipment",
        rentalPrice: 180,
        rentalType: "Weekly",
        location: "Houston, TX",
        availableQuantity: 1,
        image: "https://example.com/tractor.jpg",
        status: "Approved",
        ownerId: ownerA._id,
      },
      {
        name: "JBL Professional Line Array Sound System",
        description: "High-output concert event audio speaker system",
        category: "Event Equipment",
        rentalPrice: 350,
        rentalType: "Daily",
        location: "Austin, TX",
        availableQuantity: 2,
        image: "https://example.com/jbl.jpg",
        status: "Approved",
        ownerId: ownerB._id,
      },
      {
        name: "Bosch Rotary Hammer Drill GBH 2-28",
        description: "Powerful SDS-plus rotary hammer drill",
        category: "Construction Equipment",
        rentalPrice: 35,
        rentalType: "Daily",
        location: "San Antonio, TX",
        availableQuantity: 5,
        image: "https://example.com/drill.jpg",
        status: "Approved",
        ownerId: ownerA._id,
      },
      {
        name: "DJI Inspire 3 Cinema Drone",
        description: "Full-frame 8K aerial cinema drone system",
        category: "Photography Equipment",
        rentalPrice: 200,
        rentalType: "Daily",
        location: "Austin, TX",
        availableQuantity: 0, // Out of stock for availability testing
        image: "https://example.com/drone.jpg",
        status: "Approved",
        ownerId: ownerB._id,
      },
      {
        name: "Pending Bobcat Skid Steer Loader",
        description: "Compact track loader pending review",
        category: "Construction Equipment",
        rentalPrice: 220,
        rentalType: "Daily",
        location: "Dallas, TX",
        availableQuantity: 1,
        image: "https://example.com/bobcat.jpg",
        status: "Pending", // Should NOT appear in public catalog
        ownerId: ownerB._id,
      },
    ];

    const createdItems = await Equipment.insertMany(catalogSeed);
    createdItems.forEach((item) => testEquipmentIds.push(item._id));
    console.log(`Seeded ${createdItems.length} test catalog items.`);

    // TEST 5: Public catalog ignores Pending equipment
    console.log("TEST 5: Public catalog approved equipment filter");
    const resPublicAll = await fetch(`http://localhost:${PORT}/api/equipment?limit=50`);
    const dataPublicAll = await resPublicAll.json();
    const hasPendingInPublic = dataPublicAll.data.some((item) => item.status === "Pending");
    if (hasPendingInPublic) throw new Error("Public catalog must not display Pending items!");
    console.log("Public catalog pending item suppression: PASS");

    // TEST 6: Featured equipment endpoint (limit 6)
    console.log("TEST 6: Featured equipment (GET /api/equipment/featured)");
    const resFeatured = await fetch(`http://localhost:${PORT}/api/equipment/featured`);
    const dataFeatured = await resFeatured.json();
    if (resFeatured.status !== 200 || dataFeatured.data.length > 6) {
      throw new Error("Featured endpoint must return at most 6 approved items");
    }
    console.log(`Featured equipment returned ${dataFeatured.data.length} items: PASS`);

    // TEST 7: Search by title/name
    console.log("TEST 7: Search by title ('Excavator')");
    const resSearchTitle = await fetch(`http://localhost:${PORT}/api/equipment?search=Excavator`);
    const dataSearchTitle = await resSearchTitle.json();
    const foundExcavator = dataSearchTitle.data.some((i) => i.name.includes("Excavator"));
    if (!foundExcavator) throw new Error("Search by title failed to find Excavator");
    console.log("Search by title: PASS");

    // TEST 8: Search by location
    console.log("TEST 8: Search by location ('Austin')");
    const resSearchLoc = await fetch(`http://localhost:${PORT}/api/equipment?search=Austin`);
    const dataSearchLoc = await resSearchLoc.json();
    const allAustin = dataSearchLoc.data.every((i) => i.location.includes("Austin") || i.name.includes("Austin"));
    if (dataSearchLoc.data.length === 0 || !allAustin) throw new Error("Search by location failed");
    console.log("Search by location: PASS");

    // TEST 9: Category filter
    console.log("TEST 9: Filter by category ('Photography Equipment')");
    const resCat = await fetch(`http://localhost:${PORT}/api/equipment?category=Photography%20Equipment`);
    const dataCat = await resCat.json();
    const allPhotography = dataCat.data.every((i) => i.category === "Photography Equipment");
    if (dataCat.data.length === 0 || !allPhotography) throw new Error("Category filter failed");
    console.log(`Found ${dataCat.data.length} photography items: PASS`);

    // TEST 10: Price range filter (minPrice=50, maxPrice=150)
    console.log("TEST 10: Price range filter (50 - 150)");
    const resPrice = await fetch(`http://localhost:${PORT}/api/equipment?minPrice=50&maxPrice=150`);
    const dataPrice = await resPrice.json();
    const allWithinPrice = dataPrice.data.every((i) => i.rentalPrice >= 50 && i.rentalPrice <= 150);
    if (dataPrice.data.length === 0 || !allWithinPrice) throw new Error("Price range filter failed");
    console.log(`Found ${dataPrice.data.length} items in price range: PASS`);

    // TEST 11: Availability filter
    console.log("TEST 11: Availability filter ('available')");
    const resAvail = await fetch(`http://localhost:${PORT}/api/equipment?availability=available`);
    const dataAvail = await resAvail.json();
    const allAvailable = dataAvail.data.every((i) => i.availableQuantity > 0);
    if (!allAvailable) throw new Error("Availability filter returned out-of-stock items");
    console.log("Availability filter: PASS");

    // TEST 12: Sorting (Price Low to High)
    console.log("TEST 12: Sorting (Price Low to High)");
    const resSortAsc = await fetch(`http://localhost:${PORT}/api/equipment?sortBy=price_asc`);
    const dataSortAsc = await resSortAsc.json();
    for (let i = 0; i < dataSortAsc.data.length - 1; i++) {
      if (dataSortAsc.data[i].rentalPrice > dataSortAsc.data[i + 1].rentalPrice) {
        throw new Error("Price sort ascending failed!");
      }
    }
    console.log("Sorting (Price Low to High): PASS");

    // TEST 13: Sorting (Price High to Low)
    console.log("TEST 13: Sorting (Price High to Low)");
    const resSortDesc = await fetch(`http://localhost:${PORT}/api/equipment?sortBy=price_desc`);
    const dataSortDesc = await resSortDesc.json();
    for (let i = 0; i < dataSortDesc.data.length - 1; i++) {
      if (dataSortDesc.data[i].rentalPrice < dataSortDesc.data[i + 1].rentalPrice) {
        throw new Error("Price sort descending failed!");
      }
    }
    console.log("Sorting (Price High to Low): PASS");

    // TEST 14: Pagination metadata
    console.log("TEST 14: Pagination metadata (page=1, limit=3)");
    const resPage = await fetch(`http://localhost:${PORT}/api/equipment?page=1&limit=3`);
    const dataPage = await resPage.json();
    if (dataPage.data.length !== 3 || dataPage.pagination.page !== 1 || dataPage.pagination.limit !== 3) {
      throw new Error("Pagination metadata failed");
    }
    console.log("Pagination: PASS");

    // TEST 15: Empty search results handling
    console.log("TEST 15: Empty search result handling ('NonExistentEquipmentXYZ123')");
    const resEmpty = await fetch(`http://localhost:${PORT}/api/equipment?search=NonExistentEquipmentXYZ123`);
    const dataEmpty = await resEmpty.json();
    if (resEmpty.status !== 200 || dataEmpty.data.length !== 0 || dataEmpty.pagination.total !== 0) {
      throw new Error("Empty search result handling failed");
    }
    console.log("Empty search handling: PASS (200, count: 0)");

    // TEST 16: Ownership protection: Owner B tries to update Owner A's equipment (Expect 403)
    console.log("TEST 16: Owner B tries to update Owner A's equipment (Expect 403)");
    const resUnauthorizedUpdate = await fetch(`http://localhost:${PORT}/api/equipment/${equipAId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenOwnerB}`,
      },
      body: JSON.stringify({ name: "Hacked Name" }),
    });
    if (resUnauthorizedUpdate.status !== 403) throw new Error("Owner B must not update Owner A's equipment");
    console.log("Ownership update protection: PASS (403 Forbidden)");

    // TEST 17: Owner A updates their own equipment (Expect 200)
    console.log("TEST 17: Owner A updates their own equipment (Expect 200)");
    const resOwnerUpdate = await fetch(`http://localhost:${PORT}/api/equipment/${equipAId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenOwnerA}`,
      },
      body: JSON.stringify({ rentalPrice: 280 }),
    });
    const dataOwnerUpdate = await resOwnerUpdate.json();
    if (resOwnerUpdate.status !== 200 || dataOwnerUpdate.data?.rentalPrice !== 280) {
      throw new Error("Owner A failed to update own equipment");
    }
    console.log("Owner update own equipment: PASS (200 OK)");

    // TEST 18: Admin deletes equipment (Expect 200)
    console.log("TEST 18: Admin deletes equipment (Expect 200)");
    const resAdminDelete = await fetch(`http://localhost:${PORT}/api/equipment/${equipAId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${tokenAdmin}`,
      },
    });
    if (resAdminDelete.status !== 200) throw new Error("Admin delete equipment failed");
    console.log("Admin delete equipment: PASS (200 OK)");

    console.log("EQUIPMENT_SUITE_RESULT: ALL 18 TESTS PASSED");
  } finally {
    // Clean up all seeded test equipment and test users
    if (testEquipmentIds.length > 0) {
      await Equipment.deleteMany({ _id: { $in: testEquipmentIds } });
      console.log(`Cleaned up ${testEquipmentIds.length} test equipment records.`);
    }
    if (testUsers.length > 0) {
      await User.deleteMany({ _id: { $in: testUsers } });
      console.log(`Cleaned up ${testUsers.length} test users.`);
    }
    server.close();
  }
}

runEquipmentSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("EQUIPMENT_SUITE_ERROR:", err);
    process.exit(1);
  });
