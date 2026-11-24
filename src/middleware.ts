import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, SITE_GATE_CHALLENGE } from "@/lib/site-gate";

/**
 * Hosted demo gate (D-085): with `SITE_PASSWORD` set, every page, action and API route needs
 * HTTP Basic credentials (any username, that password). Unset (dev, tests), it lets all through.
 * Node runtime so the variable is read when the server runs, not when it is built.
 */
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password || checkBasicAuth(req.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": SITE_GATE_CHALLENGE },
  });
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
