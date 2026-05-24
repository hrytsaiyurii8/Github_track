import { deriveContactIp } from "../lib/archive-ip.js";
import {
  assertContactSaveAllowed,
  assertEmailsAvailable,
} from "./email-claims.js";
import { getSupabase } from "./supabase.js";

export function rowToDoc(row) {
  if (!row) return null;
  return {
    _id: row.id,
    githubLogin: row.github_login,
    name: row.name,
    company: row.company,
    description: row.description,
    email: row.email,
    allEmails: row.all_emails || [],
    location: row.location,
    country: row.country,
    githubUrl: row.github_url,
    avatarUrl: row.avatar_url,
    website: row.website,
    emailSource: row.email_source,
    totalContributions: row.total_contributions ?? 0,
    publicContributions: row.public_contributions ?? 0,
    ownerIp: row.owner_ip || "",
    contactIp: row.contact_ip || row.saved_ip || "",
    savedIp: row.saved_ip || row.contact_ip || "",
    emailsSentCount: row.emails_sent_count ?? 0,
    outreachStatus: row.outreach_status || "pending",
    emailReadAt: row.email_read_at,
    addedAt: row.added_at,
    updatedAt: row.updated_at,
  };
}

function payloadToRow(body, ownerIp, existing = null) {
  const login = body.githubLogin;
  const contactIp =
    existing?.contact_ip || existing?.saved_ip || deriveContactIp(login);
  const now = new Date().toISOString();

  return {
    github_login: login,
    name: body.name || login,
    company: body.company || "",
    description: body.description || "",
    email: body.email || "",
    all_emails: body.allEmails?.length ? body.allEmails : body.email ? [body.email] : [],
    location: body.location || body.country || "",
    country: body.country || "",
    github_url: body.githubUrl || "",
    avatar_url: body.avatarUrl || "",
    website: body.website || "",
    email_source: body.emailSource || "",
    total_contributions: body.totalContributions ?? 0,
    public_contributions: body.publicContributions ?? 0,
    owner_ip: existing?.owner_ip || ownerIp || "",
    contact_ip: contactIp,
    saved_ip: contactIp,
    emails_sent_count: existing?.emails_sent_count ?? 0,
    outreach_status: existing?.outreach_status || "pending",
    email_read_at: existing?.email_read_at || null,
    added_at: existing?.added_at || now,
    updated_at: now,
  };
}

export async function contactExists(githubLogin) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("contacts")
    .select("github_login")
    .eq("github_login", githubLogin)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function getContactByLogin(githubLogin) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("github_login", githubLogin)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getContactForOwner(githubLogin, ownerIp) {
  const row = await getContactByLogin(githubLogin);
  if (!row) return null;
  if (!ownerIp) return row;
  if (row.owner_ip === ownerIp) return row;
  if ((!row.owner_ip || row.owner_ip === "") && row.saved_ip === ownerIp) {
    return row;
  }
  return null;
}

export async function listContacts(ownerIp, limit = 500) {
  const supabase = getSupabase();
  let query = supabase
    .from("contacts")
    .select("*")
    .order("added_at", { ascending: false })
    .limit(limit);

  if (ownerIp) {
    query = query.or(
      `owner_ip.eq.${ownerIp},and(owner_ip.eq."",saved_ip.eq.${ownerIp})`
    );
  }

  let { data, error } = await query;
  if (error && ownerIp) {
    const fallback = await supabase
      .from("contacts")
      .select("*")
      .order("added_at", { ascending: false })
      .limit(limit);
    if (fallback.error) throw fallback.error;
    data = (fallback.data || []).filter(
      (row) =>
        row.owner_ip === ownerIp ||
        ((!row.owner_ip || row.owner_ip === "") && row.saved_ip === ownerIp)
    );
  } else if (error) {
    throw error;
  }
  return (data || []).map(rowToDoc);
}

export async function upsertContact(body, ownerIp) {
  await assertContactSaveAllowed(body, ownerIp);
  const existing = await getContactByLogin(body.githubLogin);
  const row = payloadToRow(body, ownerIp, existing);
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("contacts")
    .upsert(row, { onConflict: "github_login" })
    .select()
    .single();

  if (error) throw error;
  return { doc: rowToDoc(data), created: !existing };
}

export async function updateContactEmails(login, allEmails, ownerIp) {
  const existing = await getContactForOwner(login, ownerIp);
  if (!existing) return null;

  await assertEmailsAvailable(allEmails, { excludeGithubLogin: login });

  const gmail = allEmails.find((e) => /@(gmail\.com|googlemail\.com)$/i.test(e));
  const primary = gmail || allEmails[0];
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("contacts")
    .update({
      email: primary,
      all_emails: allEmails,
      updated_at: now,
    })
    .eq("github_login", login)
    .select()
    .single();

  if (error) throw error;
  return rowToDoc(data);
}

export async function incrementSentAndUpdate(login, outreachStatus, ownerIp = "") {
  const existing = await getContactByLogin(login);
  if (!existing) return null;

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const wasSent =
    existing.outreach_status === "sent" || existing.outreach_status === "read";
  const patch = {
    outreach_status: outreachStatus,
    updated_at: now,
  };
  if (outreachStatus === "sent" && !wasSent) {
    patch.emails_sent_count = (existing.emails_sent_count || 0) + 1;
  }
  if (ownerIp && !existing.owner_ip) {
    patch.owner_ip = ownerIp;
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("github_login", login)
    .select()
    .single();

  if (error) throw error;
  return rowToDoc(data);
}

export async function patchOutreach(login, status) {
  const existing = await getContactByLogin(login);
  if (!existing) return null;

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const patch = { outreach_status: status, updated_at: now };

  if (
    status === "sent" &&
    existing.outreach_status !== "sent" &&
    existing.outreach_status !== "read"
  ) {
    patch.emails_sent_count = (existing.emails_sent_count || 0) + 1;
  }
  if (status === "read") {
    patch.email_read_at = now;
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("github_login", login)
    .select()
    .single();

  if (error) throw error;
  return rowToDoc(data);
}
