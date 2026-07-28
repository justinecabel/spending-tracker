import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter } from "../src/security-limits";

test("fixed-window limits reject excess attempts and reset after the window", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.deepEqual(limiter.consume("client", 0), { allowed: true });
  assert.deepEqual(limiter.consume("client", 100), { allowed: true });
  assert.deepEqual(limiter.consume("client", 200), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(limiter.consume("client", 1_000), { allowed: true });
});
