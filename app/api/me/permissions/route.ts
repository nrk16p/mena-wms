import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getUserPermissions } from "@/lib/permissions"

// GET /api/me/permissions — current user's section access (drives sidebar visibility)
export async function GET() {
  const session = await getServerSession(authOptions)
  const perms = await getUserPermissions(session?.user?.email)
  return NextResponse.json(perms)
}
