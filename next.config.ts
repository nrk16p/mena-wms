import type { NextConfig } from "next";

/**
 * ย้าย API ไป mena-backend-services: ตั้ง BACKEND_API_URL (เช่น https://seahorse-app-o3p3o.ondigitalocean.app)
 * ใน Vercel แล้ว redeploy → /api/* วิ่งไป <BACKEND_API_URL>/api/v1/wms/* · ไม่ตั้ง = ใช้ route เดิมในแอป
 * middleware.ts ยังรันที่นี่ก่อนส่งต่อ (และรันซ้ำที่ backend)
 *
 * ที่ยังอยู่ที่นี่ (ต้องตรงกับ exclude ของ wms ใน mena-backend-services/scripts/next-apps.mjs):
 *   /api/auth/* (ล็อกอิน NextAuth) · /api/cron/* + tire-change-request/auto-status (CRON_SECRET)
 *   และ route ที่ใช้คีย์ซึ่งมีแค่บน Vercel:
 *   store-withdraw/* (NCAC_API_KEY, STORE_ATMS_CRED_KEY, STORE_WITHDRAW_*, ATMS_LOOKUP_*)
 *   vendor-portal/* (คุกกี้ vp_session เซ็นด้วย NEXTAUTH_SECRET ของ prod)
 *   ai-mixer-maintenance/analyze (ANTHROPIC_API_KEY) · sku/suggest (GROQ_API_KEY)
 *   pr/refresh/* + ap-tracking/audit + safety-stock/live-sync (MENA_API_URL/KEY)
 *   sku/atms-lookup · ap-tracking/[code] · atms/maintenance-request/* · tire-due · tire-change/sync|atms-link (NCAC_API_KEY)
 *   tyre-sheet/* (แก้บ่อย ไม่ต้องรอ resync backend)
 *   repair-external, repair-external/[id], [id]/update, sync, sync/comment (webhook MENA_NEXT_WEBHOOK_*)
 * route ใหม่ที่ชื่อชนกับ [code]/[id] ด้านล่าง จะค้างอยู่ที่นี่จนกว่าจะเพิ่มในรายชื่อ (ปลอดภัย ไม่ 404)
 */
const backend = process.env.BACKEND_API_URL?.trim().replace(/\/+$/, "");

const STAY_PREFIXES = [
  "auth", "cron", "revalidate-hook", "store-withdraw", "vendor-portal",
  "ai-mixer-maintenance/analyze", "sku/suggest", "sku/atms-lookup", "pr/refresh", "ap-tracking/audit",
  "atms/maintenance-request", "tire-change/atms-link", "tire-change/sync", "tire-change-request/auto-status",
  "safety-stock/live-sync",
  // ทะเบียนยางสระบุรี (แบบชีต) — แก้บ่อยช่วงนี้ ให้รันที่นี่ตามโค้ด main เลย ไม่ต้องรอ resync backend
  "tyre-sheet",
].join("|");
const AP_STATIC = "by-supplier|cover|dashboard|paid-round|payment-import|search|voucher-import";
const REPAIR_STATIC = "atms-board|atms-timeline|daily-status|daily-summary|garage-load|garage-sync|no-pr|stats|status-history|sync|users|utilize-ref";
const STAY_ON_VERCEL =
  `(?:${STAY_PREFIXES})(?:/|$)` +
  `|tire-due$` +
  `|ap-tracking/(?!(?:${AP_STATIC})$)[^/]+$` +
  `|repair-external(?:/sync(?:/comment)?|/(?!(?:${REPAIR_STATIC})$)[^/]+(?:/update)?)?$`;

const nextConfig: NextConfig = {
  async rewrites() {
    if (!backend) return [];
    return {
      beforeFiles: [
        {
          source: `/api/:path((?!${STAY_ON_VERCEL}).+)`,
          destination: `${backend}/api/v1/wms/:path`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // ฟอนต์ PDF อ่านจาก process.cwd()/fonts ตอนรันบน Vercel — ต้องบอก tracer ให้รวมเข้า bundle ของ route นี้
  outputFileTracingIncludes: {
    "/api/price-compare/[id]/pdf": ["./fonts/**"],
  },
  // pdfmake ใช้ subpath import + virtualfs — ให้ Node โหลดตรงจาก node_modules แทนการ bundle
  serverExternalPackages: ["pdfmake", "sharp"],
};

export default nextConfig;
