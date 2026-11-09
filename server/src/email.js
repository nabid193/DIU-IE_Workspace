export async function sendPasswordResetEmail({ to, resetUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    throw new Error("Password-reset email is not configured. Set RESEND_API_KEY and MAIL_FROM.");
  }

  const safeUrl = String(resetUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Reset your DIU I&E Workspace password",
      text: [
        "We received a request to reset your DIU I&E Workspace password.",
        "",
        `Use this one-time link within 30 minutes: ${safeUrl}`,
        "",
        "If you did not request a password reset, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#20242b;max-width:560px;margin:0 auto">
          <h2 style="color:#176dca">Reset your workspace password</h2>
          <p>We received a request to reset your DIU I&amp;E Workspace password.</p>
          <p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#176dca;color:#fff;text-decoration:none;border-radius:8px">Choose a new password</a></p>
          <p>This one-time link expires in 30 minutes.</p>
          <p>If you did not request a password reset, you can ignore this email. Your password will not change.</p>
          <p style="color:#777;font-size:12px">DIU Department of Innovation &amp; Entrepreneurship Workspace</p>
        </div>
      `,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || `Email provider returned HTTP ${response.status}.`);
  }

  return result;
}
