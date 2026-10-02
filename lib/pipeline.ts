import { db, ROLES, TOP_N, scoreCol, type Role, type Tier } from "./db";
import { geminiJSON } from "./gemini";
import { redactKnown, type PII } from "./pii";

export type Criterion = { id: number; role: Role; position: number; name: string; description: string; weight: number };
export type RoleRow = { code: Role; title: string; bar_note: string };
export type Rubric = { guide: string; roles: RoleRow[]; criteria: Criterion[] };

export async function loadRubric(): Promise<Rubric> {
  const s = db();
  const [g, r, c] = await Promise.all([
    s.from("rubric_guide").select("text").eq("id", 1).maybeSingle(),
    s.from("roles").select("code,title,bar_note"),
    s.from("rubric_criteria").select("*").order("role").order("position"),
  ]);
  if (g.error || r.error || c.error) throw new Error((g.error || r.error || c.error)!.message);
  if (!g.data || !c.data?.length) throw new Error("Rubric not loaded: run supabase/seed_rubric.sql");
  return { guide: g.data.text, roles: r.data as RoleRow[], criteria: c.data as Criterion[] };
}

async function loadPII(candidateId: string): Promise<PII> {
  const { data } = await db().from("candidate_pii").select("name,email,phone").eq("candidate_id", candidateId).maybeSingle();
  return data ?? { name: null, email: null, phone: null };
}

// ---------- Step 1: score against BOTH rubrics ----------

type ScoreOut = { pm: { key: string; score: number; reason: string }[]; spm: { key: string; score: number; reason: string }[] };

const critKey = (c: Criterion) => `${c.role}-${c.position}`;

export async function scoreCandidate(candidateId: string) {
  const s = db();
  const { data: cand, error } = await s.from("candidates").select("id,cv_text").eq("id", candidateId).single();
  if (error) throw new Error(error.message);
  const rubric = await loadRubric();
  const pii = await loadPII(candidateId);

  // Make sure the stored CV text carries none of the stored personal details (repairs rows
  // saved while the name was mis-detected), and persist the cleaned text.
  const cvText = redactKnown(cand.cv_text, pii);
  if (cvText !== cand.cv_text) {
    const fix = await s.from("candidates").update({ cv_text: cvText }).eq("id", candidateId);
    if (fix.error) throw new Error(fix.error.message);
    cand.cv_text = cvText;
  }

  const rubricText = ROLES.map((role) => {
    const r = rubric.roles.find((x) => x.code === role)!;
    const crit = rubric.criteria.filter((c) => c.role === role);
    return `### ${r.title} (${role})\n${r.bar_note ? r.bar_note + "\n" : ""}\n${crit
      .map((c) => `[${critKey(c)}] ${c.name}\n${c.description}`)
      .join("\n\n")}`;
  }).join("\n\n");

  const prompt = `You are scoring a CV for Kargo, a logistics SaaS startup, against a fixed hiring rubric.
Score the CV against EVERY criterion for BOTH roles below, regardless of which role was applied for.

${rubric.guide}

${rubricText}

Instructions:
- Each score is an integer 0-3 using the scale above. Apply the SPM criteria's higher bar strictly and separately.
- Use the 0-3 scale literally. 0 means nothing relevant on the CV. One specific example that meets the role's bar scores 2, even where the SPM text asks for more than one example to reach 3. Do not score 0 just because a second example is missing.
- Score only what the CV actually states. Do not infer, do not reward titles, self-descriptions, certifications or colleges.
- "reason" is ONE line (max 30 words): cite the specific CV evidence that earned the score, or say what is missing.
- The candidate's identity has been removed ([CANDIDATE], [EMAIL], [PHONE], [LINK]). Ignore those tokens.

CV:
"""
${cand.cv_text}
"""`;

  const item = {
    type: "object",
    properties: { key: { type: "string" }, score: { type: "integer", minimum: 0, maximum: 3 }, reason: { type: "string" } },
    required: ["key", "score", "reason"],
  };
  const out = await geminiJSON<ScoreOut>({
    prompt,
    pii,
    candidateText: cand.cv_text,
    temperature: 0,
    schema: {
      type: "object",
      properties: { pm: { type: "array", items: item }, spm: { type: "array", items: item } },
      required: ["pm", "spm"],
    },
  });

  const all = [...(out.pm ?? []), ...(out.spm ?? [])];
  const rows = rubric.criteria.map((c) => {
    const hit = all.find((x) => x.key?.trim().toUpperCase() === critKey(c));
    if (!hit) throw new Error(`Scoring response missing criterion ${critKey(c)} (${c.name})`);
    return {
      candidate_id: candidateId,
      criterion_id: c.id,
      role: c.role,
      score: Math.max(0, Math.min(3, Math.round(Number(hit.score) || 0))),
      reason: String(hit.reason ?? "").trim().split("\n")[0].slice(0, 300),
    };
  });

  // Weighted total in code (0-100). Divides by the real weight sum, so a rubric
  // whose weights do not add to exactly 100 still yields a 0-100 score.
  const total = (role: Role) => {
    const crit = rubric.criteria.filter((c) => c.role === role);
    const wsum = crit.reduce((a, c) => a + c.weight, 0);
    const got = crit.reduce((a, c) => a + (rows.find((r) => r.criterion_id === c.id)!.score / 3) * c.weight, 0);
    return Math.round((got / wsum) * 1000) / 10;
  };

  const up = await s.from("scores").upsert(rows);
  if (up.error) throw new Error(up.error.message);
  const upd = await s
    .from("candidates")
    .update({ pm_score: total("PM"), spm_score: total("SPM"), status: "scored", error: null })
    .eq("id", candidateId);
  if (upd.error) throw new Error(upd.error.message);
}

// ---------- The line: who is above it ----------

export type TierInfo = { rank: number; autoTier: Tier; tier: Tier };

export async function computeTiers(role: Role): Promise<Map<string, TierInfo>> {
  const col = scoreCol(role);
  const { data, error } = await db()
    .from("candidates")
    .select(`id,${col},override_tier,created_at`)
    .eq("applied_role", role)
    .eq("status", "scored")
    .order(col, { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const m = new Map<string, TierInfo>();
  (data as unknown as { id: string; override_tier: Tier | null }[]).forEach((c, i) => {
    const autoTier: Tier = i < TOP_N ? "invite" : "reject";
    m.set(c.id, { rank: i + 1, autoTier, tier: c.override_tier ?? autoTier });
  });
  return m;
}

// Candidates whose draft is missing or no longer matches their tier (the line moved).
export async function pendingDrafts(): Promise<string[]> {
  const ids: string[] = [];
  for (const role of ROLES) {
    const tiers = await computeTiers(role);
    const { data, error } = await db()
      .from("candidates")
      .select("id,draft_tier,email_body,send_status")
      .eq("applied_role", role)
      .eq("status", "scored");
    if (error) throw new Error(error.message);
    for (const c of data) {
      if (c.send_status) continue;
      const t = tiers.get(c.id)?.tier;
      if (!c.email_body || c.draft_tier !== t) ids.push(c.id);
    }
  }
  return ids;
}

// ---------- Steps 2 + 3: brief (above the line) and email draft (everyone) ----------

const SIGNOFF = "Arjun Mehta\nFounder, Kargo";

export async function generateDraft(candidateId: string) {
  const s = db();
  const { data: cand, error } = await s
    .from("candidates")
    .select("id,applied_role,cv_text,send_status,pm_score,spm_score")
    .eq("id", candidateId)
    .single();
  if (error) throw new Error(error.message);
  if (cand.send_status) throw new Error("Email already sent; draft is locked");

  const role = cand.applied_role as Role;
  const tier = (await computeTiers(role)).get(candidateId);
  if (!tier) throw new Error("Candidate is not scored yet");
  const rubric = await loadRubric();
  const roleRow = rubric.roles.find((r) => r.code === role)!;
  const pii = await loadPII(candidateId);

  const { data: sc } = await s.from("scores").select("criterion_id,score,reason").eq("candidate_id", candidateId).eq("role", role);
  const scoreLines = rubric.criteria
    .filter((c) => c.role === role)
    .map((c) => {
      const r = sc?.find((x) => x.criterion_id === c.id);
      return `- ${c.name} (weight ${c.weight}%): ${r?.score ?? "?"}/3 - ${r?.reason ?? ""}`;
    })
    .join("\n");

  const context = `Role applied for: ${roleRow.title} at Kargo (logistics SaaS, Mumbai; the role reports to the founder).
Overall score: ${role === "PM" ? cand.pm_score : cand.spm_score}/100 (rank ${tier.rank} of the ${role} applicants).
Rubric scores:
${scoreLines}

CV (identity removed):
"""
${cand.cv_text}
"""`;

  const emailRules = `Email rules:
- Plain text. Open with exactly "Hi [NAME]," (keep the literal placeholder [NAME]; never write any name).
- Written from the CV: mention one or two specific, real things from their work history. Never invent facts.
- Never mention scores, rubrics, rankings, AI or other candidates.
- Warm, direct, human. Under 150 words for the body. End with:
${SIGNOFF}`;

  if (tier.tier === "invite") {
    const out = await geminiJSON<{ brief: string; subject: string; body: string }>({
      prompt: `You are helping Kargo's founder, Arjun, who will interview this candidate.
${context}

Write two things.

1. "brief": an interview brief of EXACTLY three sentences for Arjun.
   Sentence 1: who this candidate is, from the CV (refer to them as "they").
   Sentence 2: why they ranked here, naming the strongest rubric evidence.
   Sentence 3: what to probe in the interview (the weakest criterion or a claim that needs verifying).

2. An interview invitation email: "subject" and "body".
   Invite them to a 45-minute conversation with Arjun about the ${roleRow.title} role and ask for two or three times that suit them next week.
${emailRules}`,
      pii,
      candidateText: context,
      temperature: 0.4,
      schema: {
        type: "object",
        properties: { brief: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["brief", "subject", "body"],
      },
    });
    await saveDraft(candidateId, { brief: out.brief.trim(), subject: out.subject, body: out.body, tier: "invite" });
  } else {
    const out = await geminiJSON<{ subject: string; body: string }>({
      prompt: `You are writing on behalf of Kargo's founder, Arjun.
${context}

Write a warm rejection email: "subject" and "body".
Thank them for applying to the ${roleRow.title} role, say clearly and kindly that Kargo is not moving forward with their application for this role, acknowledge something genuine from their CV, and wish them well. No false promises, no "we'll keep your CV on file" unless it is true.
${emailRules}`,
      pii,
      candidateText: context,
      temperature: 0.4,
      schema: {
        type: "object",
        properties: { subject: { type: "string" }, body: { type: "string" } },
        required: ["subject", "body"],
      },
    });
    await saveDraft(candidateId, { brief: null, subject: out.subject, body: out.body, tier: "reject" });
  }
}

async function saveDraft(id: string, d: { brief: string | null; subject: string; body: string; tier: Tier }) {
  let body = d.body.trim();
  if (!body.includes("[NAME]")) body = `Hi [NAME],\n\n${body}`;
  const { error } = await db()
    .from("candidates")
    .update({ brief: d.brief, email_subject: d.subject.trim(), email_body: body, draft_tier: d.tier, draft_edited: false })
    .eq("id", id)
    .is("send_status", null);
  if (error) throw new Error(error.message);
}
