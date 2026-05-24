import { checkSupabase } from "./supabase.js";
import { checkSchemaTables } from "./schema-bootstrap.js";

let cached = {
  supabase: { ok: false, error: "starting" },
  schema: { ok: false, missing: [] },
  checkedAt: 0,
};

let refreshInFlight = null;

export function getCachedHealthStatus() {
  return cached;
}

export async function refreshHealthStatus() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const [supabase, schema] = await Promise.all([
      checkSupabase(),
      checkSchemaTables(),
    ]);
    cached = {
      supabase,
      schema,
      checkedAt: Date.now(),
    };
    return cached;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
