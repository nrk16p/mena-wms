import { AdminUsersPage } from "@/components/admin-users-page"

// superadmin เท่านั้น — middleware บล็อก /admin/* ให้แล้ว และ API /api/admin/* ตรวจซ้ำเอง
export default function Page() {
  return <AdminUsersPage />
}
