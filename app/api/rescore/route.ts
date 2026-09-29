import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scoreCandidate } from "@/lib/pipeline";
import { fail } from "@/lib/http";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { id } = await req.json();
  try {
    await scoreCandidate(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await db().from("candidates").update({ status: "error", error: String((e as Error).message) }).eq("id", id);
    return fail(e);
  }
}
