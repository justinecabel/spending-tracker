import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const source = path.join(root, "apps", "api", "data", "spending-tracker.sqlite");
const target = path.join(root, "docker-data", "database", "spending-tracker.sqlite");
const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--replace");

if (!fs.existsSync(source)) {
  throw new Error(`Local development database was not found: ${source}`);
}

assertDockerApiStopped();

if (!confirmed && !dryRun) {
  throw new Error("Refusing to replace Docker data. Run: pnpm db:adopt-local-to-docker -- --replace (or use --dry-run first).");
}

console.log(`Source: ${source}`);
console.log(`Docker database: ${target}`);

if (dryRun) {
  console.log("Dry run complete. No database files were changed.");
  process.exit(0);
}

checkpoint(source);
fs.mkdirSync(path.dirname(target), { recursive: true });

if (fs.existsSync(target)) {
  checkpoint(target);
  const backupDirectory = path.join(path.dirname(target), "backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(backupDirectory, `spending-tracker-${timestamp}.sqlite`);
  fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  console.log(`Backed up Docker database to: ${backup}`);
}

fs.copyFileSync(source, target);
fs.rmSync(`${target}-wal`, { force: true });
fs.rmSync(`${target}-shm`, { force: true });
console.log("Docker database replaced. Start it with: docker compose up -d --build");

function checkpoint(file) {
  const database = new DatabaseSync(file);
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    database.close();
  }
}

function assertDockerApiStopped() {
  try {
    const runningApi = execFileSync("docker", ["compose", "ps", "api", "--status", "running", "-q"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (runningApi) {
      throw new Error("Docker API is running. Run `docker compose down` before adopting the local database.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Docker API is running")) {
      throw error;
    }
    throw new Error("Could not verify Docker API status. Ensure Docker is available and run `docker compose down` first.");
  }
}
