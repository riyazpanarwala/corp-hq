// server.js  — Custom Next.js server
// Runs: auto-migration → Socket.io → cron → listen
// Usage: node server.js  (replaces `next dev` / `next start`)

const { createServer } = require("http");
const { execSync }     = require("child_process");
const path             = require("path");
const next             = require("next");

const dev  = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "3000", 10);

// ── 1. Auto-migrate ────────────────────────────────────────────
function runMigrations() {
  console.log("📦  Checking Prisma migrations…");
  try {
    // migrate deploy: applies pending migrations, idempotent, never drops data
    execSync("npx prisma migrate deploy", { stdio: "inherit" });
    console.log("✅  Migrations up to date.");
  } catch (err) {
    if (dev) {
      console.warn("⚠️   migrate deploy failed — falling back to db push (dev only)");
      execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });
    } else {
      console.error("❌  Migration failed. Exiting.");
      process.exit(1);
    }
  }
}

// ── 2. Bootstrap ───────────────────────────────────────────────
async function main() {
  runMigrations();

  const app    = next({ dev, dir: __dirname });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((req, res) => handle(req, res));

  // Attach Socket.io
  const { initSocket } = require("./src/lib/socket");
  initSocket(httpServer);
  console.log("🔌  Socket.io attached.");

  // Auto-checkout cron — every 15 minutes
  const { attendanceService } = require("./src/services/attendanceService");
  setInterval(async () => {
    try {
      const n = await attendanceService.autoCheckoutOverdue();
      if (n > 0) console.log(`[Cron] Auto-checked out ${n} records`);
    } catch (e) {
      console.error("[Cron] Error:", e.message);
    }
  }, 15 * 60 * 1000);

  httpServer.listen(PORT, () => {
    console.log(`\n🚀  CorpHQ → http://localhost:${PORT}`);
    console.log(`    Mode: ${dev ? "development" : "production"}\n`);
  });
}

main().catch(err => { console.error(err); process.exit(1); });
