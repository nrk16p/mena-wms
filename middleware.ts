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

// Routes restricted to admin role only
const ADMIN_PREFIXES = ["/codes", "/api/codes"]

// Read-only API routes under /api/codes that non-admins still need
const CODES_API_READONLY_PREFIXES = [
  "/api/codes/parts-tree",
  "/api/codes/SYSTEM_L1",
  "/api/codes/SUB_ASSEMBLY_L2",
  "/api/codes/COMPONENT_L3",
  "/api/codes/EXPENSE_TYPE",
  "/api/codes/WAREHOUSE",
  "/api/codes/POSITION",
  "/api/codes/UNIT",
  "/api/codes/GRADE",
  "/api/codes/VEHICLE_TYPE",
  "/api/codes/BRAND",
]

export async function middleware(request: NextRequest) {
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

  // Admin-only routes — decode JWT to check role
  const isReadonlyCodesApi = CODES_API_READONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  const isAdminRoute = !isReadonlyCodesApi && ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  if (isAdminRoute) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    if (token?.role !== "admin") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 })
      }
      return NextResponse.redirect(new URL("/", request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot)$).*)"],
}
