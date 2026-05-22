import nodemailer from "nodemailer";
import { detectEmailProvider } from "../lib/email-compose.js";
import {
  normalizeAppPassword,
  normalizeSmtpUser,
  validateSmtpUserForProvider,
  formatSmtpError,
} from "../lib/smtp-auth.js";

function oauthConfigured(smtp) {
  return !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim() &&
    smtp?.gmail?.oauth?.refreshToken
  );
}

function pickAppPasswordCreds(provider, smtp = {}) {
  const creds = provider === "outlook" ? smtp.outlook : smtp.gmail;
  if (creds?.user?.trim() && creds?.pass?.trim()) {
    return {
      user: normalizeSmtpUser(creds.user),
      pass: normalizeAppPassword(creds.pass),
    };
  }

  const envUser =
    provider === "outlook"
      ? process.env.SMTP_OUTLOOK_USER
      : process.env.SMTP_GMAIL_USER;
  const envPass =
    provider === "outlook"
      ? process.env.SMTP_OUTLOOK_PASS
      : process.env.SMTP_GMAIL_PASS;

  if (envUser?.trim() && envPass?.trim()) {
    return {
      user: normalizeSmtpUser(envUser),
      pass: normalizeAppPassword(envPass),
    };
  }

  return null;
}

function createGmailTransport(smtp) {
  if (oauthConfigured(smtp)) {
    const user = normalizeSmtpUser(smtp.gmail.user);
    return {
      transport: nodemailer.createTransport({
        service: "gmail",
        auth: {
          type: "OAuth2",
          user,
          clientId: process.env.GOOGLE_CLIENT_ID.trim(),
          clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
          refreshToken: smtp.gmail.oauth.refreshToken,
        },
      }),
      from: user,
      authMethod: "oauth2",
    };
  }

  const auth = pickAppPasswordCreds("gmail", smtp);
  if (!auth) {
    throw new Error(
      "Gmail is not configured. Use a 16-character App Password (works with Authenticator) or Connect with Google in the extension."
    );
  }

  validateSmtpUserForProvider("gmail", auth.user);
  return {
    transport: nodemailer.createTransport({
      service: "gmail",
      auth,
    }),
    from: auth.user,
    authMethod: "app_password",
  };
}

function createOutlookTransport(smtp) {
  const auth = pickAppPasswordCreds("outlook", smtp);
  if (!auth) {
    throw new Error(
      "Outlook is not configured. Add Outlook address and App Password in the extension."
    );
  }
  validateSmtpUserForProvider("outlook", auth.user);
  return {
    transport: nodemailer.createTransport({
      host: process.env.SMTP_OUTLOOK_HOST || "smtp-mail.outlook.com",
      port: Number(process.env.SMTP_OUTLOOK_PORT || 587),
      secure: false,
      requireTLS: true,
      auth,
    }),
    from: auth.user,
    authMethod: "app_password",
  };
}

function createTransport(provider, smtp = {}) {
  if (provider === "outlook") {
    return createOutlookTransport(smtp);
  }
  return createGmailTransport(smtp);
}

export async function sendContactEmail({ to, subject, body, provider, smtp }) {
  try {
    const { transport, from } = createTransport(provider, smtp);
    const info = await transport.sendMail({
      from,
      to: String(to).trim(),
      subject: subject || "(no subject)",
      text: body || "",
    });
    return { messageId: info.messageId, provider, from };
  } catch (err) {
    throw new Error(formatSmtpError(err, provider));
  }
}

export async function verifySmtpLogin(provider, smtp) {
  try {
    const { transport } = createTransport(provider, smtp);
    await transport.verify();
    return { ok: true, provider };
  } catch (err) {
    throw new Error(formatSmtpError(err, provider));
  }
}

export function resolveProviderForAddress(email) {
  return detectEmailProvider(email);
}

export function normalizeSmtpBody(raw = {}) {
  const smtp = raw.smtp || {};
  const normPass = (block, provider) => {
    if (!block || typeof block !== "object") return null;
    const user = normalizeSmtpUser(block.user);
    const pass = block.pass ? normalizeAppPassword(block.pass) : "";
    if (!user) return null;
    if (block.oauth?.refreshToken) {
      return {
        user,
        oauth: { refreshToken: String(block.oauth.refreshToken).trim() },
        authMethod: "oauth2",
      };
    }
    if (!pass) return null;
    try {
      validateSmtpUserForProvider(provider, user);
    } catch {
      return null;
    }
    return { user, pass, authMethod: "app_password" };
  };

  return {
    gmail: normPass(smtp.gmail, "gmail"),
    outlook: normPass(smtp.outlook, "outlook"),
  };
}
