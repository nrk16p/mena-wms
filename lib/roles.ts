export const ADMIN_EMAILS = new Set([
  "bunphak.p@menatransport.co.th",
  "kittaboon.l@menatransport.co.th",
  "palika.c@menatransport.co.th",
  "narongkorn.a@menatransport.co.th",
])

export function isAdmin(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.has(email ?? "")
}
