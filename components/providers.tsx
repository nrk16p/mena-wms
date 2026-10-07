"use client"

import { SessionProvider } from "next-auth/react"
import { GarageSyncHeartbeat } from "@/components/garage-sync-heartbeat"

export function Providers({ children }: { children: React.ReactNode }) {
  // refetch ทุก 5 นาที — ให้สิทธิ์ที่ superadmin เพิ่งเปลี่ยนถึงแท็บที่เปิดค้างไว้ (lib/access-refresh.ts)
  return <SessionProvider refetchInterval={300}><GarageSyncHeartbeat />{children}</SessionProvider>
}
