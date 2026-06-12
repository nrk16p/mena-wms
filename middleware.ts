import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// API routes the mobile app may call with an x-api-key header instead of a browser session
const MOBILE_API_PREFIXES = [
  "/api/tire-change-request",
  "/api/tire-change",
  "/api/tire-stock",
  "/api/vehicles",
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow auth API and login page through
  if (pathname.startsWith("/api/auth") || pathname === "/login") {
    return NextResponse.next()
  }

  // Mobile app access via API key
  if (MOBILE_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    const apiKey = request.headers.get("x-api-key")
    if (apiKey && process.env.MOBILE_API_KEY && apiKey === process.env.MOBILE_API_KEY) {
      return NextResponse.next()
    }
  }

  // Check for session cookie — NextAuth uses different names for http vs https
  const sessionToken =
    request.cookies.get("next-auth.session-token")?.value ??
    request.cookies.get("__Secure-next-auth.session-token")?.value

  if (!sessionToken) {
    // API calls get a JSON 401 (mobile-friendly); pages redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized — login session or valid x-api-key required" }, { status: 401 })
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot)$).*)"],
}
