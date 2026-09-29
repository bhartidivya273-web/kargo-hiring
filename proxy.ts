import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, authToken } from "./lib/auth";

// Single-user password gate: the dashboard holds candidate PII on a public URL.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  const token = await authToken();
  if (!token) return new NextResponse("Set DASHBOARD_PASSWORD in the environment to use this app.", { status: 503 });
  if (req.cookies.get(COOKIE)?.value === token) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
