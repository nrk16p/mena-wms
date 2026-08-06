import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { isAdmin } from "./roles"
import { loginWithGoogleIdToken, idTokenDebug, MENA_API_BASE } from "./mena-api"

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
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      const email  = user?.email ?? profile?.email ?? ""
      const domain = email.split("@")[1]?.toLowerCase()
      return domain === ALLOWED_DOMAIN
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.email = token.email ?? (profile as { email?: string })?.email

        // ส่ง Google id_token ไปแลกกับ Mena API (POST /auth/login/google) — ทำเฉพาะตอน sign-in ครั้งแรก
        // fail-soft: ถ้า API ล่ม/cold start ยังให้ login เข้าระบบ WMS ได้ตามปกติ
        if (account.provider === "google" && account.id_token) {
          try {
            const login = await loginWithGoogleIdToken(account.id_token)
            token.apiToken        = login.accessToken ?? undefined
            token.apiTokenExpires = login.expiresAt ?? undefined
            token.employee        = login.profile ?? undefined
            token.apiAuthError    = undefined
            logLogin(token, {
              apiStatus: "ok",
              apiTokenReceived: Boolean(login.accessToken),
              employee: login.profile,
              // profile = null เมื่อ response ไม่มีฟิลด์ที่รู้จัก — ดู raw เพื่อรู้ชื่อฟิลด์จริง
              apiRaw: login.profile ? undefined : login.raw,
            })
          } catch (e) {
            token.apiToken        = undefined
            token.apiTokenExpires = undefined
            token.employee        = undefined
            token.apiAuthError    = e instanceof Error ? e.message : String(e)
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
        session.apiAuthError  = token.apiAuthError
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
    error:  "/login",
  },
  session: { strategy: "jwt" },
}
