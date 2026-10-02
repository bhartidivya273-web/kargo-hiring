// Separates personal details from CV content. Runs in plain code, before any AI
// call, so name / email / phone never leave our server.

export type PII = { name: string | null; email: string | null; phone: string | null };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,5}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin\.com|github\.com)\/\S+/gi;
const HEADER_WORDS =
  /\b(resume|résumé|curriculum|vitae|cv|profile|summary|synopsis|professional|contact|email|phone|mobile|address|objective|experience|skills?|core|competencies|qualifications?|academic|education|college|university|institute|school|junior|product|manager|senior|linkedin|venture|builder|delhi|ncr|mumbai|bengaluru|bangalore|pune|hyderabad|chennai|kolkata|ghaziabad|noida|gurgaon|gurugram|india|leader|delivery|engineer|consultant|analyst|director|head|lead|about|career|details|personal|work|history|projects?|achievements?|certifications?|technology|technologies|solutions)\b/i;

const FILE_STOP = new Set(["pm", "spm", "cv", "resume", "resumes", "curriculum", "vitae", "final", "new", "copy", "updated", "latest", "product", "manager", "senior", "doc", "docx", "pdf", "application", "applicant", "candidate"]);

function isPhone(s: string) {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return false;
  // "2019 - 2023" style date ranges are not phone numbers
  const groups = s.trim().split(/[\s.()-]+/).filter(Boolean);
  if (groups.every((g) => /^(19|20)\d{2}$/.test(g))) return false;
  return true;
}

// "03_arnav_sen.pdf" -> "Arnav Sen". Returns null when the file name is not a plain name.
export function nameFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const tokens = fileName
    .replace(/\.[^.]+$/, "")
    .split(/[\s_.()\-]+/)
    .filter((t) => /^[A-Za-z]{2,}$/.test(t) && !FILE_STOP.has(t.toLowerCase()));
  if (tokens.length < 2 || tokens.length > 4) return null;
  return tokens.map((t) => t[0].toUpperCase() + t.slice(1).toLowerCase()).join(" ");
}

const tokenSet = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 2));
const overlaps = (a: string, b: string) => {
  const B = tokenSet(b);
  return [...tokenSet(a)].some((t) => B.has(t));
};

function headerNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8)) {
    const cleaned = line.split(/[|•·,]/)[0].trim();
    const words = cleaned.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 4 &&
      cleaned.length <= 40 &&
      !HEADER_WORDS.test(cleaned) &&
      words.every((w) => /^[A-Z][A-Za-z.'-]*$/.test(w))
    ) {
      out.push(tidyName(cleaned));
    }
  }
  return out;
}

function findName(text: string, email: string | null, fileName?: string | null): string | null {
  const labelled = text.match(/^\s*(?:full\s+)?name\s*[:\-]\s*(.+)$/im);
  if (labelled) return tidyName(labelled[1]);
  const fromFile = nameFromFileName(fileName);
  const headers = headerNames(text);
  if (fromFile) {
    // Prefer the CV's own spelling (e.g. with a middle initial) when it agrees with the file name.
    return headers.find((h) => overlaps(h, fromFile)) ?? fromFile;
  }
  if (headers.length) return headers[0];
  if (email) {
    const parts = email.split("@")[0].split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
    if (parts.length >= 2) return parts.slice(0, 2).map((t) => t[0].toUpperCase() + t.slice(1).toLowerCase()).join(" ");
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

// PDF extraction can glue a preceding word onto an address ("REDDYsquad_5@x.co"): drop a leading ALL-CAPS run.
function cleanEmail(e: string | undefined): string | null {
  if (!e) return null;
  const m = e.match(/^[A-Z]{2,}([a-z][a-z0-9._%+-]{2,}@.+)$/);
  return m ? m[1] : e;
}

export function separatePII(raw: string, fileName?: string | null): { pii: PII; content: string } {
  const email = cleanEmail(raw.match(EMAIL_RE)?.[0]);
  const phone = (raw.match(PHONE_RE) ?? []).find(isPhone)?.trim() ?? null;
  const name = findName(raw, email, fileName);

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

// Re-redacts text using the stored personal details. Idempotent; used to repair CV text that
// was stored while a candidate's name was still mis-detected.
export function redactKnown(text: string, pii: PII): string {
  let out = text;
  if (pii.email) out = out.replace(new RegExp(esc(pii.email), "gi"), "[EMAIL]");
  if (pii.name) out = out.replace(new RegExp(esc(pii.name), "gi"), "[CANDIDATE]");
  for (const t of nameTokens(pii.name)) out = out.replace(new RegExp(`\\b${esc(t)}\\b`, "gi"), "[CANDIDATE]");
  return out;
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

export function displayName(pii: { name: string | null } | null) {
  return pii?.name?.trim() || "there";
}

export function fillName(text: string, pii: { name: string | null } | null) {
  return text.replace(/\[(NAME|CANDIDATE)\]/g, displayName(pii));
}
