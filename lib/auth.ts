import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"

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
      // user.email is always set; profile may be undefined on some flows
      const email = user?.email ?? profile?.email ?? ""
      const domain = email.split("@")[1]?.toLowerCase()
      return domain === ALLOWED_DOMAIN
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        (session.user as { id?: string }).id = token.sub
      }
      return session
    },
    async jwt({ token, account, profile }) {
      if (account) {
        token.email = token.email ?? (profile as { email?: string })?.email
      }
      return token
    },
  },
  pages: {
    signIn: "/login",
    error:  "/login",
  },
  session: { strategy: "jwt" },
}
