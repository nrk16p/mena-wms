import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

// API routes the mobile app may call with an x-api-key header instead of a browser session
const MOBILE_API_PREFIXES = [
  "/api/tire-change-request",
  "/api/tire-change",
  "/api/tire-stock",
  "/api/vehicles",
]

function withCors(res: NextResponse, origin: string | null): NextResponse {
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin)
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, x-api-key")
    res.headers.set("Access-Control-Max-Age", "86400")
    res.headers.set("Vary", "Origin")
  }
  return res
}

// Code Dictionary access model:
//   • /codes pages       → viewable by everyone (read-only views)
//   • /api/codes  GET    → readable by everyone (dropdowns, tables, parts tree)
//   • /api/codes  writes → admin only (POST / PUT / PATCH / DELETE)
const CODES_API_PREFIX = "/api/codes"
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow auth API and login page through
  if (pathname.startsWith("/api/auth") || pathname === "/login") {
    return NextResponse.next()
  }

  // Vercel Cron requests carry no session cookie — the routes enforce CRON_SECRET themselves
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next()
  }

  // Mobile app access via API key
  const isMobileApi = MOBILE_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  const origin = request.headers.get("origin")
  // Why the x-api-key check failed (if it did) — used to build a diagnosable 401 below
  let apiKeyReason: "not_sent" | "server_key_not_set" | "mismatch" | null = null
  if (isMobileApi) {
    // CORS preflight carries no x-api-key or cookie — answer it before any auth check
    if (request.method === "OPTIONS") {
      return withCors(new NextResponse(null, { status: 204 }), origin)
    }
    const apiKey = request.headers.get("x-api-key")
    if (apiKey && process.env.MOBILE_API_KEY && apiKey === process.env.MOBILE_API_KEY) {
      return withCors(NextResponse.next(), origin)
    }
    if (!apiKey) apiKeyReason = "not_sent"
    else if (!process.env.MOBILE_API_KEY) apiKeyReason = "server_key_not_set"
    else apiKeyReason = "mismatch"
  }

  // Check for session cookie — NextAuth uses different names for http vs https
  const sessionToken =
    request.cookies.get("next-auth.session-token")?.value ??
    request.cookies.get("__Secure-next-auth.session-token")?.value

  if (!sessionToken) {
    // API calls get a JSON 401 (mobile-friendly); pages redirect to login
    if (pathname.startsWith("/api/")) {
      const apiKeyDetail =
        apiKeyReason === "not_sent"           ? "x-api-key header was not sent"
        : apiKeyReason === "server_key_not_set" ? "server has no MOBILE_API_KEY configured"
        : apiKeyReason === "mismatch"          ? "x-api-key does not match"
        : "route does not accept x-api-key"
      console.warn(
        `[middleware] 401 ${request.method} ${pathname} — no session cookie; api-key: ${apiKeyDetail}` +
        (origin ? ` (origin: ${origin})` : "")
      )
      const res = NextResponse.json(
        {
          error: "Unauthorized — login session or valid x-api-key required",
          reason: { session: "no session cookie", apiKey: apiKeyDetail },
        },
        { status: 401 }
      )
      return isMobileApi ? withCors(res, origin) : res
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Code Dictionary: pages + GET are open to all; writes are admin-only.
  const isCodesApi      = pathname === CODES_API_PREFIX || pathname.startsWith(CODES_API_PREFIX + "/")
  const isCodesApiWrite = isCodesApi && !READ_METHODS.has(request.method)
  if (isCodesApiWrite) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    if (token?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot)$).*)"],
}
