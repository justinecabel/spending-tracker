import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { pruneStaleData } from "../src/auth";

const NOW = new Date("2026-07-13T12:00:00.000Z");

test("cleanup removes empty accounts after 12 hours and inactive accounts after 12 months", () => {
  const database = createDatabase();
  insertUser(database, "fresh-empty", "2026-07-13T00:01:00.000Z", "2026-07-13T00:01:00.000Z");
  insertUser(database, "expired-empty", "2026-07-13T00:00:00.000Z", "2026-07-13T00:00:00.000Z");
  insertUser(database, "recent-active", "2025-01-01T00:00:00.000Z", "2026-07-13T11:00:00.000Z");
  insertUser(database, "inactive-active", "2025-01-01T00:00:00.000Z", "2025-07-13T12:00:00.000Z");
  insertTransaction(database, "recent-active");
  insertTransaction(database, "inactive-active");
  insertDependencies(database, "inactive-active");

  const removed = pruneStaleData({
    database,
    now: NOW,
    emptyAccountGraceHours: 12,
    inactiveAccountRetentionMonths: 12,
  });

  assert.equal(removed, 2);
  assert.equal(userExists(database, "fresh-empty"), true);
  assert.equal(userExists(database, "expired-empty"), false);
  assert.equal(userExists(database, "recent-active"), true);
  assert.equal(userExists(database, "inactive-active"), false);
  assert.equal(countForUser(database, "transactions", "inactive-active"), 0);
  assert.equal(countForUser(database, "budgets", "inactive-active"), 0);
  assert.equal(countForUser(database, "categories", "inactive-active"), 0);
  assert.equal(countForUser(database, "refresh_tokens", "inactive-active"), 0);
  assert.equal(countForUser(database, "transfer_tokens", "inactive-active"), 0);
  database.close();
});

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE budgets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE transfer_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
  `);
  return database;
}

function insertUser(database: DatabaseSync, id: string, createdAt: string, lastSeenAt: string) {
  database.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES (?, ?, ?)").run(id, createdAt, lastSeenAt);
}

function insertTransaction(database: DatabaseSync, userId: string) {
  database.prepare("INSERT INTO transactions (id, user_id, deleted_at) VALUES (?, ?, NULL)").run(`transaction-${userId}`, userId);
}

function insertDependencies(database: DatabaseSync, userId: string) {
  database.prepare("INSERT INTO budgets (id, user_id) VALUES (?, ?)").run(`budget-${userId}`, userId);
  database.prepare("INSERT INTO categories (id, user_id) VALUES (?, ?)").run(`category-${userId}`, userId);
  database.prepare("INSERT INTO refresh_tokens (id, user_id, expires_at) VALUES (?, ?, ?)").run(`refresh-${userId}`, userId, "2027-01-01T00:00:00.000Z");
  database.prepare("INSERT INTO transfer_tokens (id, user_id, expires_at, used_at) VALUES (?, ?, ?, NULL)").run(`transfer-${userId}`, userId, "2027-01-01T00:00:00.000Z");
}

function userExists(database: DatabaseSync, id: string) {
  return Boolean(database.prepare("SELECT id FROM users WHERE id = ?").get(id));
}

function countForUser(database: DatabaseSync, table: string, userId: string) {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`).get(userId) as { count: number }).count);
}
