// GET /api/form-vendor/config — เกณฑ์ / ช่องเอกสาร / ข้อความยินยอม / ข้อจำกัดไฟล์ สำหรับฟอร์ม (public)
import { NextResponse } from "next/server"
import { guard } from "@/lib/vendor-onboarding/http"
import { getPublicConfig } from "@/lib/vendor-onboarding/public"

export const dynamic = "force-dynamic"

export function GET() {
  return guard(async () => NextResponse.json(await getPublicConfig()))
}
