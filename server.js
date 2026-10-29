import app from "./src/app.js";
import { env } from "./src/config/env.js";
import { connectDatabase, closeDatabase } from "./src/config/database.js";
import { scanWithClamAV } from "./src/services/malwareScan.js";
import { initializeStorage } from "./src/utils/fileStorage.js";
import { startCleanupWorker } from "./src/services/fileCleanup.js";
import { startMailWorker } from "./src/services/mail.js";
try { await connectDatabase(); await initializeStorage(); if (env.MALWARE_SCAN === "clamav") await scanWithClamAV(Buffer.alloc(0)); }
catch { console.error("Startup failed. Check MongoDB, indexes, private storage and scanner configuration."); process.exit(1); }
const stopMailWorker = startMailWorker();
const stopCleanupWorker = startCleanupWorker();
const server = app.listen(env.PORT, () => console.log(`Job Board API listening on http://localhost:${env.PORT}`));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(async () => { await Promise.all([stopMailWorker(), stopCleanupWorker()]); await closeDatabase(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
