// src/app/api/integrations/matrix/route.js
import { matrixBiometricService } from "@/services/matrixBiometricService";
import { MatrixWebhookPayloadSchema } from "@/lib/validations";

/**
 * Extracts authorization secret token from Bearer header, custom header, or request body.
 *
 * @param {Request} request - Next.js Request object
 * @param {object} [body] - Parsed JSON body object
 * @returns {string|null} Extracted secret or null
 */
function extractSecret(request, body) {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const headerSecret = request.headers.get("x-matrix-secret") || request.headers.get("x-webhook-secret");
  if (headerSecret) return headerSecret.trim();

  if (body?.secret) return String(body.secret).trim();

  return null;
}

/**
 * GET handler: Returns health status and verification configuration of the Matrix biometric integration.
 *
 * @param {Request} request - Next.js Request object
 * @returns {Promise<Response>} JSON response with service status
 */
export async function GET(request) {
  const secret = extractSecret(request);
  const isAuthorized = matrixBiometricService.verifySecret(secret);
  const isConfigured = Boolean(process.env.MATRIX_WEBHOOK_SECRET);

  return Response.json({
    status: "ok",
    service: "Matrix COSEC Biometric Webhook",
    webhookConfigured: isConfigured,
    authorized: isAuthorized,
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST handler: Ingests Matrix COSEC biometric punches, validating webhook secret and payload schema.
 *
 * @param {Request} request - Next.js Request object with punch payload
 * @returns {Promise<Response>} JSON response with processing outcome and HTTP status
 */
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const secret = extractSecret(request, body);
    if (!matrixBiometricService.verifySecret(secret)) {
      return Response.json(
        { error: "Unauthorized: Invalid or missing webhook secret token" },
        { status: 401 }
      );
    }

    // Validate payload shape
    const parseResult = MatrixWebhookPayloadSchema.safeParse(body);
    if (!parseResult.success) {
      return Response.json({ error: "Invalid payload", issues: parseResult.error.issues }, { status: 400 });
    }

    const payloadToProcess = parseResult.data;
    // Strip secret before processing and storing in rawPayload
    if (payloadToProcess && typeof payloadToProcess === "object") {
      delete payloadToProcess.secret;
      if (Array.isArray(payloadToProcess)) {
        payloadToProcess.forEach(item => { if (item) delete item.secret; });
      } else if (Array.isArray(payloadToProcess.events)) {
        payloadToProcess.events.forEach(item => { if (item) delete item.secret; });
      }
    }

    const summary = await matrixBiometricService.processPayload(payloadToProcess);
    const status = summary.success ? 200 : summary.results.some(r => r.status === "ERROR") ? 503 : 422;
    return Response.json(summary, { status });
  } catch (err) {
    console.error("[MatrixWebhook] Unhandled error:", err);
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
