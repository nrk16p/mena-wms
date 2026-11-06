import { QueueBoard } from "@/components/store-withdraw/queue-board"

// ลิงก์แยกของหน้า /store-withdraw/queue — คิวงานสโตร์เต็มจอ ไม่มี sidebar/navbar (ดู components/app-shell.tsx)
export const metadata = { title: "คิวงานสโตร์ · Mena WMS" }

export default function Page() {
  return <QueueBoard fullWidth />
}
