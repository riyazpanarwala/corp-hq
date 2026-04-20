// server.js  — Custom Next.js server
// Runs: auto-migration → Socket.io → cron → listen
// Usage: node server.js  (replaces `next dev` / `next start`)

const { createServer } = require("http");
const { execSync }     = require("child_process");
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
      // MINOR FIX: Previously fell back to `db push --accept-data-loss`
      // unconditionally in dev, which can silently DROP columns/tables on
      // schema conflicts. Now this fallback requires an explicit opt-in via
      // ALLOW_DB_PUSH=true so developers are never surprised by data loss.
      if (process.env.ALLOW_DB_PUSH === "true") {
        console.warn(
          "⚠️   migrate deploy failed — falling back to db push (ALLOW_DB_PUSH=true).\n" +
          "    WARNING: This may DROP columns or tables that conflict with the schema.\n" +
          "    Never use ALLOW_DB_PUSH=true if you have data you care about.",
        );
        execSync("npx prisma db push --accept-data-loss", { stdio: "inherit" });
      } else {
        console.error(
          "❌  Migration failed in dev mode.\n" +
          "    To fall back to db push (DANGEROUS — may drop data), set ALLOW_DB_PUSH=true.\n" +
          "    To create a new migration, run: npm run db:migrate\n" +
          "    To check migration status, run: npm run db:status",
        );
        process.exit(1);
      }
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
