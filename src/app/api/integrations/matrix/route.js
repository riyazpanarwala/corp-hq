// src/app/api/integrations/matrix/route.js
import { matrixBiometricService } from "@/services/matrixBiometricService";
import { MatrixWebhookPayloadSchema } from "@/lib/validations";

function extractSecret(request, body) {
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret");
  if (querySecret) return querySecret;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const headerSecret = request.headers.get("x-matrix-secret") || request.headers.get("x-webhook-secret");
  if (headerSecret) return headerSecret.trim();

  if (body?.secret) return String(body.secret).trim();

  return null;
}

// GET /api/integrations/matrix -- status / test endpoint
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

// POST /api/integrations/matrix -- webhook punch ingestion
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
    const payloadToProcess = parseResult.success ? parseResult.data : body;

    const summary = await matrixBiometricService.processPayload(payloadToProcess);
    return Response.json(summary, { status: 200 });
  } catch (err) {
    console.error("[MatrixWebhook] Unhandled error:", err);
    return Response.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
