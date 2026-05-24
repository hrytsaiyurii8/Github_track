import { getSupabase } from "./supabase.js";

export function rowToProfile(row) {
  if (!row) return null;
  const secrets = row.config_secrets || {};
  return {
    ownerIp: row.owner_ip,
    operatorLabel: row.operator_label || "",
    apiUrl: row.api_url || "",
    apiUrlAuto: row.api_url_auto !== false,
    githubToken: row.github_token || "",
    gmailUser: row.gmail_user || "",
    gmailEnabled: row.gmail_enabled !== false,
    gmailAuthMethod: row.gmail_auth_method || "app_password",
    outlookUser: row.outlook_user || "",
    outlookEnabled: row.outlook_enabled !== false,
    secrets: {
      smtpGmailPass: secrets.smtpGmailPass || "",
      smtpOutlookPass: secrets.smtpOutlookPass || "",
      gmailOAuthRefresh: secrets.gmailOAuthRefresh || "",
      gmailOAuthUser: secrets.gmailOAuthUser || "",
    },
    updatedAt: row.updated_at,
  };
}

export async function getOperatorProfile(ownerIp) {
  if (!ownerIp) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("operator_profiles")
    .select("*")
    .eq("owner_ip", ownerIp)
    .maybeSingle();
  if (error) throw error;
  return rowToProfile(data);
}

export async function upsertOperatorProfile(ownerIp, body) {
  if (!ownerIp) throw new Error("ownerIp is required");

  const secrets = { ...(body.existingSecrets || {}) };
  if (body.secrets && typeof body.secrets === "object") {
    for (const [key, val] of Object.entries(body.secrets)) {
      if (val != null && String(val).trim() !== "") {
        secrets[key] = String(val);
      }
    }
  }

  const row = {
    owner_ip: ownerIp,
    operator_label: String(body.operatorLabel || "").trim(),
    api_url: String(body.apiUrl || "").replace(/\/$/, ""),
    api_url_auto: body.apiUrlAuto !== false,
    github_token: String(body.githubToken || ""),
    gmail_user: String(body.gmailUser || "").trim().toLowerCase(),
    gmail_enabled: body.gmailEnabled !== false,
    gmail_auth_method: body.gmailAuthMethod || "app_password",
    outlook_user: String(body.outlookUser || "").trim(),
    outlook_enabled: body.outlookEnabled !== false,
    config_secrets: secrets,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("operator_profiles")
    .upsert(row, { onConflict: "owner_ip" })
    .select("*")
    .single();
  if (error) throw error;
  return rowToProfile(data);
}
