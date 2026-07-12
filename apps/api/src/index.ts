import { pruneStaleData } from "./auth";
import { config } from "./config";
import { app } from "./app";
import { runMigrations } from "./db/migrate";
import { createRealtimeServer } from "./realtime";

runMigrations();
pruneStaleData();

const server = createRealtimeServer(app);

server.listen(config.port, () => {
  console.log(`API listening on ${config.apiBaseUrl}`);
});
