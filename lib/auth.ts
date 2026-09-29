export const COOKIE = "kargo_auth";

export async function authToken(): Promise<string | null> {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`kargo-hiring:${pw}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
