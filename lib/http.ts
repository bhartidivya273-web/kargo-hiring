import { NextResponse } from "next/server";

export const fail = (e: unknown, status = 500) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
