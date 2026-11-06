import { MyRequestsPage } from "@/components/store-withdraw/my-requests-page"

// ลิงก์แยกของหน้า /store-withdraw — เนื้อหาเดียวกัน แต่ไม่มี sidebar/navbar (ดู components/app-shell.tsx)
export const metadata = { title: "ขอเบิกอะไหล่ · Mena WMS" }

export default function Page() {
  return <MyRequestsPage />
}
