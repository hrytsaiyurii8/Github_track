import { getSupabase } from "./supabase.js";

const REQUIRED_TABLES = ["contacts", "operator_profiles", "saemadang_events"];

export async function checkSchemaTables() {
  const supabase = getSupabase();
  const missing = [];

  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (error) {
      const msg = error.message || "";
      if (
        error.code === "42P01" ||
        /does not exist|schema cache/i.test(msg)
      ) {
        missing.push(table);
      } else {
        console.warn(`Schema check ${table}:`, msg);
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}
