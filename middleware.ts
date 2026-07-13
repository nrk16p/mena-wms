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

// Code Dictionary access model:
//   • /codes pages       → viewable by everyone (read-only views)
//   • /api/codes  GET    → readable by everyone (dropdowns, tables, parts tree)
//   • /api/codes  writes → admin only (POST / PUT / PATCH / DELETE)
const CODES_API_PREFIX = "/api/codes"
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

// อนุญาต cross-origin เฉพาะ mobile API — ปลอดภัยเพราะ endpoint เหล่านี้บังคับ x-api-key
// และ client ส่ง credentials: 'omit' (ไม่มี cookie ข้าม origin)
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, x-api-key",
  "Access-Control-Max-Age": "86400",
}

function withCors(res: NextResponse): NextResponse {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v))
  return res
}

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

  const isMobileApi = MOBILE_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))

  // Preflight OPTIONS ไม่แนบ x-api-key/cookie — ต้องตอบ 204 + CORS ก่อนถึงด่าน auth
  if (isMobileApi && request.method === "OPTIONS") {
    return withCors(new NextResponse(null, { status: 204 }))
  }

  // Mobile app access via API key
  if (isMobileApi) {
    const apiKey = request.headers.get("x-api-key")
    if (apiKey && process.env.MOBILE_API_KEY && apiKey === process.env.MOBILE_API_KEY) {
      return withCors(NextResponse.next())
    }
  }

  // Check for session cookie — NextAuth uses different names for http vs https
  const sessionToken =
    request.cookies.get("next-auth.session-token")?.value ??
    request.cookies.get("__Secure-next-auth.session-token")?.value

  if (!sessionToken) {
    // API calls get a JSON 401 (mobile-friendly); pages redirect to login
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Unauthorized — login session or valid x-api-key required" }, { status: 401 })
      return isMobileApi ? withCors(res) : res
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
