// lib/vendor-onboarding/roles.ts — ใครทำอะไรได้ในงานคัดเลือก vendor ใหม่ (ผู้ทำรายการเอาจาก session เสมอ ไม่รับจาก body)
//   officer  = มีสิทธิ์ส่วน vendor ระดับ "แก้ได้" (lib/access-policy.ts) หรือ admin
//   reviewer = อีเมลอยู่ใน settings.reviewerEmails หรือ admin
//   approver = อีเมลอยู่ใน settings.approverEmails หรือ admin
import { getServerSession, type Session } from "next-auth"
import { authOptions } from "../auth"
import { atLeast, type Access } from "../access-policy"
import { isAdmin } from "../roles"
import { forbidden, HttpError } from "./http"
import type { Actor, ActorRole, OnboardingAction } from "./types"
import type { OnboardingSettings } from "./validate"

export type SessionInfo = { actor: Actor; access: Access | null; admin: boolean }

export function getActorRoles(session: SessionInfo, settings: Pick<OnboardingSettings, "reviewerEmails" | "approverEmails">): ActorRole[] {
  const email = session.actor.email
  const roles: ActorRole[] = []
  if (session.admin || (session.access && atLeast(session.access.vendor, "edit"))) roles.push("officer")
  if (session.admin || settings.reviewerEmails.includes(email)) roles.push("reviewer")
  if (session.admin || settings.approverEmails.includes(email)) roles.push("approver")
  return roles
}

/** session ปัจจุบัน → ผู้ทำรายการ (ไม่มี session = 401) */
export async function requireSession(): Promise<SessionInfo> {
  const s: Session | null = await getServerSession(authOptions)
  const email = s?.user?.email?.trim().toLowerCase()
  if (!email) throw new HttpError("ยังไม่ได้ล็อกอิน เข้าสู่ระบบแล้วลองใหม่", 401)
  const access = (s!.user as { access?: Access }).access ?? null
  if (!isAdmin(email) && (!access || !atLeast(access.vendor, "view"))) throw forbidden("ไม่มีสิทธิ์ดูงานคัดเลือก vendor")
  return { actor: { name: s!.user?.name || email, email }, access, admin: isAdmin(email) }
}

/** การกระทำนี้ใช้บทบาทอะไร — reject ให้ reviewer หรือ approver */
export function canDo(action: OnboardingAction, role: ActorRole, roles: ActorRole[]): boolean {
  if (action === "reject") return roles.includes("reviewer") || roles.includes("approver")
  return roles.includes(role)
}

export const ROLE_DENY: Record<ActorRole, string> = {
  officer: "งานนี้เฉพาะฝ่ายจัดซื้อที่มีสิทธิ์แก้ Vendor",
  reviewer: "งานนี้เฉพาะผู้รีวิวที่ตั้งไว้ในหน้าตั้งค่า",
  approver: "งานนี้เฉพาะผู้อนุมัติที่ตั้งไว้ในหน้าตั้งค่า",
}
