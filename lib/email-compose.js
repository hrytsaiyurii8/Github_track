/** Domains routed to Gmail web compose */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Domains routed to Outlook web compose */
const OUTLOOK_DOMAINS = new Set([
  "outlook.com",
  "outlook.co.uk",
  "outlook.fr",
  "outlook.de",
  "outlook.es",
  "outlook.it",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.es",
  "hotmail.it",
  "live.com",
  "live.co.uk",
  "live.fr",
  "live.de",
  "msn.com",
]);

/**
 * @returns {"gmail"|"outlook"|null}
 */
export function detectEmailProvider(email) {
  if (!email || typeof email !== "string") return null;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  if (GMAIL_DOMAINS.has(domain)) return "gmail";
  if (OUTLOOK_DOMAINS.has(domain)) return "outlook";
  return null;
}

export function getProviderLabel(provider) {
  if (provider === "gmail") return "Gmail";
  if (provider === "outlook") return "Outlook";
  return "Email";
}

/**
 * Build web compose URL for Gmail or Outlook.
 * @param {string} email
 * @param {"gmail"|"outlook"} provider
 * @param {{ subject?: string, body?: string }} [opts]
 */
export function buildComposeUrl(email, provider, opts = {}) {
  if (provider === "gmail") {
    const params = new URLSearchParams({ view: "cm", fs: "1", to: email.trim() });
    if (opts.subject) params.set("su", opts.subject);
    if (opts.body) params.set("body", opts.body);
    return `https://mail.google.com/mail/?${params.toString()}`;
  }

  if (provider === "outlook") {
    const params = new URLSearchParams();
    params.set("to", email.trim());
    if (opts.subject) params.set("subject", opts.subject);
    if (opts.body) params.set("body", opts.body);
    return `https://outlook.live.com/mail/0/deeplink/compose?${params.toString()}`;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export function resolveComposeForEmail(email, opts = {}) {
  const provider = detectEmailProvider(email);
  if (!provider) {
    const domain = (email || "").split("@")[1] || "unknown";
    return {
      ok: false,
      error: `No supported web compose for @${domain}. Use a Gmail or Outlook address.`,
      domain,
    };
  }
  return {
    ok: true,
    provider,
    providerLabel: getProviderLabel(provider),
    url: buildComposeUrl(email, provider, opts),
  };
}
