import assert from "node:assert/strict";
import test from "node:test";
import { nanoid } from "nanoid";
import { db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { createClientDiagnostic } from "../src/repositories";

test("client diagnostics are validated and persisted with a report id", () => {
  runMigrations();
  const userId = `qa-diagnostic-${nanoid()}`;
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO users (id, email, name, avatar_url, google_sub, device_id, sync_code, is_device_only, currency, last_seen_at, created_at, updated_at)
      VALUES (?, ?, 'Diagnostic QA', NULL, ?, ?, NULL, 1, 'USD', ?, ?, ?)
    `,
  ).run(userId, `${userId}@example.test`, `google-${userId}`, `device-${userId}`, now, now, now);

  try {
    const result = createClientDiagnostic(userId, {
      kind: "notification-diagnostic",
      client: { pwa: { likelyInstalled: true }, browser: { platform: "Android" } },
      notificationTest: {
        attempted: true,
        permissionBefore: "default",
        permissionAfter: "granted",
        deliveryMethod: "service-worker",
        error: null,
      },
    }, { userAgent: "QA browser" });

    assert.match(result.reportId, /^diag_/);
    const row = db.prepare("SELECT payload_json FROM client_diagnostics WHERE id = ? AND user_id = ?")
      .get(result.reportId, userId) as { payload_json: string };
    const payload = JSON.parse(row.payload_json) as Record<string, any>;
    assert.equal(payload.client.pwa.likelyInstalled, true);
    assert.equal(payload.notificationTest.deliveryMethod, "service-worker");
    assert.equal(payload.server.userAgent, "QA browser");

    const bugResult = createClientDiagnostic(userId, {
      kind: "bug-report",
      client: { pwa: { likelyInstalled: true }, browser: { platform: "Android" } },
      notificationTest: null,
      userText: "The test button did not respond.",
    }, { userAgent: "QA browser" });
    const bugRow = db.prepare("SELECT payload_json FROM client_diagnostics WHERE id = ? AND user_id = ?")
      .get(bugResult.reportId, userId) as { payload_json: string };
    const bugPayload = JSON.parse(bugRow.payload_json) as Record<string, any>;
    assert.equal(bugPayload.kind, "bug-report");
    assert.equal(bugPayload.userText, "The test button did not respond.");
  } finally {
    db.prepare("DELETE FROM client_diagnostics WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
});
