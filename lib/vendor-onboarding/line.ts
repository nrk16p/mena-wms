// lib/vendor-onboarding/line.ts — ยืนยัน LIFF ID token กับ LINE → userId + ชื่อ (ย้ายมาจาก app/api/form-vendor/route.ts เดิม)
// channel ID = ส่วนหน้า "-" ของ NEXT_PUBLIC_LIFF_ID · token หมดอายุ/ไม่ผ่าน → null (ยังบันทึกได้ แค่ไม่มี lineId)
export async function verifyLineIdToken(idToken: string): Promise<{ lineId: string; lineDisplayName: string | null } | null> {
  const channelId = process.env.NEXT_PUBLIC_LIFF_ID?.split("-")[0]
  if (!channelId || !idToken) return null
  try {
    const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      signal: AbortSignal.timeout(5000),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || typeof j.sub !== "string") { console.warn("[form-vendor] line verify", r.status, j.error_description ?? j.error); return null }
    return { lineId: j.sub, lineDisplayName: typeof j.name === "string" ? j.name.slice(0, 200) : null }
  } catch (e) { console.warn("[form-vendor] line verify", e); return null }
}
