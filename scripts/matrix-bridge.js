/**
 * scripts/matrix-bridge.js
 * 
 * Local Matrix COSEC CENTRA -> CorpHQ Sync Bridge
 * 
 * Use this script on your local office network if your Matrix COSEC CENTRA
 * does NOT have the paid "Web API / HTTP Push" license enabled.
 * 
 * Modes supported:
 * 1. CSV / Folder Watcher Mode (Default, Zero-Config):
 *    Watches the folder where COSEC CENTRA auto-exports daily punch files
 *    and forwards new punches to CorpHQ.
 * 
 * 2. SQL Server Mode:
 *    Queries the local MS SQL Server database of COSEC CENTRA (table MX_Events)
 *    for new punches and forwards them to CorpHQ.
 * 
 * Usage:
 *   node scripts/matrix-bridge.js --mode=csv --path="C:\\MatrixExport\\punches.csv"
 *   node scripts/matrix-bridge.js --mode=test
 */

const fs = require("fs");
const path = require("path");

const CORPHQ_URL = process.env.CORPHQ_URL || "http://localhost:3000";
const MATRIX_WEBHOOK_SECRET = process.env.MATRIX_WEBHOOK_SECRET;

if (require.main === module && !MATRIX_WEBHOOK_SECRET) {
  console.error("[MatrixBridge] Error: MATRIX_WEBHOOK_SECRET environment variable is required.");
  process.exit(1);
}

const WEBHOOK_ENDPOINT = `${CORPHQ_URL.replace(/\/$/, "")}/api/integrations/matrix`;

/**
 * Sends one or more punch events to CorpHQ's Webhook.
 * Returns true if the webhook accepted the payload, false otherwise.
 */
async function sendPunchesToCorpHQ(punches) {
  if (!punches || (Array.isArray(punches) && punches.length === 0)) return false;

  const payload = Array.isArray(punches) ? punches : [punches];

  try {
    const res = await fetch(WEBHOOK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Matrix-Secret": MATRIX_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    const allAccepted = data.success === true && Array.isArray(data.results)
      && data.results.length === payload.length && data.results.every(result => result.success === true);
    if (!res.ok || !allAccepted) {
      console.error(`[MatrixBridge] Webhook failed (${res.status}):`, data.error || data);
      return false;
    } else {
      console.log(`[MatrixBridge] Synced ${payload.length} punch(es) -> CorpHQ:`, {
        processed: data.processed,
        duplicates: data.duplicates,
        unmapped: data.unmapped,
      });
      return true;
    }
  } catch (err) {
    console.error(`[MatrixBridge] Network error reaching CorpHQ at ${WEBHOOK_ENDPOINT}:`, err.message);
    return false;
  }
}

/**
 * Parses a standard Matrix CSV line:
 * Format typically: UserID, EventDate, EventTime, Direction, DeviceID
 * e.g.: "10042,2026-10-08,09:15:22,IN,DOOR_01"
 */
function parseCsvLine(line) {
  const parts = line.split(",").map(p => p.trim().replace(/^"|"$/g, ""));
  if (parts.length < 3) return null;

  const [userId, dateOrDateTime, timeOrDirection, directionOrDevice, maybeDevice] = parts;

  // Handle combined datetime vs separate date and time
  let punchTime = dateOrDateTime;
  let direction = "AUTO";
  let deviceId = "MATRIX_SCANNER";

  if (timeOrDirection && timeOrDirection.includes(":")) {
    punchTime = `${dateOrDateTime} ${timeOrDirection}`;
    direction = directionOrDevice || "AUTO";
    deviceId = maybeDevice || "MATRIX_SCANNER";
  } else {
    direction = timeOrDirection || "AUTO";
    deviceId = directionOrDevice || "MATRIX_SCANNER";
  }

  return {
    UserID: userId,
    EventTime: punchTime,
    Direction: direction,
    DeviceID: deviceId,
  };
}

/**
 * CSV File Polling Mode
 */
function runCsvWatcher(filePath, intervalSeconds = 10) {
  console.log(`[MatrixBridge] Watching Matrix export file: ${filePath}`);
  console.log(`[MatrixBridge] Polling every ${intervalSeconds}s -> ${WEBHOOK_ENDPOINT}`);

  let lastLineCount = 0;

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf8").trim().split("\n");
    lastLineCount = existing.length;
    console.log(`[MatrixBridge] Existing file has ${lastLineCount} lines. Starting tail sync...`);
  }

  let isSyncing = false;

  setInterval(async () => {
    if (!fs.existsSync(filePath) || isSyncing) return;

    try {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (!content) {
        lastLineCount = 0;
        return;
      }

      const lines = content.split("\n");
      // If file was truncated or rotated to a smaller length, reset offset
      if (lines.length < lastLineCount) {
        console.log(`[MatrixBridge] File size decreased (${lines.length} < ${lastLineCount}). Resetting line pointer.`);
        lastLineCount = 0;
      }

      if (lines.length > lastLineCount) {
        const newLines = lines.slice(lastLineCount);
        const punches = newLines
          .map(l => parseCsvLine(l.trim()))
          .filter(Boolean);

        if (punches.length > 0) {
          isSyncing = true;
          const success = await sendPunchesToCorpHQ(punches);
          isSyncing = false;
          // Advance line count only when successful so failed attempts retry on next interval
          if (success) {
            lastLineCount = lines.length;
          }
        } else {
          lastLineCount = lines.length;
        }
      }
    } catch (err) {
      isSyncing = false;
      console.error("[MatrixBridge] Error reading export file:", err.message);
    }
  }, intervalSeconds * 1000);
}

/**
 * Self-test punch simulation
 */
async function runTestPunch(userId = "10042", direction = "AUTO") {
  console.log(`\n🧪 Simulating Matrix test punch for UserID=${userId}, Direction=${direction}...`);
  console.log(`   Posting to: ${WEBHOOK_ENDPOINT}`);

  await sendPunchesToCorpHQ({
    UserID: userId,
    EventTime: new Date().toISOString(),
    Direction: direction,
    DeviceID: "MATRIX_TEST_DEVICE",
  });
}

// CLI argument parsing
const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith("--mode="))?.split("=")[1] || "help";
const pathArg = args.find(a => a.startsWith("--path="))?.split("=")[1];
const userArg = args.find(a => a.startsWith("--user="))?.split("=")[1] || "10042";

if (require.main === module) {
  if (modeArg === "test") {
    runTestPunch(userArg);
  } else if (modeArg === "csv") {
    if (!pathArg) {
      console.error("❌ Please provide file path using --path=C:\\path\\to\\punches.csv");
      process.exit(1);
    }
    runCsvWatcher(pathArg);
  } else {
    console.log(`
  Matrix COSEC -> CorpHQ Integration Bridge
  -----------------------------------------
  Options:
    --mode=test --user=10042
        Send a single test punch to verify webhook connectivity.

    --mode=csv --path="C:\\MatrixExport\\punches.csv"
        Poll Matrix auto-exported CSV file and forward new punches.

  Configuration (Environment Variables):
    CORPHQ_URL            Default: http://localhost:3000
    MATRIX_WEBHOOK_SECRET Required shared webhook secret
  `);
  }
}

module.exports = { sendPunchesToCorpHQ, parseCsvLine, runCsvWatcher };
