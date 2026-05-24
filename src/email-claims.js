import {
  collectEmailsFromContact,
  normalizeEmail,
} from "../../lib/email-claims.js";
import { getSupabase } from "./supabase.js";
import { getContactByLogin } from "./contacts-db.js";

export class ContactClaimError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ContactClaimError";
    this.code = details.code || "CLAIM_CONFLICT";
    this.details = details;
  }
}

export async function findContactsWithEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("contacts")
    .select("github_login, owner_ip, email, all_emails, name")
    .or(`email.eq.${e},all_emails.cs.{${e}}`);
  if (error) throw error;
  return data || [];
}

export async function assertLoginAvailable(githubLogin, ownerIp) {
  const login = String(githubLogin || "")
    .trim()
    .toLowerCase();
  if (!login) return;

  const existing = await getContactByLogin(login);
  if (!existing) return;

  const owner = String(existing.owner_ip || "").trim();
  const requester = String(ownerIp || "").trim();
  if (owner && requester && owner !== requester) {
    throw new ContactClaimError(
      `@${login} is already on another operator's list.`,
      {
        code: "LOGIN_CLAIMED",
        githubLogin: login,
        ownerIp: owner,
      }
    );
  }
}

export async function assertEmailsAvailable(emails, { excludeGithubLogin } = {}) {
  const exclude = String(excludeGithubLogin || "")
    .trim()
    .toLowerCase();
  const normalized = [
    ...new Set(
      (emails || []).map(normalizeEmail).filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    ),
  ];
  if (!normalized.length) return;

  const conflicts = [];
  for (const email of normalized) {
    const rows = await findContactsWithEmail(email);
    for (const row of rows) {
      const login = String(row.github_login || "").toLowerCase();
      if (exclude && login === exclude) continue;
      conflicts.push({
        email,
        githubLogin: login,
        ownerIp: row.owner_ip || "",
        name: row.name || "",
      });
    }
  }

  const byEmail = new Map();
  for (const c of conflicts) {
    if (!byEmail.has(c.email)) byEmail.set(c.email, c);
  }
  const list = [...byEmail.values()];
  if (!list.length) return;

  const first = list[0];
  const msg =
    list.length === 1
      ? `Email ${first.email} is already on the list for @${first.githubLogin}.`
      : `These emails are already on another contact's list: ${list.map((c) => c.email).join(", ")}.`;

  throw new ContactClaimError(msg, {
    code: "EMAIL_CLAIMED",
    conflicts: list,
  });
}

export async function assertContactSaveAllowed(body, ownerIp) {
  const login = String(body.githubLogin || "")
    .trim()
    .toLowerCase();
  await assertLoginAvailable(login, ownerIp);
  const emails = collectEmailsFromContact(body);
  if (emails.length) {
    await assertEmailsAvailable(emails, { excludeGithubLogin: login });
  }
}

export async function buildContactRegistry() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("contacts")
    .select("github_login, owner_ip, email, all_emails, name");
  if (error) throw error;

  const claims = {};
  const loginOwners = {};
  for (const row of data || []) {
    const login = String(row.github_login || "").toLowerCase();
    const owner = String(row.owner_ip || "").trim();
    if (login && owner) loginOwners[login] = owner;

    for (const email of collectEmailsFromContact({
      email: row.email,
      all_emails: row.all_emails,
    })) {
      if (!claims[email]) {
        claims[email] = {
          githubLogin: row.github_login,
          ownerIp: owner,
          name: row.name || "",
        };
      }
    }
  }
  return { claims, loginOwners };
}

export async function buildEmailClaimsIndex() {
  const { claims } = await buildContactRegistry();
  return claims;
}

export function claimErrorResponse(err, res) {
  if (err?.name !== "ContactClaimError") return false;
  res.status(409).json({
    error: err.message,
    code: err.code,
    ...err.details,
  });
  return true;
}
