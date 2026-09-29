// Client-side: generate every missing/stale draft one at a time (keeps each
// request well inside serverless time limits and Gemini rate limits).
export async function runDrafts(onProgress: (done: number, total: number, err?: string) => void, depth = 0): Promise<void> {
  const res = await fetch("/api/drafts");
  const { ids = [], error } = await res.json();
  if (error) return onProgress(0, 0, error);
  let done = 0;
  onProgress(0, ids.length);
  for (const id of ids as string[]) {
    const r = await fetch("/api/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    done++;
    onProgress(done, ids.length, r.ok ? undefined : (await r.json()).error);
  }
  // If new candidates became stale meanwhile (e.g. an upload in another tab moved
  // the line), pick them up. Failures are not retried here, to avoid looping.
  const again = await (await fetch("/api/drafts")).json();
  const fresh = (again.ids ?? []).filter((x: string) => !ids.includes(x));
  if (fresh.length && depth < 3) return runDrafts(onProgress, depth + 1);
}
