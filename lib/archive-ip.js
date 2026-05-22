const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Normalize hostname / IP for archive storage */
export function normalizeArchiveIp(value) {
  if (!value || typeof value !== "string") return "";
  const v = value.trim().toLowerCase();
  if (v === "localhost") return "127.0.0.1";
  if (IPV4_RE.test(v)) return v;
  return "";
}

/** Extract IPv4 (or localhost) from backend API URL */
export function ipFromApiUrl(apiUrl) {
  if (!apiUrl) return "";
  try {
    return normalizeArchiveIp(new URL(apiUrl).hostname);
  } catch {
    return "";
  }
}

/**
 * Stable unique IP-style identifier per GitHub login (for My List display).
 * Not a real network address — one distinct value per archived contact.
 */
export function deriveContactIp(login) {
  const s = String(login || "")
    .toLowerCase()
    .trim();
  if (!s) return "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const o1 = 10 + ((h >>> 0) % 200);
  const o2 = (h >>> 8) % 256;
  const o3 = (h >>> 16) % 256;
  return `10.${o1}.${o2}.${o3}`;
}
