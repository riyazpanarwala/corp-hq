import { createHash, randomBytes } from "crypto";
import { after } from "next/server";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { handleApiError } from "@/lib/auth";
import { ForgotPasswordSchema } from "@/lib/validations";
import { consume, getClientIp, peek } from "@/lib/rateLimit";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const MIN_RESPONSE_TIME_MS = 400;
const GENERIC_MESSAGE = "If an active account exists for that email, a password reset link has been sent.";

export async function POST(request) {
  const startedAt = Date.now();
  const rateLimitKey = `forgot-password:ip:${getClientIp(request)}`;
  const gate = peek(rateLimitKey);

  if (!gate.allowed) {
    return Response.json(
      { error: "Too many reset requests. Please try again later.", retryAfter: gate.retryAfter },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  try {
    const { email } = ForgotPasswordSchema.parse(await request.json());
    const normalizedEmail = email.toLowerCase().trim();
    const appOrigin = getCanonicalAppOrigin();
    consume(rateLimitKey);

    const user = await db.user.findUnique({
      where: { email: normalizedEmail, isActive: true },
      select: { id: true, email: true, name: true },
    });

    if (user) {
      after(() => deliverPasswordReset(user, appOrigin));
    }

    await waitForMinimumResponseTime(startedAt);
    return Response.json({ message: GENERIC_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}

async function deliverPasswordReset(user, appOrigin) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  let resetRecord = null;

  try {
    resetRecord = await db.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      return tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
        select: { id: true },
      });
    });

    const resetUrl = new URL(`/reset-password?token=${encodeURIComponent(token)}`, appOrigin).toString();
    await sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl });
  } catch (error) {
    if (resetRecord) {
      await db.passwordResetToken.deleteMany({ where: { id: resetRecord.id } }).catch(() => undefined);
    }
    const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
    console.error(`[Password reset delivery] Failed (${code})`);
  }
}

function getCanonicalAppOrigin() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!configuredUrl) throw new Error("NEXT_PUBLIC_APP_URL must be configured");

  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL must be an absolute URL");
  }

  const allowedProtocol = url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  if (!allowedProtocol || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_APP_URL must be a canonical origin");
  }

  return url.origin;
}

async function waitForMinimumResponseTime(startedAt) {
  const remaining = MIN_RESPONSE_TIME_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
