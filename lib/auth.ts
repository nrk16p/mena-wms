import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { isAdmin } from "./roles"
import { loginWithGoogleIdToken, fetchEmployee, idTokenDebug, MENA_API_BASE } from "./mena-api"
import { missingEmployeeFields } from "./session-profile"

const ALLOWED_DOMAIN = "menatransport.co.th"

// log โปรไฟล์ผู้ใช้ทุกครั้งที่ login สำเร็จ
//   • dev  → เห็นใน terminal ที่รัน `next dev`
//   • prod → เห็นใน Vercel Runtime Logs (ไม่ใช่ Web Analytics — อันนั้นเก็บแค่ pageview)
// ไม่ log access token / id_token — ฝั่ง lib/mena-api.ts mask ให้แล้ว
function logLogin(token: { email?: string | null; name?: string | null; sub?: string }, extra: Record<string, unknown>) {
  console.log(
    "[auth] google login " +
    JSON.stringify(
      {
        at: new Date().toISOString(),
        email: token.email,
        name: token.name,
        googleSub: token.sub,
        role: isAdmin(token.email) ? "admin" : "user",
        ...extra,
      },
      null,
      2,
    ),
  )
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // ตรงกับ MenaIT service — ให้ Google กรองโดเมนตั้งแต่หน้าเลือกบัญชี
      // hd เป็นแค่ hint ฝั่ง Google (บังคับจริงที่ signIn callback ด้านล่าง)
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
          hd: ALLOWED_DOMAIN,
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = user?.email ?? profile?.email ?? ""
      const domain = email.split("@")[1]?.toLowerCase()
      if (domain !== ALLOWED_DOMAIN) return false // → /login?error=AccessDenied

      // ยืนยันกับ Google ว่าอีเมลนี้ผ่านการ verify แล้วจริง
      // claim มาจาก id_token ที่ Google เซ็น (NextAuth verify ลายเซ็นให้แล้วตอนแลก code)
      // ป้องกันบัญชีที่ตั้งอีเมลเองโดยยังไม่ยืนยัน แอบเข้า WMS ผ่านการเช็คโดเมนอย่างเดียว
      if (account?.provider === "google") {
        const g = profile as { email_verified?: boolean | string; hd?: string } | undefined
        const verified = g?.email_verified === true || g?.email_verified === "true"
        if (!verified) {
          console.warn(`[auth] blocked unverified google email: ${email}`)
          return "/login?error=EmailNotVerified"
        }
        // hd = Google Workspace hosted domain — ถ้ามีต้องตรงกับองค์กร (กัน alias จากบัญชีนอก)
        if (g?.hd && g.hd.toLowerCase() !== ALLOWED_DOMAIN) {
          console.warn(`[auth] blocked foreign hosted domain: ${g.hd} (${email})`)
          return false
        }
      }

      return true
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.email = token.email ?? (profile as { email?: string })?.email

        // ส่ง Google id_token ไปแลกกับ Mena API (POST /auth/login/google) — ทำเฉพาะตอน sign-in ครั้งแรก
        // fail-soft: ถ้า API ล่ม/cold start ยังให้ login เข้าระบบ WMS ได้ตามปกติ
        if (account.provider === "google" && account.id_token) {
          try {
            const login = await loginWithGoogleIdToken(account.id_token)
            let employee = login.profile ?? undefined

            // /auth/login/google บางครั้งคืนโปรไฟล์แบบย่อ (ไม่มี department/position)
            // → ดึงเต็มจาก /users/{id} เพื่อให้ session มีข้อมูลครบตามที่ WMS ต้องใช้
            if (employee && missingEmployeeFields(employee).length > 0 && employee.employee_id) {
              const full = await fetchEmployee(employee.employee_id, login.accessToken).catch(() => null)
              if (full) employee = { ...employee, ...full }
            }

            token.apiToken = login.accessToken ?? undefined
            token.apiTokenExpires = login.expiresAt ?? undefined
            token.employee = employee
            token.apiAuthError = undefined
            logLogin(token, {
              apiStatus: "ok",
              apiTokenReceived: Boolean(login.accessToken),
              employee,
              missingFields: missingEmployeeFields(employee),
              // profile = null เมื่อ response ไม่มีฟิลด์ที่รู้จัก — ดู raw เพื่อรู้ชื่อฟิลด์จริง
              apiRaw: login.profile ? undefined : login.raw,
            })
          } catch (e) {
            token.apiToken = undefined
            token.apiTokenExpires = undefined
            token.employee = undefined
            token.apiAuthError = e instanceof Error ? e.message : String(e)
            logLogin(token, {
              apiStatus: "failed",
              apiAuthError: token.apiAuthError,
              apiBase: MENA_API_BASE,
              // "Invalid Google token" มักแปลว่า aud ไม่ตรงกับ GOOGLE_CLIENT_ID ฝั่ง API
              idToken: idTokenDebug(account.id_token),
            })
          }
        } else {
          logLogin(token, { apiStatus: "skipped — no google id_token", provider: account.provider })
        }
      }
      token.role = isAdmin(token.email as string) ? "admin" : "user"
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role
        if (token.sub) (session.user as { id?: string }).id = token.sub
        session.user.employee = token.employee
        session.apiAuthError = token.apiAuthError
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: { strategy: "jwt" },
}
