import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ApiError, handleApiError } from "@/lib/auth";
import { ResetPasswordSchema } from "@/lib/validations";
import { consume, getClientIp, peek } from "@/lib/rateLimit";

export async function POST(request) {
  const rateLimitKey = `reset-password:ip:${getClientIp(request)}`;
  const gate = peek(rateLimitKey);

  if (!gate.allowed) {
    return Response.json(
      { error: "Too many reset attempts. Please try again later.", retryAfter: gate.retryAfter },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  try {
    const { token, password } = ResetPasswordSchema.parse(await request.json());
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const resetToken = await db.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { isActive: true } } },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date() || !resetToken.user.isActive) {
      consume(rateLimitKey);
      throw new ApiError("This reset link is invalid or has expired.", 400, "INVALID_RESET_TOKEN");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();

    await db.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      if (consumed.count !== 1) {
        throw new ApiError("This reset link is invalid or has expired.", 400, "INVALID_RESET_TOKEN");
      }

      await tx.user.update({ where: { id: resetToken.userId }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: resetToken.userId } });
      await tx.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: now },
      });
    });

    return Response.json(
      { message: "Your password has been reset. You can now sign in with your new password." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err?.errors) return Response.json({ error: err.errors[0].message }, { status: 422 });
    return handleApiError(err);
  }
}
