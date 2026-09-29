"use client";
import { useState } from "react";
import { runDrafts } from "@/components/runDrafts";

type Item = { name: string; state: string; ok?: boolean };

export default function Upload() {
  const [role, setRole] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");

  const set = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function go() {
    setBusy(true);
    setDraftMsg("");
    setItems(files.map((f) => ({ name: f.name, state: "waiting" })));
    let next = 0;
    // Two at a time: fast enough for 60 CVs, gentle on the Gemini rate limit.
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        set(i, { state: "reading + scoring…" });
        const fd = new FormData();
        fd.append("file", files[i]);
        fd.append("role", role);
        try {
          const r = await fetch("/api/upload", { method: "POST", body: fd });
          const j = await r.json();
          if (!r.ok) set(i, { state: j.error || `HTTP ${r.status}`, ok: false });
          else set(i, { state: j.duplicate ? "already uploaded (skipped)" : `scored${j.name ? ` · ${j.name}` : ""}`, ok: true });
        } catch (e) {
          set(i, { state: String(e), ok: false });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    await runDrafts((d, t, err) => setDraftMsg(t ? `Drafting briefs + emails: ${d}/${t}${err ? ` · last error: ${err}` : ""}` : err || "All drafts up to date."));
    setDraftMsg((m) => (m.startsWith("Drafting") ? m + " · done" : m));
    setBusy(false);
  }

  return (
    <>
      <h1>Upload CVs</h1>
      <p className="muted small">
        Name, email and phone are separated out in code and stored privately before anything reaches the AI. Every CV is scored
        against both the PM and SPM rubrics. PDF, DOCX or TXT.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", maxWidth: 700 }}>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 240 }}>
          <option value="">Applied for…</option>
          <option value="PM">Product Manager (PM)</option>
          <option value="SPM">Senior Product Manager (SPM)</option>
        </select>
        <input type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <button className="primary" disabled={!role || !files.length || busy} onClick={go}>
          {busy ? "Working…" : `Upload ${files.length || ""}`}
        </button>
      </div>
      {items.length > 0 && (
        <table style={{ marginTop: 16, maxWidth: 900 }}>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td>{it.name}</td>
                <td className={it.ok === false ? "err" : it.ok ? "invite" : "muted"}>{it.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {draftMsg && <p className="banner">{draftMsg}</p>}
      {!busy && items.length > 0 && <p><a href="/">Open the dashboard →</a></p>}
    </>
  );
}
