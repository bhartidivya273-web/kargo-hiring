import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db, ROLES, type Role } from "@/lib/db";
import { fileToText } from "@/lib/parse";
import { assertNoPII, separatePII } from "@/lib/pii";
import { scoreCandidate } from "@/lib/pipeline";
import { fail } from "@/lib/http";

export const maxDuration = 300;

// Upload one CV: parse -> separate personal details -> store -> score against both rubrics.
// Drafts (brief + email) are generated afterwards via /api/drafts, because a new
// score can move the line for other candidates too.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const role = form.get("role") as Role;
  if (!(file instanceof File)) return fail("No file", 400);
  if (!ROLES.includes(role)) return fail("Pick PM or SPM", 400);

  let raw: string;
  try {
    raw = await fileToText(file.name, await file.arrayBuffer());
  } catch (e) {
    return fail(e, 422);
  }

  const s = db();
  const hash = createHash("sha256").update(raw).digest("hex");
  const dup = await s.from("candidates").select("id,status").eq("content_hash", hash).maybeSingle();
  if (dup.data) {
    if (dup.data.status === "scored") return NextResponse.json({ id: dup.data.id, duplicate: true });
    try {
      await scoreCandidate(dup.data.id);
      return NextResponse.json({ id: dup.data.id, rescored: true });
    } catch (e) {
      await s.from("candidates").update({ status: "error", error: String((e as Error).message) }).eq("id", dup.data.id);
      return fail(e);
    }
  }

  const { pii, content } = separatePII(raw);
  try {
    assertNoPII(content, pii);
  } catch (e) {
    return fail(`Could not fully strip personal details from ${file.name}: ${(e as Error).message}`, 422);
  }

  const ins = await s
    .from("candidates")
    .insert({ applied_role: role, file_name: file.name, content_hash: hash, cv_text: content, status: "pending" })
    .select("id")
    .single();
  if (ins.error) return fail(ins.error.message);
  const id = ins.data.id as string;
  const p = await s.from("candidate_pii").insert({ candidate_id: id, ...pii });
  if (p.error) {
    await s.from("candidates").delete().eq("id", id);
    return fail(p.error.message);
  }

  try {
    await scoreCandidate(id);
  } catch (e) {
    await s.from("candidates").update({ status: "error", error: String((e as Error).message) }).eq("id", id);
    return NextResponse.json({ id, name: pii.name, error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ id, name: pii.name, email: pii.email });
}
