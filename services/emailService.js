const nodemailer = require("nodemailer");
const { Resend } = require("resend");

let resendClient = null;
let smtpTransporter = null;

function getResendClient() {
  if (process.env.RESEND_API_KEY) {
    if (!resendClient) {
      resendClient = new Resend(process.env.RESEND_API_KEY);
    }
    return resendClient;
  }
  return null;
}

function getSmtpTransporter() {
  if (process.env.EMAIL && process.env.EMAIL_PASSWORD) {
    if (!smtpTransporter) {
      smtpTransporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || "gmail",
        host: process.env.SMTP_HOST || undefined,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.EMAIL,
          pass: process.env.EMAIL_PASSWORD,
        },
      });
    }
    return smtpTransporter;
  }
  return null;
}

/**
 * Send Password Reset OTP Email
 * Prioritizes Resend HTTPS API (safe on Render's free tier with blocked SMTP ports).
 * Falls back to Nodemailer SMTP when Resend API key is not configured.
 *
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit numeric OTP code
 * @returns {Promise<{ success: boolean, provider?: string, messageId?: string, error?: string }>}
 */
async function sendOTP(email, otp) {
  if (!email || !otp) {
    return { success: false, error: "Recipient email and OTP are required" };
  }

  const resend = getResendClient();
  const smtp = getSmtpTransporter();

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
          .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
          .header { text-align: center; margin-bottom: 24px; }
          .logo { font-size: 20px; font-weight: 800; color: #1976D2; letter-spacing: -0.5px; }
          .title { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 12px; margin-bottom: 8px; }
          .desc { font-size: 14px; color: #475569; line-height: 1.5; margin-bottom: 24px; }
          .otp-box { background: #f0f7ff; border: 2px dashed #90caf9; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px; }
          .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1976D2; margin: 0; font-family: monospace; }
          .warning { font-size: 12px; color: #64748b; line-height: 1.6; border-top: 1px solid #f1f5f9; padding-top: 16px; }
          .footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 24px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🔥 Smart Gas Monitoring</div>
            <div class="title">Password Reset Verification</div>
          </div>
          <p class="desc">
            We received a request to reset the password for your Smart Gas Monitoring account. Use the verification code below to complete your reset:
          </p>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          <div class="warning">
            • This verification code is valid for <strong>10 minutes</strong>.<br>
            • Never share this code with anyone. Our team will never ask for your code.<br>
            • If you did not request this code, your account is safe and you can safely ignore this email.
          </div>
          <div class="footer">
            &copy; Smart Gas Monitoring Industrial Safety System
          </div>
        </div>
      </body>
    </html>
  `;

  // 1. Try Resend HTTPS API (Recommended on Render / Cloud)
  if (resend) {
    try {
      const fromAddress = process.env.EMAIL_FROM || "Smart Gas Monitoring <onboarding@resend.dev>";
      const { data, error } = await resend.emails.send({
        from: fromAddress,
        to: email,
        subject: "Smart Gas Monitoring - Password Reset Code",
        html: htmlContent,
      });

      if (error) {
        console.error(`❌ [EmailService] Resend API Error (${error.name}):`, error.message);
        // If Resend failed and SMTP is configured, fall through to SMTP
        if (!smtp) {
          return { success: false, error: error.message };
        }
      } else {
        console.log(`✅ [EmailService] OTP email dispatched via Resend HTTPS to ${email}`);
        return { success: true, provider: "resend", messageId: data?.id };
      }
    } catch (err) {
      console.error("❌ [EmailService] Resend Exception:", err.message);
      if (!smtp) {
        return { success: false, error: err.message };
      }
    }
  }

  // 2. Fallback to Nodemailer SMTP (Works locally or on servers with open SMTP ports)
  if (smtp) {
    try {
      const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL;
      const info = await smtp.sendMail({
        from: fromAddress,
        to: email,
        subject: "Smart Gas Monitoring - Password Reset Code",
        html: htmlContent,
      });

      console.log(`✅ [EmailService] OTP email sent via SMTP to ${email}`);
      return { success: true, provider: "smtp", messageId: info.messageId };
    } catch (err) {
      console.error(`❌ [EmailService] SMTP Send Error (${err.code || err.message})`);
      return { success: false, error: err.message };
    }
  }

  // 3. Neither email provider is configured
  console.warn("⚠️ [EmailService] No email provider configured (Neither RESEND_API_KEY nor EMAIL/EMAIL_PASSWORD set).");
  return {
    success: false,
    error: "Email delivery service is currently not configured on the server. Please contact administrator.",
  };
}

module.exports = {
  sendOTP,
  getResendClient,
  getSmtpTransporter,
};