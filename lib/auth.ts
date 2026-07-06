import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { isAdmin } from "./roles"
import { upsertAppUser } from "./permissions"

const ALLOWED_DOMAIN = "menatransport.co.th"

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
      if (domain !== ALLOWED_DOMAIN) return false
      // record the user for the admin panel — a DB hiccup must not block sign-in
      try {
        await upsertAppUser({ email, name: user?.name, image: user?.image })
      } catch {}
      return true
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.email = token.email ?? (profile as { email?: string })?.email
      }
      token.role = isAdmin(token.email as string) ? "admin" : "user"
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role
        if (token.sub) (session.user as { id?: string }).id = token.sub
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
