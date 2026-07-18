import { Resend } from "resend";

function getResendConfig() {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    throw new Error("RESEND_API_KEY and RESEND_FROM must be configured");
  }

  return {
    client: new Resend(process.env.RESEND_API_KEY),
    from: process.env.RESEND_FROM,
  };
}

export async function sendPasswordResetEmail({ email, name, resetUrl }) {
  const { client, from } = getResendConfig();
  const safeResetUrl = escapeHtml(resetUrl);

  const { error } = await client.emails.send({
    from,
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

  if (error) {
    const resendError = new Error("Resend rejected the password-reset email");
    resendError.code = error.name || "RESEND_ERROR";
    throw resendError;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
