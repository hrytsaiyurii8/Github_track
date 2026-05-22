import { detectEmailProvider } from "./email-compose.js";

/** Gmail/Outlook app passwords are often pasted with spaces — strip them */
export function normalizeAppPassword(pass) {
  return String(pass || "").replace(/\s+/g, "").trim();
}

export function normalizeSmtpUser(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmailAddress(email) {
  const e = normalizeSmtpUser(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Ensure SMTP login email matches the provider (Gmail sends via @gmail.com, etc.)
 */
export function validateSmtpUserForProvider(provider, userEmail) {
  const user = normalizeSmtpUser(userEmail);
  if (!user) {
    throw new Error(
      `${provider === "outlook" ? "Outlook" : "Gmail"} address is required.`
    );
  }
  if (!isValidEmailAddress(user)) {
    throw new Error(`"${userEmail}" is not a valid email address.`);
  }

  const detected = detectEmailProvider(user);
  if (provider === "gmail" && detected !== "gmail") {
    throw new Error(
      `Gmail account must be @gmail.com or @googlemail.com (you entered ${user}).`
    );
  }
  if (provider === "outlook" && detected !== "outlook") {
    throw new Error(
      `Outlook account must be @outlook.com, @hotmail.com, @live.com, etc. (you entered ${user}).`
    );
  }
  return user;
}

export function validateAppPassword(provider, pass, { required = true } = {}) {
  const normalized = normalizeAppPassword(pass);
  if (!normalized) {
    if (required) {
      throw new Error(
        `${provider === "outlook" ? "Outlook" : "Gmail"} App Password is required.`
      );
    }
    return "";
  }
  if (provider === "gmail" && normalized.length < 16) {
    throw new Error(
      "Gmail App Password must be 16 characters (spaces are removed automatically). Create one at https://myaccount.google.com/apppasswords"
    );
  }
  if (provider === "outlook" && normalized.length < 8) {
    throw new Error("Outlook App Password is too short.");
  }
  return normalized;
}

/**
 * User-friendly message for SMTP auth failures (535, BadCredentials).
 */
export function formatSmtpError(err, provider) {
  const raw = err?.message || String(err);
  const label = provider === "outlook" ? "Outlook" : "Gmail";

  if (
    /535|5\.7\.8|BadCredentials|Username and Password not accepted|EAUTH|Invalid login/i.test(
      raw
    )
  ) {
    if (provider === "gmail") {
      return [
        "Gmail did not accept your login.",
        "",
        "Check these exactly:",
        "• Gmail address must match the account (e.g. you@gmail.com).",
        "• Do not paste a 6-digit Authenticator code or 8-digit backup code — they cannot send email.",
        "• Use a 16-character App Password: https://myaccount.google.com/apppasswords",
        "• Or click Connect with Google in the extension (works with 2FA).",
        "• Click Test Gmail in Configuration before sending.",
      ].join("\n");
    }
    return [
      `${label} did not accept your login.`,
      "",
      "Use your full Outlook address and a Microsoft App Password from account security settings — not your regular password.",
    ].join("\n");
  }

  if (/self signed|certificate|UNABLE_TO_VERIFY/i.test(raw)) {
    return `${label} TLS error: ${raw}`;
  }

  return raw || `${label} SMTP error`;
}
