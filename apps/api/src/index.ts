import { pruneStaleData } from "./auth";
import { config } from "./config";
import { app } from "./app";
import { runMigrations } from "./db/migrate";
import { createRealtimeServer } from "./realtime";

runMigrations();
runCleanup();
const cleanupTimer = setInterval(runCleanup, config.cleanupIntervalHours * 60 * 60 * 1000);
cleanupTimer.unref();

const server = createRealtimeServer(app);

server.listen(config.port, () => {
  console.log(`API listening on ${config.apiBaseUrl}`);
});

function runCleanup() {
  try {
    const deletedAccounts = pruneStaleData();
    if (deletedAccounts > 0) {
      console.log(`Deleted ${deletedAccounts} expired account(s)`);
    }
  } catch (error) {
    console.error("Account cleanup failed", error);
  }
}
