import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"
import { accessFor, checkRequest, SECTION_LABELS, type Overrides, type Section } from "./lib/access-policy"
import { isSuperAdmin } from "./lib/roles"
import { auditorActive, isExternalAuditor } from "./lib/external-auditors"

// API routes the mobile app may call with an x-api-key header instead of a browser session
const MOBILE_API_PREFIXES = [
  "/api/tire-change-request",
  "/api/tire-change",
  "/api/tire-stock",
  "/api/tire-fleet",
  "/api/tire-due",
  "/api/vehicles",
]

// sync อู่ WMS ⇄ Mena-Next เรียกแบบ server-to-server ได้ด้วย x-api-key = ATMS_API_KEY (key เดียวกับที่ WMS ใช้คุยกับ Mena-Next)
// ไม่ต้องมี session — route ตรวจ key ซ้ำเองแล้วบันทึกผู้ทำเป็น "ระบบ (API key)"
const GARAGE_SYNC_API = [/^\/api\/garage-sync\/tick$/, /^\/api\/repair-external\/[^/]+\/push-next-garage$/]

function withCors(res: NextResponse, origin: string | null): NextResponse {
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin)
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, x-api-key, x-user")
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

  // ฟอร์มขอราคาอู่ (Vendor RFQ): อู่เปิดจากลิงก์ ไม่มี session — token ในเส้นทางคือสิทธิ์ (ตรวจใน route เอง)
  if (pathname.startsWith("/q/") || pathname.startsWith("/api/q/")) {
    return NextResponse.next()
  }

  // Public read-only sync API + คู่มือ API สำหรับทีมภายนอก (ไม่ต้อง login / ไม่ต้องมี api key)
  if (pathname === "/repair-external/api-guide" || pathname === "/tire/api-guide") {
    return NextResponse.next()
  }
  // sync API เปิด public ทุก method (อ่าน + เขียน) ตามการตัดสินใจของทีม 2026-08-06
  // — ถ้าจะเพิ่มความปลอดภัยภายหลัง: ย้าย path นี้ไป MOBILE_API_PREFIXES (บังคับ x-api-key)
  // /sync/upload = ขอลิงก์อัปโหลดไฟล์แนบ/ใบเสนอราคา — เปิด public เหมือน /sync (ผู้ใช้เลือก 2026-09-25)
  // /sync/comment = Mena-Next เขียนข้อความ · /sync/changes = feed เหตุการณ์ (2026-09-25)
  if (pathname === "/api/repair-external/sync" || pathname.startsWith("/api/repair-external/sync/")) {
    const syncOrigin = request.headers.get("origin")
    if (request.method === "OPTIONS") return withCors(new NextResponse(null, { status: 204 }), syncOrigin)
    return withCors(NextResponse.next(), syncOrigin)
  }
  // Reference data งานซ่อมสำหรับ mena-intelligence (truck_utilize_analysis) — public อ่านอย่างเดียว
  if (pathname === "/api/repair-external/utilize-ref" && (request.method === "GET" || request.method === "OPTIONS")) {
    const refOrigin = request.headers.get("origin")
    if (request.method === "OPTIONS") return withCors(new NextResponse(null, { status: 204 }), refOrigin)
    return withCors(NextResponse.next(), refOrigin)
  }

  // ดึงข้อมูลยางรายคัน — public อ่านอย่างเดียว (ตามการตัดสินใจของทีม 2026-09-08)
  // เปิดให้เบราว์เซอร์/แอปเรียกได้ตรง ๆ โดยไม่ต้องมี x-api-key
  // — เขียน (POST/PUT/PATCH/DELETE) ยังต้องมี session หรือ x-api-key เหมือนเดิม
  if (pathname === "/api/tire-change-request/lookup" && READ_METHODS.has(request.method)) {
    const lookupOrigin = request.headers.get("origin")
    if (request.method === "OPTIONS") return withCors(new NextResponse(null, { status: 204 }), lookupOrigin)
    return withCors(NextResponse.next(), lookupOrigin)
  }

  // สร้าง/แก้คำขอเปลี่ยนยาง — public เขียนได้ ไม่ต้องมี x-api-key (ตามการตัดสินใจของทีม 2026-09-08)
  // — ถ้าจะคุมความปลอดภัยภายหลัง: ลบบล็อกนี้ออก แล้ว path จะกลับไปบังคับ session/x-api-key เอง
  // .../[id]/items — เพิ่มรายการยางเข้าใบคำขอ (ขั้นที่ 2 ของ flow เดียวกัน) ก็เปิด public ด้วย
  //   ครอบเฉพาะ /items ตรง ๆ — /items/[itemId] (แก้/ลบรายเส้น) ยังต้องมี session หรือ x-api-key
  const isPublicItemsPost = /^\/api\/tire-change-request\/[^/]+\/items$/.test(pathname)
  if ((pathname === "/api/tire-change-request" || isPublicItemsPost) && (request.method === "POST" || request.method === "OPTIONS")) {
    const postOrigin = request.headers.get("origin")
    if (request.method === "OPTIONS") return withCors(new NextResponse(null, { status: 204 }), postOrigin)
    return withCors(NextResponse.next(), postOrigin)
  }

  // Mobile app access via API key
  if (GARAGE_SYNC_API.some((r) => r.test(pathname))) {
    const k = request.headers.get("x-api-key")
    if (k && process.env.ATMS_API_KEY && k === process.env.ATMS_API_KEY) return NextResponse.next()
  }
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
    // เก็บ query string ด้วย — deep link เช่น /repair-external?q=TH1099 จะได้ไม่หลุดหลัง login
    loginUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // ตรวจ JWT จริง — เดิมเช็คแค่ว่ามี cookie (cookie ปลอมผ่านได้) · ถอดรหัสไม่ผ่าน = เหมือนไม่ได้ล็อกอิน
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized — invalid session" }, { status: 401 })
    }
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // ผู้ตรวจสอบภายนอกหมดอายุ (lib/external-auditors.ts) → ตัดทุกหน้า/ทุก API แม้ยัง login ค้างอยู่
  if (isExternalAuditor(token.email) && !auditorActive(token.email)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "สิทธิ์ผู้ตรวจสอบภายนอกหมดอายุแล้ว", code: "auditor_expired" }, { status: 403 })
    }
    if (pathname !== "/unauthorized") {
      const url = new URL("/unauthorized", request.url)
      url.searchParams.set("section", "expired")
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // สิทธิ์ตามแผนก (lib/access-policy.ts): ไม่เห็น → บล็อกหน้า + API · ดูอย่างเดียว → บล็อก API ที่เขียนข้อมูล
  const access = accessFor({ department: token.employee?.department, email: token.email, overrides: token.accessOverrides as Overrides })
  const decision = checkRequest({ pathname, method: request.method, access, isSuperAdmin: isSuperAdmin(token.email) })
  if (!decision.ok) {
    const label = decision.section === "admin" ? "ผู้ดูแลระบบ" : SECTION_LABELS[decision.section as Section]
    if (decision.api) {
      const message = decision.need === "edit"
        ? `คุณมีสิทธิ์ดูอย่างเดียวในส่วน "${label}" — แก้ไขไม่ได้`
        : `คุณไม่มีสิทธิ์เข้าถึงส่วน "${label}"`
      // error = ข้อความไทย (หน้าส่วนใหญ่แสดง data.error ตรง ๆ) · code ไว้ให้โค้ดแยกกรณี
      return NextResponse.json({ error: message, code: "no_access", section: decision.section, need: decision.need }, { status: 403 })
    }
    const url = new URL("/unauthorized", request.url)
    url.searchParams.set("from", pathname)
    url.searchParams.set("section", decision.section)
    return NextResponse.redirect(url)
  }

  // Code Dictionary: pages + GET are open to all; writes are admin-only.
  const isCodesApi      = pathname === CODES_API_PREFIX || pathname.startsWith(CODES_API_PREFIX + "/")
  const isCodesApiWrite = isCodesApi && !READ_METHODS.has(request.method)
  if (isCodesApiWrite && token.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot)$).*)"],
}
