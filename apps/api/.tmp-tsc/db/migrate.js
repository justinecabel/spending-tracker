import { db } from "./client";
export function runMigrations() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT NOT NULL,
      avatar_url TEXT,
      google_sub TEXT UNIQUE,
      device_id TEXT UNIQUE,
      sync_code TEXT UNIQUE,
      is_device_only INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('expense', 'income')),
      color TEXT NOT NULL,
      icon TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      amount REAL NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('expense', 'income')),
      occurred_at TEXT NOT NULL,
      note TEXT,
      merchant TEXT,
      client_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_user_client_id
      ON transactions(user_id, client_id)
      WHERE client_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category_id TEXT,
      month TEXT NOT NULL,
      amount REAL NOT NULL,
      rollover INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_scope
      ON budgets(user_id, IFNULL(category_id, '__overall__'), month);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transfer_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
    const userColumns = db.prepare("PRAGMA table_info(users)").all();
    if (!userColumns.some((column) => column.name === "device_id")) {
        db.exec("ALTER TABLE users ADD COLUMN device_id TEXT;");
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id) WHERE device_id IS NOT NULL;");
    }
    if (!userColumns.some((column) => column.name === "is_device_only")) {
        db.exec("ALTER TABLE users ADD COLUMN is_device_only INTEGER NOT NULL DEFAULT 0;");
    }
    if (!userColumns.some((column) => column.name === "sync_code")) {
        db.exec("ALTER TABLE users ADD COLUMN sync_code TEXT;");
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sync_code ON users(sync_code) WHERE sync_code IS NOT NULL;");
    }
    else {
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sync_code ON users(sync_code) WHERE sync_code IS NOT NULL;");
    }
    if (!userColumns.some((column) => column.name === "last_seen_at")) {
        db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT;");
        db.exec("UPDATE users SET last_seen_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE last_seen_at IS NULL;");
        db.exec("CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at);");
    }
    else {
        db.exec("CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at);");
    }
    const categoryColumns = db.prepare("PRAGMA table_info(categories)").all();
    if (!categoryColumns.some((column) => column.name === "is_system")) {
        db.exec("ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;");
    }
}
