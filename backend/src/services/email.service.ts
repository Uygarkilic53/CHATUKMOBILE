import 'dotenv/config';
import nodemailer, { type Transporter } from 'nodemailer';

const host = process.env.MAIL_DOG_HOST || 'mail.maildog.io';
const port = Number(process.env.MAIL_DOG_PORT) || 2525;
const user = process.env.MAIL_DOG_USERNAME;
const pass = process.env.MAIL_DOG_PASSWORD;

export const maildogTransporter = nodemailer.createTransport({
  host,
  port,
  auth: {
    user,
    pass,
  },
});

/**
 * Returns a nodemailer transporter configured with Mailtrap SMTP credentials.
 * Evaluates process.env dynamically at call time to guarantee environment variables are loaded.
 */
export function getMailtrapTransporter(): Transporter {
  const mailtrapHost =
    process.env.mailtraphost ||
    process.env.MAILTRAP_HOST ||
    process.env.MAIL_DOG_HOST ||
    'sandbox.smtp.mailtrap.io';

  const mailtrapPort = Number(
    process.env.mailtrapport ||
    process.env.MAILTRAP_PORT ||
    process.env.MAIL_DOG_PORT ||
    2525
  );

  const mailtrapUser =
    process.env.mailtrapusername ||
    process.env.MAILTRAP_USERNAME ||
    process.env.MAIL_DOG_USERNAME ||
    '23745bb1ae2d72';

  const mailtrapPass =
    process.env.mailtrappassword ||
    process.env.MAILTRAP_PASSWORD ||
    process.env.MAIL_DOG_PASSWORD ||
    'ad116982a00afc';

  return nodemailer.createTransport({
    host: mailtrapHost,
    port: mailtrapPort,
    auth: {
      user: mailtrapUser,
      pass: mailtrapPass,
    },
  });
}

// Transparent Proxy export for backward compatibility and test suites
export const mailtrapTransporter: Transporter = new Proxy({} as Transporter, {
  get(_target, prop, receiver) {
    const transporter = getMailtrapTransporter();
    const value = Reflect.get(transporter, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(transporter);
    }
    return value;
  },
});

export interface ContactSubmissionPayload {
  name: string;
  email: string;
  category: string;
  message: string;
  attachments?: string[];
}

export async function sendContactEmail(payload: ContactSubmissionPayload): Promise<void> {
  const attachmentLinksHtml = payload.attachments?.length
    ? `<h3>Attached Screenshots / Bug Media</h3>
       <div style="display:flex;gap:10px;flex-wrap:wrap;">
         ${payload.attachments
           .map(
             (url, idx) =>
               `<div style="margin-bottom:12px;">
                  <a href="${url}" target="_blank">Screenshot #${idx + 1}</a><br/>
                  <img src="${url}" alt="Attachment ${idx + 1}" style="max-width:280px;border-radius:8px;border:1px solid #ddd;margin-top:4px;" />
                </div>`
           )
           .join('')}
       </div>`
    : '<p><em>No screenshots attached.</em></p>';

  await maildogTransporter.sendMail({
    from: `"${payload.name} (via Chatuk App)" <support@chatuk.internal>`,
    replyTo: payload.email,
    to: 'dev-team@chatuk.internal',
    subject: `[Chatuk ${payload.category || 'Support'}] from ${payload.name}`,
    text: `Sender: ${payload.name} (${payload.email})\nCategory: ${payload.category}\n\nMessage:\n${payload.message}\n\nAttachments:\n${payload.attachments?.join('\n') || 'None'}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 12px; background: #ffffff;">
        <h2 style="color: #6366F1; margin-top: 0;">New Contact / Bug Report</h2>
        <p><strong>Name:</strong> ${payload.name}</p>
        <p><strong>User Email:</strong> <a href="mailto:${payload.email}">${payload.email}</a></p>
        <p><strong>Category:</strong> <span style="background: #eef2ff; color: #4338ca; padding: 3px 8px; border-radius: 4px; font-weight: bold;">${payload.category}</span></p>
        <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 16px 0;" />
        <h3 style="color: #333;">Message:</h3>
        <p style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 8px; color: #1e293b; line-height: 1.5;">${payload.message}</p>
        <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 16px 0;" />
        ${attachmentLinksHtml}
        <footer style="margin-top: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f0f0f0; padding-top: 12px;">
          Sent from Chatuk Mobile App via MailDog Sandbox
        </footer>
      </div>
    `,
  });
}

export interface PasswordResetEmailPayload {
  to: string;
  userName?: string;
  resetUrl: string;
  token: string;
}

export async function sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<void> {
  const recipientName = payload.userName ? payload.userName.trim() : 'Chatuk User';
  const deepLink = `chatuk://reset-password?token=${encodeURIComponent(payload.token)}`;

  const info = await mailtrapTransporter.sendMail({
    from: '"Chatuk Security" <security@chatuk.internal>',
    to: payload.to,
    subject: 'Reset Your Chatuk Password',
    text: `Hello ${recipientName},\n\nWe received a request to reset the password for your Chatuk account.\n\nClick the link below to choose a new password:\n${payload.resetUrl}\n\nAlternatively, if you are using the Chatuk Mobile App on your device, you can use this link:\n${deepLink}\n\nFor your security, this reset link will expire in 1 hour.\n\nIf you did not request this password reset, please ignore this email or contact support. Your password will remain unchanged.\n\nBest regards,\nThe Chatuk Team`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Reset Your Password</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0F172A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F8FAFC;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0F172A; padding: 32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" style="max-width: 540px; background-color: #1E293B; border-radius: 16px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);" cellpadding="0" cellspacing="0">
                <!-- Header with Brand Accent -->
                <tr>
                  <td style="background: linear-gradient(135deg, #6366F1 0%, #A855F7 100%); padding: 24px; text-align: center;">
                    <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Chatuk</h1>
                    <p style="margin: 4px 0 0 0; color: rgba(255, 255, 255, 0.85); font-size: 13px;">Secure & Private Messaging</p>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding: 32px 28px;">
                    <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #F8FAFC;">Password Reset Request</h2>
                    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #94A3B8;">
                      Hello <strong style="color: #F8FAFC;">${recipientName}</strong>,
                    </p>
                    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #94A3B8;">
                      We received a request to reset the password for your Chatuk account (<span style="color: #C084FC; font-weight: 500;">${payload.to}</span>). Click the button below to choose a new password:
                    </p>

                    <!-- CTA Button -->
                    <div style="text-align: center; margin: 32px 0;">
                      <a href="${payload.resetUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #6366F1 0%, #A855F7 100%); color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 16px; letter-spacing: 0.2px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                        Reset Password
                      </a>
                    </div>

                    <!-- Direct Link Fallback -->
                    <div style="background-color: #131B2E; border: 1px solid #334155; border-radius: 8px; padding: 14px; margin: 24px 0;">
                      <p style="margin: 0 0 6px 0; font-size: 12px; color: #94A3B8; font-weight: 500;">Or copy and paste this link into your browser:</p>
                      <a href="${payload.resetUrl}" target="_blank" style="font-size: 13px; color: #818CF8; word-break: break-all; text-decoration: underline;">
                        ${payload.resetUrl}
                      </a>
                    </div>

                    <!-- App Deep Link Option -->
                    <p style="margin: 20px 0 0 0; font-size: 13px; color: #94A3B8; line-height: 1.5;">
                      On your mobile phone? <a href="${deepLink}" style="color: #C084FC; text-decoration: none; font-weight: 600;">Open in Chatuk App &rarr;</a>
                    </p>

                    <hr style="border: none; border-top: 1px solid #334155; margin: 28px 0 20px 0;" />

                    <!-- Security Notice -->
                    <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748B; line-height: 1.5;">
                      &#x23F1; This reset link will expire in <strong style="color: #94A3B8;">1 hour</strong> for your protection.
                    </p>
                    <p style="margin: 0; font-size: 13px; color: #64748B; line-height: 1.5;">
                      If you didn't ask to reset your password, you can safely ignore this message. Your password will remain unchanged.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #131B2E; padding: 20px 28px; text-align: center; border-top: 1px solid #334155;">
                    <p style="margin: 0; font-size: 12px; color: #64748B;">
                      Chatuk Inc. &bull; End-to-End Encrypted Communications
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
  });

  console.log('[EmailService] Password reset email dispatched via Mailtrap:', {
    messageId: info.messageId,
    accepted: info.accepted,
    response: info.response,
  });
}


