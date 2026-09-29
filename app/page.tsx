import { db, ROLES, TOP_N, type Role } from "@/lib/db";
import { computeTiers, loadRubric } from "@/lib/pipeline";
import { fillName } from "@/lib/pii";
import Board, { type Cand } from "@/components/Board";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const role: Role = (await searchParams).role === "SPM" ? "SPM" : "PM";
  const other: Role = role === "PM" ? "SPM" : "PM";
  const s = db();

  let rubric;
  try {
    rubric = await loadRubric();
  } catch (e) {
    return <p className="err">{(e as Error).message}</p>;
  }

  const [cands, scores, tiers, counts] = await Promise.all([
    s
      .from("candidates")
      .select(
        "id,applied_role,file_name,status,error,pm_score,spm_score,override_tier,brief,email_subject,email_body,draft_tier,draft_edited,send_status,sent_at,sent_tier,sent_to,created_at, candidate_pii(name,email,phone)"
      )
      .eq("applied_role", role),
    s.from("scores").select("candidate_id,criterion_id,score,reason"),
    computeTiers(role),
    s.from("candidates").select("applied_role, status"),
  ]);
  if (cands.error) return <p className="err">{cands.error.message}</p>;

  // Where would this person rank if they had applied for the other role?
  const otherScores = (
    await s.from("candidates").select("id,pm_score,spm_score").eq("applied_role", other).eq("status", "scored")
  ).data ?? [];
  const otherCol = other === "PM" ? "pm_score" : "spm_score";

  const list: Cand[] = cands.data.map((c) => {
    const pii = (Array.isArray(c.candidate_pii) ? c.candidate_pii[0] : c.candidate_pii) ?? { name: null, email: null, phone: null };
    const t = tiers.get(c.id);
    const myOther = Number(c[otherCol] ?? 0);
    const crossRank = 1 + otherScores.filter((o) => Number(o[otherCol] ?? 0) > myOther).length;
    return {
      id: c.id,
      fileName: c.file_name,
      status: c.status,
      error: c.error,
      name: pii.name,
      email: pii.email,
      phone: pii.phone,
      score: c[role === "PM" ? "pm_score" : "spm_score"],
      otherScore: c[otherCol],
      crossRank,
      rank: t?.rank ?? null,
      autoTier: t?.autoTier ?? null,
      tier: t?.tier ?? null,
      override: c.override_tier,
      brief: c.brief,
      subject: c.email_subject ? fillName(c.email_subject, pii) : null,
      body: c.email_body ? fillName(c.email_body, pii) : null,
      draftTier: c.draft_tier,
      draftEdited: c.draft_edited,
      sendStatus: c.send_status,
      sentAt: c.sent_at,
      sentTier: c.sent_tier,
      sentTo: c.sent_to,
      scores: Object.fromEntries(
        (scores.data ?? []).filter((x) => x.candidate_id === c.id).map((x) => [x.criterion_id, { score: x.score, reason: x.reason }])
      ),
    };
  });
  list.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));

  const n = (r: Role) => (counts.data ?? []).filter((x) => x.applied_role === r).length;

  return (
    <Board
      role={role}
      other={other}
      topN={TOP_N}
      counts={Object.fromEntries(ROLES.map((r) => [r, n(r)])) as Record<Role, number>}
      criteria={rubric.criteria}
      roleTitles={Object.fromEntries(rubric.roles.map((r) => [r.code, r.title]))}
      cands={list}
      testOverride={process.env.EMAIL_TEST_OVERRIDE || null}
    />
  );
}
