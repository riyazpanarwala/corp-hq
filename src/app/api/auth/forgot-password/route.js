import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { handleApiError } from "@/lib/auth";
import { ForgotPasswordSchema } from "@/lib/validations";
import { consume, getClientIp, peek, MAX_ATTEMPTS } from "@/lib/rateLimit";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const GENERIC_MESSAGE = "If an active account exists for that email, a password reset link has been sent.";

export async function POST(request) {
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
    consume(rateLimitKey);

    const user = await db.user.findUnique({
      where: { email: normalizedEmail, isActive: true },
      select: { id: true, email: true, name: true },
    });

    if (user) {
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      const resetRecord = await db.$transaction(async (tx) => {
        await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
        return tx.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
          select: { id: true },
        });
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
      const resetUrl = `${appUrl.replace(/\/$/, "")}/reset-password?token=${token}`;

      try {
        await sendPasswordResetEmail({ email: user.email, name: user.name, resetUrl });
      } catch (mailError) {
        await db.passwordResetToken.deleteMany({ where: { id: resetRecord.id } });
        console.error("[Password reset email]", mailError);
      }
    }

    return Response.json({ message: GENERIC_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
