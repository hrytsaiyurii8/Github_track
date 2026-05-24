import { getSupabase } from "./supabase.js";

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function rowToActivity(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerIp: row.owner_ip,
    activityDate: row.activity_date,
    action: row.action,
    summary: row.summary,
    detail: row.detail || {},
    contactLogin: row.contact_login || "",
    emailAddress: row.email_address || "",
    createdAt: row.created_at,
  };
}

export async function insertSaemadangEvent({
  ownerIp,
  action,
  summary,
  detail = {},
  contactLogin = "",
  emailAddress = "",
  activityDate = null,
}) {
  if (!ownerIp || !action) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("saemadang_events")
    .insert({
      owner_ip: ownerIp,
      activity_date: activityDate || todayUtc(),
      action: String(action).slice(0, 64),
      summary: String(summary || action).slice(0, 500),
      detail,
      contact_login: String(contactLogin || "").toLowerCase().slice(0, 128),
      email_address: String(emailAddress || "").slice(0, 256),
    })
    .select("*")
    .single();

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || "")) {
      const err = new Error(
        "saemadang_events table missing. Run server/supabase/schema.sql in Supabase SQL Editor."
      );
      err.code = "SCHEMA_MISSING";
      throw err;
    }
    throw error;
  }
  return rowToActivity(data);
}

export async function listSaemadangEvents(ownerIp, options = {}) {
  const supabase = getSupabase();
  const day = options.activityDate || todayUtc();
  const limit = Math.min(Number(options.limit) || 300, 1000);

  const { data, error } = await supabase
    .from("saemadang_events")
    .select("*")
    .eq("owner_ip", ownerIp)
    .eq("activity_date", day)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || "")) {
      const err = new Error(
        "saemadang_events table missing. Run server/supabase/schema.sql in Supabase."
      );
      err.code = "SCHEMA_MISSING";
      throw err;
    }
    throw error;
  }

  return (data || []).map(rowToActivity);
}

export async function listSaemadangDays(ownerIp, limit = 30) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("saemadang_events")
    .select("activity_date")
    .eq("owner_ip", ownerIp)
    .order("activity_date", { ascending: false })
    .limit(500);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message || "")) {
      return [];
    }
    throw error;
  }

  const days = [...new Set((data || []).map((r) => r.activity_date))];
  return days.slice(0, limit);
}
