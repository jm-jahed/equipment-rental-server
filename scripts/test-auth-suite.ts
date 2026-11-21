import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "../src/server";
import { User } from "../src/models/User";

const PORT = 5097;

async function runAuthSuite() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`Test server running on port ${PORT}`);

  const testEmail = `test_runner_${Date.now()}@example.com`;
  const validPassword = "SecurePassword123";
  let authToken = "";
  let userId = "";

  try {
    // 1. Password validation test: lacking uppercase
    console.log("TEST 1: Password validation (no uppercase)");
    const resNoUpper = await fetch(`http://localhost:${PORT}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: testEmail,
        password: "lowercaseonly123",
      }),
    });
    console.log("No uppercase status:", resNoUpper.status);
    if (resNoUpper.status !== 400) throw new Error("Expected 400 for password missing uppercase");

    // 2. Password validation test: too short (< 6 chars)
    console.log("TEST 2: Password validation (< 6 chars)");
    const resShort = await fetch(`http://localhost:${PORT}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: testEmail,
        password: "Ab1",
      }),
    });
    console.log("Short password status:", resShort.status);
    if (resShort.status !== 400) throw new Error("Expected 400 for password < 6 characters");

    // 3. Valid registration
    console.log("TEST 3: Valid registration");
    const resReg = await fetch(`http://localhost:${PORT}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Runner",
        email: testEmail,
        password: validPassword,
      }),
    });
    const regData = await resReg.json();
    console.log("Valid registration status:", resReg.status, "role:", regData.user?.role);
    if (resReg.status !== 201 || regData.user?.role !== "Customer") {
      throw new Error("Valid registration failed or role is not Customer");
    }
    userId = regData.user.id;

    // 4. Duplicate registration prevention
    console.log("TEST 4: Duplicate registration prevention");
    const resDup = await fetch(`http://localhost:${PORT}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test Runner",
        email: testEmail,
        password: validPassword,
      }),
    });
    console.log("Duplicate registration status:", resDup.status);
    if (resDup.status !== 400) throw new Error("Expected 400 for duplicate email registration");

    // 5. Login: Wrong password
    console.log("TEST 5: Login with wrong password");
    const resWrongPass = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: "WrongPassword999",
      }),
    });
    console.log("Wrong password status:", resWrongPass.status);
    if (resWrongPass.status !== 401) throw new Error("Expected 401 for invalid password");

    // 6. Login: Correct credentials
    console.log("TEST 6: Login with correct credentials");
    const resLogin = await fetch(`http://localhost:${PORT}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: validPassword,
      }),
    });
    const loginData = await resLogin.json();
    console.log("Login status:", resLogin.status, "hasToken:", !!loginData.token);
    if (resLogin.status !== 200 || !loginData.token) {
      throw new Error("Login failed with valid credentials");
    }
    authToken = loginData.token;

    // 7. Protected route: GET /api/auth/me with valid Bearer token
    console.log("TEST 7: GET /api/auth/me with Bearer token");
    const resMe = await fetch(`http://localhost:${PORT}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const meData = await resMe.json();
    console.log("Profile status:", resMe.status, "email:", meData.user?.email);
    if (resMe.status !== 200 || meData.user?.email !== testEmail) {
      throw new Error("Protected route verification failed");
    }

    // 8. Protected route: Invalid Bearer token rejection
    console.log("TEST 8: Protected route rejection with invalid token");
    const resBadToken = await fetch(`http://localhost:${PORT}/api/auth/me`, {
      headers: { Authorization: "Bearer invalid.token.payload" },
    });
    console.log("Invalid token status:", resBadToken.status);
    if (resBadToken.status !== 401) throw new Error("Expected 401 for invalid bearer token");

    console.log("AUTH_SUITE_RESULT: ALL TESTS PASSED");
  } finally {
    // Clean up test user
    if (userId) {
      await User.findByIdAndDelete(userId);
      console.log("Cleaned up test user:", userId);
    }
    server.close();
  }
}

runAuthSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("AUTH_SUITE_ERROR:", err);
    process.exit(1);
  });
