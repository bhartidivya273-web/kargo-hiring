import { NextResponse } from "next/server";
import { COOKIE, authToken } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const token = await authToken();
  if (!token || form.get("password") !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
