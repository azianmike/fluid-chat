import nodemailer from "nodemailer";

type EmailInput = {
  to: string;
  subject: string;
  text: string;
};

export async function sendEmail(input: EmailInput) {
  if (!process.env.SMTP_HOST) {
    console.info("Email skipped because SMTP_HOST is not configured", input);
    return { delivered: false, reason: "smtp_not_configured" };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      : undefined
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "OpenChat <noreply@example.com>",
    ...input
  });

  return { delivered: true };
}
