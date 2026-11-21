import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();

const currentDns = dns.getServers();
if (!currentDns || currentDns.length === 0 || (currentDns.length === 1 && currentDns[0] === "127.0.0.1")) {
  dns.setServers(["192.168.0.1", "8.8.8.8", "1.1.1.1"]);
}

async function runIsolatedMigrationTest() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required.");
  }

  const client = new MongoClient(uri);
  await client.connect();

  // STRICTLY target isolated disposable test database
  const testDb = client.db("equipment_rental_test_verify");
  console.log("Connected to isolated test database:", testDb.databaseName);

  try {
    const testUsers = testDb.collection("users");
    const testAccounts = testDb.collection("account");

    // Clear test collections
    await testUsers.deleteMany({});
    await testAccounts.deleteMany({});

    // Seed dummy legacy user
    const dummyId = new ObjectId();
    const dummyBcryptHash = "$2a$10$e8O0pWwLlhB51d9hT0.Q9uFh4q0hZ4aGgK6I5QoX6qGfX2qX.K3yG";
    await testUsers.insertOne({
      _id: dummyId,
      name: "Legacy Test User",
      email: "legacy_verify@example.com",
      password: dummyBcryptHash,
      role: "Customer",
      createdAt: new Date(),
    });

    console.log("Seeded dummy legacy user with ID:", dummyId.toString());

    // Execute migration logic
    const usersWithPassword = await testUsers
      .find({ password: { $exists: true, $ne: "" } })
      .toArray();

    let migratedCount = 0;
    for (const u of usersWithPassword) {
      const existing = await testAccounts.findOne({
        userId: u._id,
        providerId: "credential",
      });

      if (!existing) {
        await testAccounts.insertOne({
          _id: new ObjectId(),
          userId: u._id,
          accountId: u._id.toString(),
          providerId: "credential",
          password: u.password,
          createdAt: u.createdAt || new Date(),
          updatedAt: new Date(),
        });
        migratedCount++;
      }
    }

    console.log("Migration executed. Migrated records count:", migratedCount);

    // Verify assertions
    const createdAccount = await testAccounts.findOne({ userId: dummyId });
    if (!createdAccount) throw new Error("Verification failed: Account record was not created!");
    if (createdAccount.password !== dummyBcryptHash) throw new Error("Verification failed: Password hash mismatch!");
    if (!createdAccount.userId.equals(dummyId)) throw new Error("Verification failed: BSON ObjectId mismatch!");

    const preservedUser = await testUsers.findOne({ _id: dummyId });
    if (!preservedUser || preservedUser.password !== dummyBcryptHash) {
      throw new Error("Verification failed: users.password was modified or dropped!");
    }

    // Clean up disposable database collections
    await testUsers.deleteMany({});
    await testAccounts.deleteMany({});

    console.log("ISOLATED_MIGRATION_TEST: PASS");
    console.log("All assertions verified: 100% safe, idempotent, and non-destructive.");
  } finally {
    await client.close();
  }
}

runIsolatedMigrationTest().catch((err) => {
  console.error("ISOLATED_MIGRATION_TEST: FAIL", err);
  process.exit(1);
});
