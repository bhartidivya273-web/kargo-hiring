// Separates personal details from CV content. Runs in plain code, before any AI
// call, so name / email / phone never leave our server.

export type PII = { name: string | null; email: string | null; phone: string | null };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,5}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin\.com|github\.com)\/\S+/gi;
const HEADER_WORDS =
  /\b(resume|résumé|curriculum|vitae|cv|profile|summary|contact|email|phone|mobile|address|objective|experience|product|manager|senior|linkedin)\b/i;

function isPhone(s: string) {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return false;
  // "2019 - 2023" style date ranges are not phone numbers
  const groups = s.trim().split(/[\s.()-]+/).filter(Boolean);
  if (groups.every((g) => /^(19|20)\d{2}$/.test(g))) return false;
  return true;
}

function findName(text: string, email: string | null): string | null {
  const labelled = text.match(/^\s*(?:full\s+)?name\s*[:\-]\s*(.+)$/im);
  if (labelled) return tidyName(labelled[1]);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const line of lines) {
    const cleaned = line.split(/[|•·,]/)[0].trim();
    const words = cleaned.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 4 &&
      cleaned.length <= 40 &&
      !HEADER_WORDS.test(cleaned) &&
      words.every((w) => /^[A-Z][A-Za-z.'-]*$/.test(w))
    ) {
      return tidyName(cleaned);
    }
  }
  if (email) {
    const parts = email.split("@")[0].split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
    if (parts.length >= 2) return tidyName(parts.slice(0, 2).join(" "));
  }
  return null;
}

function tidyName(s: string) {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nameTokens(name: string | null) {
  return name ? name.split(/\s+/).filter((t) => t.replace(/\W/g, "").length >= 3) : [];
}

export function separatePII(raw: string): { pii: PII; content: string } {
  const email = raw.match(EMAIL_RE)?.[0] ?? null;
  const phone = (raw.match(PHONE_RE) ?? []).find(isPhone)?.trim() ?? null;
  const name = findName(raw, email);

  let content = raw
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, (m) => (isPhone(m) ? "[PHONE]" : m))
    .replace(URL_RE, "[LINK]");
  if (name) content = content.replace(new RegExp(esc(name), "gi"), "[CANDIDATE]");
  for (const t of nameTokens(name)) {
    content = content.replace(new RegExp(`\\b${esc(t)}\\b`, "gi"), "[CANDIDATE]");
  }
  return { pii: { name, email, phone }, content };
}

// Hard stop: throws if any stored personal detail is present in text bound for the AI.
export function assertNoPII(text: string, pii: PII) {
  const lower = text.toLowerCase();
  if (pii.email && lower.includes(pii.email.toLowerCase())) throw new Error("PII guard: email found in AI input");
  const pd = pii.phone?.replace(/\D/g, "");
  if (pd && pd.length >= 10 && text.replace(/\D/g, "").includes(pd)) throw new Error("PII guard: phone found in AI input");
  for (const t of nameTokens(pii.name)) {
    if (new RegExp(`\\b${esc(t)}\\b`, "i").test(text)) throw new Error("PII guard: name found in AI input");
  }
  if (EMAIL_RE.test(text)) {
    EMAIL_RE.lastIndex = 0;
    throw new Error("PII guard: an email address is present in AI input");
  }
}

export function firstName(pii: { name: string | null } | null) {
  return pii?.name?.split(/\s+/)[0] || "there";
}

export function fillName(text: string, pii: { name: string | null } | null) {
  return text.replace(/\[(NAME|CANDIDATE)\]/g, firstName(pii));
}
