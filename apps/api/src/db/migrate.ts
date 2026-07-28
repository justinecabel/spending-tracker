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
      device_secret_hash TEXT,
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

    CREATE INDEX IF NOT EXISTS idx_transactions_user_occurred_at
      ON transactions(user_id, occurred_at DESC);

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

    CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      merchant TEXT NOT NULL,
      amount REAL NOT NULL,
      due_at TEXT NOT NULL,
      reminder_days_before INTEGER,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      CHECK(reminder_days_before IS NULL OR reminder_days_before IN (0, 1, 3, 7))
    );

    CREATE INDEX IF NOT EXISTS idx_debts_user_due_at ON debts(user_id, paid_at, due_at);

    CREATE TABLE IF NOT EXISTS countdowns (
      user_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      target_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS client_diagnostics (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_client_diagnostics_user_created_at
      ON client_diagnostics(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_client_diagnostics_created_at
      ON client_diagnostics(created_at);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      family_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transfer_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transfer_tokens_user_active
      ON transfer_tokens(user_id, used_at, expires_at);
  `);

  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "device_id")) {
    db.exec("ALTER TABLE users ADD COLUMN device_id TEXT;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id) WHERE device_id IS NOT NULL;");
  }

  if (!userColumns.some((column) => column.name === "is_device_only")) {
    db.exec("ALTER TABLE users ADD COLUMN is_device_only INTEGER NOT NULL DEFAULT 0;");
  }

  if (!userColumns.some((column) => column.name === "device_secret_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN device_secret_hash TEXT;");
  }

  if (!userColumns.some((column) => column.name === "sync_code")) {
    db.exec("ALTER TABLE users ADD COLUMN sync_code TEXT;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sync_code ON users(sync_code) WHERE sync_code IS NOT NULL;");
  } else {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sync_code ON users(sync_code) WHERE sync_code IS NOT NULL;");
  }

  // Preserve pairing codes created by the short-lived transfer-token version.
  // Once copied into users.sync_code, the code remains available until explicitly regenerated.
  db.exec(`
    UPDATE users
    SET sync_code = (
      SELECT transfer_tokens.token
      FROM transfer_tokens
      WHERE transfer_tokens.user_id = users.id
        AND transfer_tokens.used_at IS NULL
      ORDER BY transfer_tokens.created_at DESC
      LIMIT 1
    )
    WHERE users.sync_code IS NULL
      AND EXISTS (
        SELECT 1
        FROM transfer_tokens
        WHERE transfer_tokens.user_id = users.id
          AND transfer_tokens.used_at IS NULL
      );
  `);

  if (!userColumns.some((column) => column.name === "last_seen_at")) {
    db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT;");
    db.exec("UPDATE users SET last_seen_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE last_seen_at IS NULL;");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at);");
  } else {
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users(last_seen_at);");
  }

  const categoryColumns = db.prepare("PRAGMA table_info(categories)").all() as Array<{ name: string }>;
  if (!categoryColumns.some((column) => column.name === "is_system")) {
    db.exec("ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;");
  }

  const refreshTokenColumns = db.prepare("PRAGMA table_info(refresh_tokens)").all() as Array<{ name: string }>;
  if (!refreshTokenColumns.some((column) => column.name === "used_at")) {
    db.exec("ALTER TABLE refresh_tokens ADD COLUMN used_at TEXT;");
  }
  if (!refreshTokenColumns.some((column) => column.name === "family_id")) {
    db.exec("ALTER TABLE refresh_tokens ADD COLUMN family_id TEXT;");
  }
  db.exec("UPDATE refresh_tokens SET family_id = id WHERE family_id IS NULL;");
  db.exec("CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_transfer_tokens_user_active ON transfer_tokens(user_id, used_at, expires_at);");
}
