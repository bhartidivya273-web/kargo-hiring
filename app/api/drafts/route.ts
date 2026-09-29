import { NextResponse } from "next/server";
import { generateDraft, pendingDrafts } from "@/lib/pipeline";
import { fail } from "@/lib/http";

export const maxDuration = 300;

// GET: candidates whose brief/email draft is missing or stale (the line moved).
export async function GET() {
  try {
    return NextResponse.json({ ids: await pendingDrafts() });
  } catch (e) {
    return fail(e);
  }
}

// POST {id}: (re)generate that candidate's brief + email for their current tier.
export async function POST(req: Request) {
  const { id } = await req.json();
  try {
    await generateDraft(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
