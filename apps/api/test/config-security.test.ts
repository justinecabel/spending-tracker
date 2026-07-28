import assert from "node:assert/strict";
import test from "node:test";
import { resolveJwtSecret } from "../src/config";

test("production rejects missing, weak, and known JWT secrets", () => {
  assert.throws(() => resolveJwtSecret(undefined, "production"), /JWT_SECRET/);
  assert.throws(() => resolveJwtSecret("change-me", "production"), /JWT_SECRET/);
  assert.throws(
    () => resolveJwtSecret("replace-with-a-long-random-secret", "production"),
    /JWT_SECRET/,
  );
  assert.throws(() => resolveJwtSecret("short", "production"), /JWT_SECRET/);
  assert.equal(resolveJwtSecret("s".repeat(48), "production"), "s".repeat(48));
});

test("development uses an unpredictable ephemeral secret when none is configured", () => {
  const first = resolveJwtSecret(undefined, "development");
  const second = resolveJwtSecret(undefined, "development");
  assert.ok(first.length >= 32);
  assert.notEqual(first, second);
});
