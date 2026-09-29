"use client";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { runDrafts } from "./runDrafts";

type Role = "PM" | "SPM";
type Tier = "invite" | "reject";
type Criterion = { id: number; role: Role; name: string; weight: number };

export type Cand = {
  id: string;
  fileName: string;
  status: string;
  error: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  score: number | null;
  otherScore: number | null;
  crossRank: number;
  rank: number | null;
  autoTier: Tier | null;
  tier: Tier | null;
  override: Tier | null;
  brief: string | null;
  subject: string | null;
  body: string | null;
  draftTier: Tier | null;
  draftEdited: boolean;
  sendStatus: string | null;
  sentAt: string | null;
  sentTier: string | null;
  sentTo: string | null;
  scores: Record<number, { score: number; reason: string }>;
};

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export default function Board(props: {
  role: Role;
  other: Role;
  topN: number;
  counts: Record<Role, number>;
  criteria: Criterion[];
  roleTitles: Record<string, string>;
  cands: Cand[];
  testOverride: string | null;
}) {
  const { role, other, topN, cands } = props;
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [draftMsg, setDraftMsg] = useState("");

  const stale = cands.some((c) => c.status === "scored" && !c.sendStatus && (!c.body || c.draftTier !== c.tier));
  const refreshDrafts = async () => {
    await runDrafts((d, t, err) => {
      setDraftMsg(t ? `Drafting briefs + emails: ${d}/${t}${err ? ` · error: ${err}` : ""}` : err || "");
      if (d > 0) router.refresh();
    });
    setDraftMsg((m) => (m.includes("error") ? m : ""));
    router.refresh();
  };
  useEffect(() => {
    if (stale) refreshDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  const scored = cands.filter((c) => c.status === "scored");
  const failed = cands.filter((c) => c.status !== "scored");
  const sent = scored.filter((c) => c.sendStatus === "sent").length;

  return (
    <>
      <div className="tabs">
        {(["PM", "SPM"] as Role[]).map((r) => (
          <a key={r} href={`/?role=${r}`} className={r === role ? "on" : ""}>
            {props.roleTitles[r] ?? r} ({props.counts[r]})
          </a>
        ))}
      </div>
      <p className="muted small">
        Ranked by {role} score. Top {topN} sit above the line and get a brief + invite draft; everyone else gets a warm rejection
        draft. Nothing is sent until you click Send. {sent}/{scored.length} sent.
        {props.testOverride && <b className="err"> Test mode: all emails go to {props.testOverride}.</b>}
      </p>
      {draftMsg && <p className="banner">{draftMsg}</p>}
      {!scored.length && !failed.length && (
        <p className="banner">
          No {role} candidates yet. <a href="/upload">Upload CVs</a>.
        </p>
      )}

      {scored.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Candidate</th>
              <th className="num">{role} score</th>
              <th className="num">{other} score</th>
              <th>Draft</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((c, i) => (
              <Fragment key={c.id}>
                <tr className={`row ${open === c.id ? "open" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <td className="num">{c.rank}</td>
                  <td>
                    <b>{c.name ?? "(name not found)"}</b> <span className="muted small">{c.fileName}</span>
                    {c.crossRank <= topN && (
                      <div className="small muted">Would rank #{c.crossRank} among {other} applicants</div>
                    )}
                  </td>
                  <td className="num"><b>{c.score}</b></td>
                  <td className="num muted">{c.otherScore}</td>
                  <td>
                    {c.tier && <span className={`tag ${c.tier}`}>{c.tier === "invite" ? "Invite" : "Rejection"}</span>}
                    {c.override && <span className="small muted"> (your call)</span>}
                  </td>
                  <td>
                    {c.sendStatus === "sent" ? (
                      <span className="tag sent">Sent {c.sentTier === "invite" ? "invite" : "rejection"}</span>
                    ) : c.body && c.draftTier === c.tier ? (
                      <span className="small">Ready to review</span>
                    ) : (
                      <span className="small muted">Drafting…</span>
                    )}
                  </td>
                </tr>
                {open === c.id && (
                  <tr>
                    <td colSpan={6}>
                      <Detail c={c} {...props} onChange={() => router.refresh()} onRedraft={refreshDrafts} />
                    </td>
                  </tr>
                )}
                {i === Math.min(topN, scored.length) - 1 && i < scored.length - 1 && (
                  <tr className="line">
                    <td colSpan={6}>the line: above = invite drafts · below = rejection drafts</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {failed.length > 0 && (
        <>
          <h2>Not scored</h2>
          <table>
            <tbody>
              {failed.map((c) => (
                <tr key={c.id}>
                  <td>{c.name ?? c.fileName}</td>
                  <td className={c.status === "error" ? "err small" : "muted small"}>{c.status === "error" ? c.error : "scoring…"}</td>
                  <td>
                    <RetryButton id={c.id} onDone={() => router.refresh()} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function RetryButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/rescore", "POST", { id });
        } catch (e) {
          alert((e as Error).message);
        }
        setBusy(false);
        onDone();
      }}
    >
      {busy ? "Scoring…" : "Retry scoring"}
    </button>
  );
}

function ScoreTable({ c, criteria, role, title }: { c: Cand; criteria: Criterion[]; role: Role; title: string }) {
  const crit = criteria.filter((x) => x.role === role);
  return (
    <>
      <h3>{title}</h3>
      <table className="small">
        <tbody>
          {crit.map((k) => (
            <tr key={k.id}>
              <td style={{ width: "34%" }}>
                {k.name} <span className="muted">({k.weight}%)</span>
              </td>
              <td className="num" style={{ width: 36 }}><b>{c.scores[k.id]?.score ?? "–"}</b>/3</td>
              <td>{c.scores[k.id]?.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Detail(props: {
  c: Cand;
  role: Role;
  other: Role;
  criteria: Criterion[];
  roleTitles: Record<string, string>;
  testOverride: string | null;
  onChange: () => void;
  onRedraft: () => Promise<void>;
}) {
  const { c, role, other, criteria } = props;
  const [subject, setSubject] = useState(c.subject ?? "");
  const [body, setBody] = useState(c.body ?? "");
  const [contact, setContact] = useState({ name: c.name ?? "", email: c.email ?? "", phone: c.phone ?? "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setSubject(c.subject ?? "");
    setBody(c.body ?? "");
  }, [c.subject, c.body]);

  const isSent = c.sendStatus === "sent";
  const draftReady = !!c.body && c.draftTier === c.tier;
  const dirty = subject !== (c.subject ?? "") || body !== (c.body ?? "");
  const contactDirty = contact.name !== (c.name ?? "") || contact.email !== (c.email ?? "") || contact.phone !== (c.phone ?? "");
  const to = props.testOverride || c.email;

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setMsg("");
    try {
      await fn();
      props.onChange();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy("");
  }

  const flipTo: Tier = c.tier === "invite" ? "reject" : "invite";

  return (
    <div className="detail">
      <div>
        {c.brief ? (
          <>
            <h3>Interview brief</h3>
            <div className="brief">{c.brief}</div>
          </>
        ) : (
          <p className="muted small">No brief: briefs are written for candidates above the line.</p>
        )}
        <ScoreTable c={c} criteria={criteria} role={role} title={`${role} rubric · ${c.score}/100 · rank ${c.rank}`} />
        <ScoreTable c={c} criteria={criteria} role={other} title={`${other} rubric · ${c.otherScore}/100`} />

        <h3>Contact (stored privately, never sent to the AI)</h3>
        <div className="row-fields">
          <input type="text" value={contact.name} placeholder="Name" disabled={isSent} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <input type="email" value={contact.email} placeholder="Email" disabled={isSent} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <input type="text" value={contact.phone} placeholder="Phone" disabled={isSent} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
        </div>
        {contactDirty && (
          <div className="actions">
            <button onClick={() => act("contact", () => api(`/api/candidates/${c.id}`, "PATCH", contact))}>Save contact</button>
          </div>
        )}
      </div>

      <div>
        <h3>
          {isSent ? "Sent email" : c.tier === "invite" ? "Draft: interview invite" : "Draft: rejection"}
          {c.override && !isSent && <span className="muted small"> · you moved this from {c.autoTier}</span>}
        </h3>
        {isSent ? (
          <p className="sent small">
            Sent {c.sentTier} to {c.sentTo} on {new Date(c.sentAt!).toLocaleString()}.
          </p>
        ) : !draftReady ? (
          <p className="muted">Drafting…</p>
        ) : null}
        {(draftReady || isSent) && (
          <>
            <p className="small muted">To: {to ?? <span className="err">no email on file</span>}</p>
            <input type="text" value={subject} disabled={isSent} onChange={(e) => setSubject(e.target.value)} />
            <textarea value={body} disabled={isSent} onChange={(e) => setBody(e.target.value)} style={{ marginTop: 6 }} />
          </>
        )}
        {!isSent && (
          <div className="actions">
            {draftReady && (
              <button
                className="primary"
                disabled={!!busy || !to || dirty}
                title={dirty ? "Save your edits first" : ""}
                onClick={() => {
                  if (!confirm(`Send this ${c.tier === "invite" ? "interview invite" : "rejection"} to ${to}?`)) return;
                  act("send", () => api("/api/send", "POST", { id: c.id }));
                }}
              >
                {busy === "send" ? "Sending…" : c.tier === "invite" ? "Send invite" : "Send rejection"}
              </button>
            )}
            {dirty && (
              <button disabled={!!busy} onClick={() => act("save", () => api(`/api/candidates/${c.id}`, "PATCH", { email_subject: subject, email_body: body }))}>
                Save edits
              </button>
            )}
            <button
              disabled={!!busy}
              onClick={() =>
                act("flip", async () => {
                  await api(`/api/candidates/${c.id}`, "PATCH", { override_tier: flipTo === c.autoTier ? null : flipTo });
                  props.onChange();
                  await props.onRedraft();
                })
              }
            >
              {busy === "flip" ? "Redrafting…" : flipTo === "invite" ? "Move to invite" : "Move to rejection"}
            </button>
            {draftReady && (
              <button
                disabled={!!busy}
                onClick={() => {
                  if (c.draftEdited && !confirm("Discard your edits and redraft?")) return;
                  act("regen", () => api("/api/drafts", "POST", { id: c.id }));
                }}
              >
                {busy === "regen" ? "Redrafting…" : "Redraft"}
              </button>
            )}
            <button
              disabled={!!busy}
              onClick={() => {
                if (!confirm(`Delete ${c.name ?? "this candidate"} and all their data? This cannot be undone.`)) return;
                act("delete", () => api(`/api/candidates/${c.id}`, "DELETE"));
              }}
            >
              Delete
            </button>
          </div>
        )}
        {msg && <p className="err small">{msg}</p>}
      </div>
    </div>
  );
}
