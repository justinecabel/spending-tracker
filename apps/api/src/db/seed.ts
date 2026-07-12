import { nanoid } from "nanoid";
import { db } from "./client";
import { runMigrations } from "./migrate";

runMigrations();

const now = new Date().toISOString();
const userId = "demo-user";

db.prepare(
  `
    INSERT OR IGNORE INTO users (id, email, name, avatar_url, google_sub, device_id, is_device_only, currency, last_seen_at, created_at, updated_at)
    VALUES (@id, @email, @name, @avatarUrl, @googleSub, NULL, 0, @currency, @lastSeenAt, @createdAt, @updatedAt)
  `,
).run({
  id: userId,
  email: "demo@example.com",
  name: "Demo User",
  avatarUrl: null,
  googleSub: "demo-google-sub",
  currency: "USD",
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
});

const categories = [
  { name: "Food", kind: "expense", color: "#16A34A", icon: "utensils", isSystem: 0 },
  { name: "Transport", kind: "expense", color: "#2563EB", icon: "car", isSystem: 0 },
  { name: "Other", kind: "expense", color: "#475569", icon: "circle", isSystem: 1 },
  { name: "Trashed", kind: "expense", color: "#991B1B", icon: "archive", isSystem: 1 },
];

for (const [index, category] of categories.entries()) {
  db.prepare(
    `
      INSERT OR IGNORE INTO categories (id, user_id, name, kind, color, icon, is_system, sort_order, archived, created_at, updated_at)
      VALUES (@id, @userId, @name, @kind, @color, @icon, @isSystem, @sortOrder, 0, @createdAt, @updatedAt)
    `,
  ).run({
    id: `${category.kind}-${index}`,
    userId,
    name: category.name,
    kind: category.kind,
    color: category.color,
    icon: category.icon,
    isSystem: category.isSystem,
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  });
}

const foodCategory = db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = ?").get(userId, "Food") as { id: string } | undefined;
if (foodCategory) {
  db.prepare(
    `
      INSERT OR IGNORE INTO transactions (id, user_id, category_id, amount, kind, occurred_at, note, merchant, client_id, created_at, updated_at, deleted_at)
      VALUES (@id, @userId, @categoryId, @amount, @kind, @occurredAt, @note, @merchant, @clientId, @createdAt, @updatedAt, NULL)
    `,
  ).run({
    id: nanoid(),
    userId,
    categoryId: foodCategory.id,
    amount: 23.5,
    kind: "expense",
    occurredAt: now,
    note: "Lunch",
    merchant: "Cafe",
    clientId: "seed-expense",
    createdAt: now,
    updatedAt: now,
  });
}
