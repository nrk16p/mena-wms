// lib/store-withdraw/attach-http.ts — หาตัวตน + ระดับสิทธิ์สำหรับ route ไฟล์แนบ (ผู้ขอ: session หรือ API key · สโตร์: session + store-queue)
import { getServerSession } from "next-auth"
import { NextResponse, type NextRequest } from "next/server"
import { authOptions } from "@/lib/auth"
import { atLeast, type Access } from "@/lib/access-policy"
import type { Who } from "./attachments"
import { getActor, isResponse } from "./http"

export async function getAttachWho(req: NextRequest): Promise<Who | NextResponse> {
  const actor = await getActor(req, true)
  if (isResponse(actor)) return actor
  if (actor.via === "api") return { actor, isStore: false, storeView: false }
  const session = await getServerSession(authOptions)
  const access = (session?.user as { access?: Access } | undefined)?.access
  return { actor, isStore: !!access && atLeast(access["store-queue"], "edit"), storeView: !!access && atLeast(access["store-queue"], "view") }
}

export const isWho = (x: Who | NextResponse): x is Who => !(x instanceof NextResponse)
