import { createClient } from "@supabase/supabase-js";

// Server-only. Uses the service role key; RLS blocks every other key.
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

export type Role = "PM" | "SPM";
export type Tier = "invite" | "reject";
export const ROLES: Role[] = ["PM", "SPM"];
export const TOP_N = Number(process.env.TOP_N || 5);
export const scoreCol = (r: Role) => (r === "PM" ? "pm_score" : "spm_score") as "pm_score" | "spm_score";
