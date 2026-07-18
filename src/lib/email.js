import nodemailer from "nodemailer";

function getTransporter() {
  const port = Number(process.env.SMTP_PORT || 587);

  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
    throw new Error("SMTP_HOST and SMTP_FROM must be configured");
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export async function sendPasswordResetEmail({ email, name, resetUrl }) {
  if (process.env.NODE_ENV !== "production" && !process.env.SMTP_HOST) {
    console.info(`[Password reset] ${email}: ${resetUrl}`);
    return;
  }

  const safeResetUrl = escapeHtml(resetUrl);

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Reset your CorpHQ password",
    text: `Hi ${name},\n\nUse this link to reset your CorpHQ password:\n${resetUrl}\n\nThis link expires in 30 minutes and can only be used once. If you did not request it, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:560px">
        <h2 style="color:#111827">Reset your CorpHQ password</h2>
        <p>Hi ${escapeHtml(name)},</p>
        <p>We received a request to reset your password.</p>
        <p><a href="${safeResetUrl}" style="display:inline-block;padding:12px 20px;background:#4f8ef7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Reset password</a></p>
        <p>This link expires in 30 minutes and can only be used once.</p>
        <p style="color:#6b7280;font-size:13px">If you did not request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
