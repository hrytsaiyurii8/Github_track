import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
  resolveServerLanHost,
  resolvePublicApiUrl,
  listLanIPv4s,
} from "./network.js";
import { deriveContactIp, normalizeArchiveIp } from "../lib/archive-ip.js";
import {
  sendContactEmail,
  resolveProviderForAddress,
  verifySmtpLogin,
  normalizeSmtpBody,
} from "./mail.js";
import { ensureAvatarBucket, uploadAvatarFile } from "./avatar-storage.js";
import { getAvatarBucket } from "./supabase.js";
import {
  upsertContact,
  listContacts,
  getContactByLogin,
  getContactForOwner,
  updateContactEmails,
  incrementSentAndUpdate,
  patchOutreach,
  rowToDoc,
} from "./contacts-db.js";
import { getOperatorProfile, upsertOperatorProfile } from "./operator-db.js";
import {
  insertSaemadangEvent,
  listSaemadangEvents,
  listSaemadangDays,
} from "./activity-db.js";
import { getCachedHealthStatus, refreshHealthStatus } from "./health-status.js";
import {
  buildContactRegistry,
  claimErrorResponse,
} from "./email-claims.js";

const API_BUILD = "1.7.6";
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const LOCAL_IP = resolveServerLanHost();
const API_URL = resolvePublicApiUrl(LOCAL_IP, PORT);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, GIF, or WebP images are allowed."));
  },
});

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());
app.use(express.json({ limit: "256kb" }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err?.message?.includes("image")) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

/** Fast ping for extension connectivity (no database round-trips). */
app.get("/health/ping", (_req, res) => {
  res.json({ ok: true, build: API_BUILD, apiUrl: API_URL });
});

/** All emails already saved (for UI duplicate checks). */
app.get("/api/emails/claims", async (req, res) => {
  try {
    const { claims, loginOwners } = await buildContactRegistry();
    res.json({
      claims,
      loginOwners,
      myOwnerIp: getClientIp(req) || "",
    });
  } catch (err) {
    console.error("GET /api/emails/claims", err);
    res.status(500).json({ error: err.message || "Failed to load email claims" });
  }
});

app.get("/health", (_req, res) => {
  const oauthReady = !!(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
  const { supabase, schema } = getCachedHealthStatus();
  res.json({
    ok: true,
    build: API_BUILD,
    database: "supabase",
    supabase: supabase.ok,
    supabaseError: supabase.error || null,
    schemaOk: schema.ok,
    schemaMissing: schema.missing || [],
    features: {
      saemadang: schema.ok || !schema.missing?.includes("saemadang_events"),
      operatorArchive:
        schema.ok || !schema.missing?.includes("operator_profiles"),
    },
    apiUrl: API_URL,
    host: LOCAL_IP,
    lanAddresses: listLanIPv4s(),
    clientIp: getClientIp(_req) || LOCAL_IP,
    port: PORT,
    automatic: true,
    oauthReady,
    googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
  });
});

/** OAuth config for secure Gmail (works with 2FA / Authenticator) */
app.get("/api/oauth/google/config", (_req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    return res.json({
      ok: false,
      error:
        "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to server/.env, or use App Password instead.",
    });
  }
  res.json({ ok: true, clientId });
});

app.post("/api/oauth/google/token", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    const redirectUri = String(req.body?.redirectUri || "").trim();
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

    if (!code || !redirectUri) {
      return res.status(400).json({ error: "code and redirectUri are required" });
    }
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: "Server OAuth not configured. Use App Password in the extension.",
      });
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(400).json({
        error: data.error_description || data.error || "Token exchange failed",
      });
    }

    if (!data.refresh_token) {
      return res.status(400).json({
        error:
          "No refresh token. Revoke app access at myaccount.google.com/permissions and connect again.",
      });
    }

    res.json({
      ok: true,
      refreshToken: data.refresh_token,
      email: data.email || null,
    });
  } catch (err) {
    console.error("POST /api/oauth/google/token", err);
    res.status(500).json({ error: err.message || "OAuth failed" });
  }
});

/** Your machine IP as seen by the API — used to filter & tag archived contacts */
app.get("/api/client-ip", (req, res) => {
  res.json({
    ip: getClientIp(req) || LOCAL_IP,
    serverHost: LOCAL_IP,
  });
});

/** Operator configuration archive (per owner IP + email addresses) */
app.get("/api/operator/profile", async (req, res) => {
  try {
    const ownerIp =
      normalizeArchiveIp(String(req.query.ownerIp || "")) || getClientIp(req);
    if (!ownerIp) {
      return res.status(400).json({ error: "Could not determine operator IP" });
    }
    const profile = await getOperatorProfile(ownerIp);
    res.json({ ok: true, ownerIp, profile });
  } catch (err) {
    console.error("GET /api/operator/profile", err);
    res.status(500).json({ error: err.message || "Failed to load profile" });
  }
});

app.put("/api/operator/profile", async (req, res) => {
  try {
    const ownerIp = getClientIp(req) || "";
    if (!ownerIp) {
      return res.status(400).json({ error: "Could not determine operator IP" });
    }
    const existing = await getOperatorProfile(ownerIp);
    const profile = await upsertOperatorProfile(ownerIp, {
      operatorLabel: req.body?.operatorLabel,
      apiUrl: req.body?.apiUrl,
      apiUrlAuto: req.body?.apiUrlAuto,
      githubToken: req.body?.githubToken,
      gmailUser: req.body?.gmailUser,
      gmailEnabled: req.body?.gmailEnabled,
      gmailAuthMethod: req.body?.gmailAuthMethod,
      outlookUser: req.body?.outlookUser,
      outlookEnabled: req.body?.outlookEnabled,
      secrets: req.body?.secrets || {},
      existingSecrets: existing?.secrets,
    });
    await recordActivity(req, "config_saved", "Configuration archived to database", {
      apiUrl: profile.apiUrl,
      gmailUser: profile.gmailUser,
      outlookUser: profile.outlookUser,
    });
    res.json({ ok: true, ownerIp, profile });
  } catch (err) {
    console.error("PUT /api/operator/profile", err);
    res.status(500).json({ error: err.message || "Failed to save profile" });
  }
});

/** Saemadang — daily activity log */
async function handlePostSaemadangLog(req, res) {
  try {
    const ownerIp = getClientIp(req) || "";
    if (!ownerIp) {
      return res.status(400).json({ error: "Could not determine operator IP" });
    }
    const action = String(req.body?.action || "").trim();
    if (!action) {
      return res.status(400).json({ error: "action is required" });
    }
    const event = await insertSaemadangEvent({
      ownerIp,
      action,
      summary: req.body?.summary || action,
      detail: req.body?.detail || {},
      contactLogin: req.body?.contactLogin || req.body?.contact_login,
      emailAddress: req.body?.emailAddress || req.body?.email,
      activityDate: req.body?.activityDate || null,
    });
    res.status(201).json({ ok: true, event });
  } catch (err) {
    console.error("POST saemadang/log", err);
    const status = err.code === "SCHEMA_MISSING" ? 503 : 500;
    res.status(status).json({ error: err.message || "Failed to log activity" });
  }
}

app.post("/api/saemadang/log", handlePostSaemadangLog);
app.post("/api/activity/log", handlePostSaemadangLog);

async function handleGetSaemadang(req, res) {
  try {
    const ownerIp =
      normalizeArchiveIp(String(req.query.ownerIp || "")) || getClientIp(req);
    if (!ownerIp) {
      return res.status(400).json({ error: "Could not determine operator IP" });
    }
    const activityDate = String(req.query.date || "").slice(0, 10) || undefined;
    const events = await listSaemadangEvents(ownerIp, {
      activityDate,
      limit: req.query.limit,
    });
    const days = await listSaemadangDays(ownerIp, 60);
    res.json({
      ok: true,
      ownerIp,
      activityDate: activityDate || new Date().toISOString().slice(0, 10),
      events,
      days,
    });
  } catch (err) {
    console.error("GET saemadang", err);
    const status = err.code === "SCHEMA_MISSING" ? 503 : 500;
    res.status(status).json({ error: err.message || "Failed to load activities" });
  }
}

app.get("/api/saemadang", handleGetSaemadang);
app.get("/api/activity/daily", handleGetSaemadang);

/** Save archive entry with optional avatar file upload (multipart) */
app.post("/api/archive/save", avatarUpload.single("avatar"), async (req, res) => {
  try {
    const body = normalizePayload(req.body);
    if (!body.githubLogin) {
      return res.status(400).json({ error: "githubLogin is required" });
    }
    if (!body.email) {
      return res.status(400).json({ error: "email is required" });
    }
    if (!body.name) {
      return res.status(400).json({ error: "name is required" });
    }

    const ownerIp = getClientIp(req) || "";
    if (req.file) {
      try {
        body.avatarUrl = await uploadAvatarFile(req.file, body.githubLogin);
      } catch (uploadErr) {
        console.error("Avatar upload:", uploadErr.message);
        body.avatarUrl = `https://www.gravatar.com/avatar?d=identicon&s=128&email=${encodeURIComponent(body.email)}`;
      }
    } else if (!body.avatarUrl) {
      const existing = await getContactByLogin(body.githubLogin);
      if (existing?.avatar_url) body.avatarUrl = existing.avatar_url;
    }

    const { doc, created } = await upsertContact(body, ownerIp);
    await recordActivity(
      req,
      created ? "archive_created" : "archive_updated",
      `${created ? "Added" : "Updated"} archive: ${body.name} (${body.email})`,
      {
        contactLogin: body.githubLogin,
        emailAddress: body.email,
      }
    );
    res.status(created ? 201 : 200).json({
      ok: true,
      created,
      contact: toPublic(doc),
    });
  } catch (err) {
    if (claimErrorResponse(err, res)) return;
    console.error("POST /api/archive/save", err);
    res.status(500).json({ error: err.message || "Failed to save archive entry" });
  }
});

/** Add or update a contact from the extension */
app.post("/api/contacts", async (req, res) => {
  try {
    const body = normalizePayload(req.body);
    if (!body.githubLogin) {
      return res.status(400).json({ error: "githubLogin is required" });
    }

    const ownerIp = getClientIp(req) || "";
    const { doc, created } = await upsertContact(body, ownerIp);
    await recordActivity(
      req,
      created ? "contact_added" : "contact_updated",
      `${created ? "Added" : "Updated"} contact @${body.githubLogin}`,
      { contactLogin: body.githubLogin, emailAddress: body.email }
    );

    res.status(created ? 201 : 200).json({
      ok: true,
      created,
      contact: toPublic(doc),
    });
  } catch (err) {
    if (claimErrorResponse(err, res)) return;
    console.error("POST /api/contacts", err);
    res.status(500).json({ error: err.message || "Failed to save contact" });
  }
});

app.get("/api/contacts", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 500, 1000);
    const ownerIp =
      normalizeArchiveIp(String(req.query.ownerIp || "")) || getClientIp(req);
    const contacts = await listContacts(ownerIp, limit);
    res.json({
      contacts: contacts.map(toPublic),
      ownerIp: ownerIp || null,
      filteredByOwner: !!ownerIp,
    });
  } catch (err) {
    console.error("GET /api/contacts", err);
    res.status(500).json({ error: err.message || "Failed to load contacts" });
  }
});

/** Send email in-app (SMTP) and increment send count */
app.post("/api/send-email", async (req, res) => {
  try {
    const login = String(req.body?.githubLogin || "")
      .trim()
      .toLowerCase();
    const to = str(req.body?.to || req.body?.email);
    const subject = str(req.body?.subject);
    const body = str(req.body?.body || req.body?.text);

    if (!login) return res.status(400).json({ error: "githubLogin is required" });
    if (!to) return res.status(400).json({ error: "Recipient email is required" });

    const ownerIp = getClientIp(req) || "";
    let contact = await getContactForOwner(login, ownerIp);
    if (!contact) {
      contact = await getContactByLogin(login);
    }
    if (!contact) {
      return res.status(404).json({
        error: "Contact not in archive. Add to My List first.",
      });
    }

    let provider =
      req.body?.provider === "outlook" || req.body?.provider === "gmail"
        ? req.body.provider
        : resolveProviderForAddress(to);
    if (!provider) {
      return res.status(400).json({
        error: "Only Gmail and Outlook recipient addresses are supported.",
      });
    }

    const smtp = normalizeSmtpBody(req.body);
    if (provider === "gmail" && !smtp.gmail) {
      return res.status(400).json({
        error:
          "Gmail is not configured. Extension → Configuration → Connect with Google or 16-character App Password → Test Gmail.",
      });
    }
    if (provider === "outlook" && !smtp.outlook) {
      return res.status(400).json({
        error: "Outlook is not configured in extension settings.",
      });
    }

    await sendContactEmail({
      to,
      subject,
      body,
      provider,
      smtp,
      fromName: str(req.body?.fromName),
    });
    const doc = await incrementSentAndUpdate(login, "sent", ownerIp);
    await recordActivity(req, "email_sent", `Email sent to ${to} (@${login})`, {
      contactLogin: login,
      emailAddress: to,
      provider,
    });

    res.json({
      ok: true,
      provider,
      emailsSentCount: doc?.emailsSentCount ?? 0,
      contact: doc ? toPublic(doc) : null,
    });
  } catch (err) {
    console.error("POST /api/send-email", err);
    res.status(500).json({
      error: err.message || "Failed to send email. Check SMTP settings in server/.env",
    });
  }
});

app.get("/api/contacts/:login", async (req, res) => {
  try {
    const row = await getContactByLogin(req.params.login.toLowerCase());
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ contact: toPublic(rowToDoc(row)) });
  } catch (err) {
    console.error("GET /api/contacts/:login", err);
    res.status(500).json({ error: err.message || "Failed to load contact" });
  }
});

/** Test Gmail or Outlook SMTP credentials from extension settings */
app.post("/api/smtp/test", async (req, res) => {
  try {
    const provider =
      req.body?.provider === "outlook" ? "outlook" : "gmail";
    const smtp = normalizeSmtpBody(req.body);
    await verifySmtpLogin(provider, smtp);
    await recordActivity(
      req,
      "smtp_test",
      `${provider === "outlook" ? "Outlook" : "Gmail"} SMTP test succeeded`,
      { provider }
    );
    res.json({
      ok: true,
      provider,
      message: `${provider === "outlook" ? "Outlook" : "Gmail"} account recognized and ready to send.`,
    });
  } catch (err) {
    console.error("POST /api/smtp/test", err);
    res.status(400).json({
      ok: false,
      error: err.message || "SMTP verification failed",
    });
  }
});

/** Update saved emails (address book) for a contact */
app.patch("/api/contacts/:login/emails", async (req, res) => {
  try {
    const login = req.params.login.toLowerCase();
    const raw = req.body?.allEmails ?? req.body?.emails;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: "allEmails array is required" });
    }

    const allEmails = [
      ...new Set(
        raw
          .map((e) => String(e || "").trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      ),
    ];
    if (!allEmails.length) {
      return res.status(400).json({ error: "At least one valid email is required" });
    }

    const ownerIp = getClientIp(req) || "";
    const gmail = allEmails.find((e) =>
      /@(gmail\.com|googlemail\.com)$/i.test(e)
    );
    const primary = gmail || allEmails[0];

    const doc = await updateContactEmails(login, allEmails, ownerIp);

    if (!doc) {
      return res.status(404).json({
        error: "Contact not found for your IP. Re-add from Browse on this machine.",
      });
    }

    res.json({ ok: true, contact: toPublic(doc) });
  } catch (err) {
    if (claimErrorResponse(err, res)) return;
    console.error("PATCH /api/contacts/:login/emails", err);
    res.status(500).json({ error: err.message || "Failed to update emails" });
  }
});

/** Mark outreach status (e.g. after user sends email from Gmail/Outlook) */
app.patch("/api/contacts/:login/outreach", async (req, res) => {
  try {
    const login = req.params.login.toLowerCase();
    const status = String(req.body?.outreachStatus || "").trim();
    if (!["pending", "queued", "sent", "read"].includes(status)) {
      return res.status(400).json({
        error: "outreachStatus must be pending, queued, sent, or read",
      });
    }

    const doc = await patchOutreach(login, status);

    if (!doc) return res.status(404).json({ error: "Contact not found" });

    await recordActivity(
      req,
      status === "read" ? "email_read" : "outreach_updated",
      `Outreach @${login} → ${status}`,
      { contactLogin: login, emailAddress: doc.email }
    );

    res.json({ ok: true, contact: toPublic(doc) });
  } catch (err) {
    console.error("PATCH /api/contacts/:login/outreach", err);
    res.status(500).json({ error: err.message || "Failed to update outreach" });
  }
});

function parseAllEmailsField(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function normalizePayload(raw = {}) {
  const login = String(raw.githubLogin || raw.login || "")
    .trim()
    .toLowerCase();
  const emails = normalizeEmailList(parseAllEmailsField(raw.allEmails));
  const primary = str(raw.email) || emails[0] || "";
  return {
    githubLogin: login,
    name: str(raw.name),
    company: str(raw.company),
    description: str(raw.description || raw.bio),
    email: primary,
    allEmails: emails.length ? emails : primary ? [primary] : [],
    location: str(raw.location),
    country: str(raw.country),
    githubUrl: str(raw.githubUrl || raw.html_url || `https://github.com/${login}`),
    avatarUrl: str(raw.avatarUrl || raw.avatar),
    website: str(raw.website || raw.blog),
    emailSource: str(raw.emailSource) || "manual",
    totalContributions: num(raw.totalContributions),
    publicContributions: num(raw.publicContributions),
  };
}

async function recordActivity(req, action, summary, extra = {}) {
  const ownerIp = getClientIp(req) || "";
  if (!ownerIp) return;
  try {
    await insertSaemadangEvent({
      ownerIp,
      action,
      summary,
      detail: extra,
      contactLogin: extra.contactLogin || "",
      emailAddress: extra.emailAddress || "",
    });
  } catch (err) {
    console.warn("Saemadang log:", err.message);
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = String(forwarded).split(",")[0].trim();
    const ip = normalizeArchiveIp(first);
    if (ip) return ip;
  }
  let ip = req.socket?.remoteAddress || req.ip || "";
  if (typeof ip === "string" && ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return normalizeArchiveIp(ip);
}

function toPublic(doc) {
  const contactIp =
    doc.contactIp || doc.savedIp || deriveContactIp(doc.githubLogin);
  return {
    id: doc._id?.toString(),
    githubLogin: doc.githubLogin,
    name: doc.name,
    company: doc.company,
    description: doc.description,
    email: doc.email,
    allEmails:
      doc.allEmails?.length > 0
        ? doc.allEmails
        : doc.email
          ? [doc.email]
          : [],
    location: doc.location,
    country: doc.country,
    githubUrl: doc.githubUrl,
    avatarUrl: doc.avatarUrl,
    website: doc.website,
    emailSource: doc.emailSource,
    totalContributions: doc.totalContributions,
    publicContributions: doc.publicContributions,
    outreachStatus: doc.outreachStatus,
    emailReadAt: doc.emailReadAt || null,
    emailsSentCount: doc.emailsSentCount || 0,
    ownerIp: doc.ownerIp || "",
    contactIp,
    savedIp: contactIp,
    addedAt: doc.addedAt,
    updatedAt: doc.updatedAt,
  };
}

function str(v) {
  return v == null ? "" : String(v).trim();
}

function normalizeEmailList(list) {
  if (!Array.isArray(list)) return [];
  return [
    ...new Set(
      list
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    ),
  ];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const { supabase, schema } = await refreshHealthStatus();
  if (!supabase.ok) {
    throw new Error(
      supabase.error ||
        "Supabase connection failed. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and run server/supabase/schema.sql"
    );
  }
  console.log("Supabase connected:", process.env.SUPABASE_URL);

  if (!schema.ok) {
    console.warn(
      "Missing Supabase tables:",
      schema.missing.join(", "),
      "— run server/supabase/schema.sql in the SQL Editor"
    );
  } else {
    console.log("Schema OK (contacts, operator_profiles, saemadang_events)");
  }

  setInterval(() => refreshHealthStatus().catch(() => {}), 60_000);

  try {
    await ensureAvatarBucket();
    console.log(`Supabase Storage bucket ready: ${getAvatarBucket()}`);
  } catch (storageErr) {
    console.warn(
      "Storage bucket not ready (photos may fail until fixed):",
      storageErr.message
    );
  }

  app.listen(PORT, HOST, () => {
    console.log(`API build ${API_BUILD} (automatic): ${API_URL}`);
    console.log(`Other PCs:      set Extension API URL to ${API_URL}`);
    console.log(`Quick test:     ${API_URL}/health/ping`);
    console.log(`Local:          http://localhost:${PORT}`);
    console.log(`Listening on:   ${HOST}:${PORT}`);
    console.log(`Firewall:       run server\\scripts\\open-firewall.ps1 as Administrator`);
    console.log(`Saemadang:      GET /api/saemadang`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
