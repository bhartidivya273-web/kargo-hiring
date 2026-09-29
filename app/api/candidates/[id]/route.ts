import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

// Founder edits: decision override, draft text, contact details.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = await req.json();
  const s = db();
  const { data: c } = await s.from("candidates").select("send_status").eq("id", id).single();
  if (!c) return fail("Not found", 404);

  if ("name" in b || "email" in b || "phone" in b) {
    const pii: Record<string, string | null> = {};
    for (const k of ["name", "email", "phone"]) if (k in b) pii[k] = b[k]?.trim() || null;
    const r = await s.from("candidate_pii").update(pii).eq("candidate_id", id);
    if (r.error) return fail(r.error.message);
  }

  const upd: Record<string, unknown> = {};
  if ("override_tier" in b) upd.override_tier = b.override_tier || null;
  if ("email_subject" in b) upd.email_subject = b.email_subject;
  if ("email_body" in b) upd.email_body = b.email_body;
  if ("email_subject" in b || "email_body" in b) upd.draft_edited = true;
  if (Object.keys(upd).length) {
    if (c.send_status) return fail("Already sent; nothing to change", 409);
    const r = await s.from("candidates").update(upd).eq("id", id);
    if (r.error) return fail(r.error.message);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await db().from("candidates").delete().eq("id", id);
  if (r.error) return fail(r.error.message);
  return NextResponse.json({ ok: true });
}
