import { NextResponse } from "next/server";
import { Resend } from "resend";
import { db, type Role } from "@/lib/db";
import { computeTiers } from "@/lib/pipeline";
import { fillName } from "@/lib/pii";
import { fail } from "@/lib/http";

// Sends ONE candidate's draft. Only ever called from the founder's Send click.
export async function POST(req: Request) {
  const { id } = await req.json();
  if (!process.env.RESEND_API_KEY) return fail("RESEND_API_KEY is not set yet", 400);
  const s = db();

  const { data: c, error } = await s
    .from("candidates")
    .select("id,applied_role,email_subject,email_body,draft_tier,send_status, candidate_pii(name,email)")
    .eq("id", id)
    .single();
  if (error) return fail(error.message, 404);
  const pii = (Array.isArray(c.candidate_pii) ? c.candidate_pii[0] : c.candidate_pii) as { name: string | null; email: string | null } | null;
  if (c.send_status) return fail("Already sent", 409);
  if (!c.email_body || !c.email_subject) return fail("No draft yet", 400);
  const tier = (await computeTiers(c.applied_role as Role)).get(id)?.tier;
  if (tier !== c.draft_tier) return fail("Draft is out of date for this candidate's decision; regenerate first", 409);

  const to = process.env.EMAIL_TEST_OVERRIDE || pii?.email;
  if (!to) return fail("No email address on file for this candidate", 400);

  // Lock the row so a double click cannot send twice.
  const lock = await s.from("candidates").update({ send_status: "sending" }).eq("id", id).is("send_status", null).select("id");
  if (!lock.data?.length) return fail("Already sending or sent", 409);

  const subject = fillName(c.email_subject, pii);
  const text = fillName(c.email_body, pii);
  const { data, error: sendErr } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.RESEND_FROM || "Arjun Mehta <onboarding@resend.dev>",
    to,
    subject,
    text,
  });
  if (sendErr) {
    await s.from("candidates").update({ send_status: null }).eq("id", id);
    return fail(`Resend: ${sendErr.message}`, 502);
  }
  await s
    .from("candidates")
    .update({ send_status: "sent", sent_at: new Date().toISOString(), sent_tier: c.draft_tier, sent_to: to, resend_id: data?.id })
    .eq("id", id);
  return NextResponse.json({ ok: true, to });
}
