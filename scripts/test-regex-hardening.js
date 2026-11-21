// Pure unit test verifying safe regex escaping without touching any database
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runRegexSecurityTests() {
  console.log("Running Safe Regex Escaping Unit Tests...");

  const problematicInputs = [
    "(",
    ")",
    "[",
    "]",
    "+",
    "?",
    "*",
    ".",
    "^",
    "$",
    "|",
    "\\",
    "{",
    "}",
    "CAT (320) + Heavy [Excavator]*?",
  ];

  for (const input of problematicInputs) {
    try {
      const escaped = escapeRegex(input);
      const regex = new RegExp(escaped, "i");
      
      // Verify regex doesn't throw and matches the exact literal string
      const testString = `Rental for ${input} available now`;
      const isMatch = regex.test(testString);
      
      if (!isMatch) {
        throw new Error(`Failed to match literal text for input: ${input}`);
      }
    } catch (err) {
      console.error(`REGEX_SECURITY_TEST FAILED on input: "${input}"`, err);
      process.exit(1);
    }
  }

  // Verify that an unescaped regex would have thrown or behaved incorrectly
  let threwAsExpected = false;
  try {
    new RegExp("(", "i");
  } catch (e) {
    threwAsExpected = true;
  }

  if (!threwAsExpected) {
    throw new Error("Expected unescaped '(' to throw SyntaxError in RegExp constructor");
  }

  console.log("REGEX_SECURITY_TEST: ALL TESTS PASSED");
  console.log("Verified: inputs like (, [, +, ?, *, . are safely neutralized and treated as literal text.");
}

runRegexSecurityTests();
