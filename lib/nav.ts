// ── แหล่งข้อมูลเมนูเดียวของทั้งระบบ ─────────────────────────────────────────
//
// ทั้ง Sidebar (components/sidebar.tsx) และการ์ดโมดูลบนหน้าหลัก (app/page.tsx)
// อ่านจากไฟล์นี้ไฟล์เดียว — เพิ่มหน้าใหม่ที่นี่ที่เดียวแล้วขึ้นครบทั้งสองที่
// (ก่อนหน้านี้เขียนแยกกันสองที่ หน้าหลักเลยตกเมนู AP / ของค้างคลัง / Safety Stock)
//
// กติกาการมองเห็น
//   • visibleToEmails บนกลุ่ม → เห็นเฉพาะ email ที่ระบุ (ไม่ระบุ = เห็นทุกคน)
//   • branch บนเมนู          → ซ่อนถ้าผู้ใช้ไม่มีสิทธิ์เห็นสาขานั้น (lib/branch-scope.ts)
//   • adminOnly บนเมนู       → เห็นเฉพาะ role = admin
//   • hideOnHome / subheader → ไม่ขึ้นบนการ์ดหน้าหลัก (เป็นของ sidebar อย่างเดียว)

import type { ElementType } from "react"
import {
  Banknote, BarChart3, BookOpen, Bot, Car, ClipboardCheck, ClipboardList,
  Code2, Database, Disc3, Factory, FileText, Flag, Gauge, GitCompare, Inbox,
  Landmark, Layers, LayoutDashboard, MapPin, PackageSearch, PackageX,
  PlusCircle, ShieldCheck, TableProperties, Truck, Wrench,
} from "lucide-react"

export type NavItem = {
  href: string
  /** ป้ายใน sidebar */
  label: string
  icon: ElementType
  exact?: boolean
  /** หัวข้อย่อยใน sidebar (ไม่ใช่ลิงก์) */
  subheader?: boolean
  indent?: boolean
  adminOnly?: boolean
  /** เมนูของสาขานี้เท่านั้น — ซ่อนถ้าผู้ใช้ไม่มีสิทธิ์เห็นสาขา (lib/branch-scope.ts) */
  branch?: string
  /** ป้ายบนการ์ดหน้าหลัก (ไม่ระบุ = ใช้ label) */
  homeLabel?: string
  /** คำอธิบายใต้ป้ายบนการ์ดหน้าหลัก */
  desc?: string
  /** ไม่ต้องขึ้นบนหน้าหลัก (เช่น "หน้าหลัก" ที่ลิงก์หาตัวเอง) */
  hideOnHome?: boolean
}

export type NavGroup = {
  key: string
  /** ชื่อกลุ่มใน sidebar */
  label: string
  items: NavItem[]
  collapsible?: boolean
  visibleToEmails?: string[]
  // ── ข้อมูลสำหรับการ์ดโมดูลบนหน้าหลัก ──
  /** ชื่อโมดูลบนหน้าหลัก (ไม่ระบุ = ใช้ label) */
  homeTitle?: string
  homeDesc: string
  /** ไอคอนหัวโมดูลบนหน้าหลัก */
  homeIcon: ElementType
  /** สีประจำโมดูล (ไอคอน) */
  color: string
  /** พื้นไอคอน (light) */
  bg: string
  /** ลำดับบนหน้าหลัก (น้อย = ขึ้นก่อน) — sidebar ใช้ลำดับใน array นี้ */
  homeOrder: number
}

// เรียงตามลำดับที่แสดงใน sidebar · หน้าหลักเรียงตาม homeOrder
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    label: "ภาพรวม",
    homeTitle: "ภาพรวม & นิยามตัวชี้วัด",
    homeDesc: "ที่มาและวิธีคำนวณตัวชี้วัดของระบบ",
    homeIcon: BookOpen, color: "#475569", bg: "#F1F5F9", homeOrder: 90,
    items: [
      { href: "/", label: "หน้าหลัก", icon: LayoutDashboard, exact: true, hideOnHome: true },
      { href: "/atms-new-sku-report/baseline", label: "นิยามตัวชี้วัด", icon: BookOpen, exact: true,
        desc: "นิยาม & วิธีนับ SKU เกิดใหม่" },
    ],
  },
  {
    key: "sku",
    label: "จัดการ SKU",
    homeDesc: "ฐานข้อมูลอะไหล่และรหัสสินค้า",
    homeIcon: PackageSearch, color: "#1B8C4B", bg: "#EAF6EE", homeOrder: 20,
    collapsible: true,
    items: [
      { href: "/atms-new-sku-report", label: "SKU ใหม่ ATMS", icon: BarChart3, exact: true,
        desc: "รายงาน SKU เกิดใหม่รายเดือน" },
      { href: "/sku", label: "รายการ SKU", icon: PackageSearch, exact: true,
        desc: "ค้นหา / ดูอะไหล่ทั้งหมด" },
      { href: "/sku/new", label: "เพิ่ม SKU ใหม่", icon: PlusCircle,
        desc: "สร้างรหัสอัตโนมัติ" },
      { href: "/sku/my-submissions", label: "รายการของฉัน", icon: Inbox,
        desc: "SKU ที่ส่งไป รอ/ผ่านอนุมัติ" },
      { href: "/sku/oe-search", label: "ค้นหา OE", icon: GitCompare,
        desc: "ค้นข้ามเบอร์อะไหล่แท้" },
      { href: "/sku/bulk-update", label: "Bulk Update", icon: TableProperties,
        desc: "แก้ไข SKU ทีละหลายรายการ" },
      { href: "/codes/parts", label: "แคตาล็อกอะไหล่", icon: Layers,
        desc: "หมวดหมู่ L1 · L2 · L3" },
      { href: "/vehicles", label: "ยานพาหนะ", icon: Car,
        desc: "ข้อมูลรถทุกคัน" },
      { href: "/codes", label: "พจนานุกรมโค้ด", icon: Database, exact: true,
        desc: "ความหมายรหัสทุกส่วน" },
    ],
  },
  {
    key: "tire",
    label: "จัดการยาง",
    homeDesc: "สต็อกยางและการเปลี่ยนยางทุกสาขา",
    homeIcon: Disc3, color: "#1D4ED8", bg: "#DBEAFE", homeOrder: 30,
    collapsible: true,
    items: [
      { href: "/tire", label: "ศูนย์จัดการยางรถ", icon: ClipboardCheck, exact: true,
        desc: "ภาพรวมยางทุกคัน ทุกสาขา" },
      { href: "/tire/master", label: "สเปคยาง (Master)", icon: Database, exact: true,
        desc: "ขนาด / ยี่ห้อ / รุ่นยาง" },
      { href: "#stock", label: "สต็อกยาง", icon: MapPin, subheader: true, hideOnHome: true },
      { href: "/tire/latkrabang/stock-tire", label: "ลาดกระบัง", icon: Disc3, indent: true, branch: "latkrabang",
        homeLabel: "สต็อกยาง ลาดกระบัง", desc: "คลังยางสาขา ศลบ" },
      { href: "/tire/saraburi/stock-tire", label: "สระบุรี", icon: Disc3, indent: true, branch: "saraburi",
        homeLabel: "สต็อกยาง สระบุรี", desc: "คลังยางสาขา สสบ" },
    ],
  },
  {
    key: "tracking",
    label: "จัดการติดตามสินค้า",
    homeDesc: "ติดตามการสั่งซื้อ ตั้งแต่คำขอจนของถึงมือ",
    homeIcon: FileText, color: "#7C3AED", bg: "#F3E8FF", homeOrder: 10,
    collapsible: true,
    items: [
      { href: "/pr", label: "ติดตาม PR / รับสินค้า", icon: FileText, exact: true,
        desc: "PR อนุมัติแล้ว รอเปิด PO / รอรับของ" },
      { href: "/order-tracking", label: "ติดตามคำขอเปิด PO", icon: ClipboardList, exact: true,
        desc: "แจ้งขอซื้อ · จัดซื้อรับเรื่อง · ปิดจบอัตโนมัติ" },
      { href: "/ap-tracking", label: "ติดตามเจ้าหนี้", icon: Banknote, exact: true,
        desc: "ใบวางบิล · รอบวางบิล · สถานะจ่ายเงิน" },
      { href: "/ap-tracking/dashboard", label: "แดชบอร์ดเจ้าหนี้", icon: LayoutDashboard,
        desc: "ภาพรวมคลัง × ขั้นของงาน ทุกเดือน" },
      { href: "/ap-tracking/suppliers", label: "เครดิตเทอมเจ้าหนี้", icon: Landmark,
        desc: "ทะเบียนผู้ขายและเครดิตเทอม" },
      { href: "/ap-tracking/audit", label: "ตรวจความครบถ้วนข้อมูล", icon: ShieldCheck,
        desc: "หาเอกสารที่ข้อมูลขาด/ไม่ตรง" },
      { href: "/pr/guide", label: "คู่มือติดตาม PR", icon: BookOpen,
        desc: "วิธีอ่านสถานะและตัวกรอง" },
      { href: "/order-tracking/guide", label: "คู่มือติดตามคำขอเปิด PO", icon: BookOpen,
        desc: "ขั้นตอนแจ้งเรื่อง-รับเรื่อง-ปิดงาน" },
    ],
  },
  {
    key: "deadstock",
    label: "ของค้างคลัง (ลาดกระบัง)",
    homeDesc: "ของรับเข้าที่ยังไม่ถูกเบิกออก — มูลค่าและอายุของค้าง",
    homeIcon: PackageX, color: "#BE123C", bg: "#FFE4E6", homeOrder: 40,
    collapsible: true,
    items: [
      { href: "/deadstock", label: "ภาพรายเดือน", icon: BarChart3, exact: true,
        desc: "มูลค่าของค้างแต่ละเดือน" },
      { href: "/deadstock/pending", label: "สถานะล่าสุด", icon: PackageX, exact: true,
        desc: "รายการที่ยังค้างอยู่ตอนนี้" },
      { href: "/deadstock/items", label: "รายรหัสสินค้า", icon: PackageSearch, exact: true,
        desc: "เจาะดูของค้างรายตัว SKU" },
      { href: "/deadstock/baseline", label: "นิยามตัวชี้วัด", icon: BookOpen, exact: true,
        desc: "เกณฑ์ FIFO และวิธีคำนวณ" },
    ],
  },
  {
    key: "safety-stock",
    label: "จุดสั่งซื้อ (Safety Stock)",
    homeDesc: "จุดสั่งซื้อและสต็อกกันขาดของอะไหล่",
    homeIcon: Gauge, color: "#0F766E", bg: "#CCFBF1", homeOrder: 50,
    collapsible: true,
    items: [
      { href: "/safety-stock", label: "Safety Stock", icon: PackageSearch, exact: true,
        desc: "ROP / SS รายรหัส 2 คลัง" },
      { href: "/safety-stock/baseline", label: "นิยามตัวชี้วัด", icon: BookOpen, exact: true,
        desc: "นิยาม ROP / SS และสมมติฐาน" },
    ],
  },
  {
    key: "repair",
    label: "จัดการอู่นอกและสั่งซื้ออะไหล่ลงคัน",
    homeDesc: "งานซ่อมอู่ภายนอกและสั่งอะไหล่มาลงคัน",
    homeIcon: Wrench, color: "#C2410C", bg: "#FFEDD5", homeOrder: 60,
    collapsible: true,
    items: [
      { href: "/repair-external", label: "อู่นอก & อะไหล่ลงคัน", icon: Wrench, exact: true,
        desc: "งานที่กำลังดำเนินการ (ตาราง/บอร์ด)" },
      { href: "/repair-external/completed", label: "งานเสร็จ", icon: Flag,
        desc: "งานที่ปิดแล้ว (รถเสร็จ / ลงคันเสร็จ)" },
      { href: "/garages", label: "จัดการอู่ / ร้านอะไหล่", icon: Factory,
        desc: "รายชื่อ master แก้แล้วอัปเดตทุกงาน" },
      { href: "/repair-external/guide", label: "คู่มือการใช้งาน", icon: BookOpen,
        desc: "workflow สถานะ + SLA" },
      { href: "/repair-external/api-guide", label: "คู่มือ API Sync", icon: Code2,
        desc: "API สำหรับทีมภายนอก (public)" },
    ],
  },
  {
    key: "driver-handover",
    label: "ส่งมอบรถ พจส.ใหม่",
    homeDesc: "จับคู่คนขับใหม่กับรถ ให้พร้อมตรงกันรายฟลีท/รายสัปดาห์",
    homeIcon: Truck, color: "#0E7490", bg: "#CFFAFE", homeOrder: 70,
    collapsible: true,
    items: [
      { href: "/driver-handover", label: "จับคู่คน-รถ ส่งมอบ", icon: Truck, exact: true,
        desc: "Fleet Balance + เลือกรถ + อัปเดตสถานะ พจส.ใหม่ (sync ชีต Onboarding)" },
    ],
  },
  {
    key: "ai-mixer",
    label: "ทดสอบระบบ ระบบ AI ช่วยจัดการงานซ่อมรถโม่ (Fleet Mixer Truck Maintenance)",
    homeTitle: "AI ช่วยจัดการงานซ่อมรถโม่ (ทดสอบ)",
    homeDesc: "ระบบทดลอง — ผู้ช่วย AI สำหรับงานซ่อมรถโม่",
    homeIcon: Bot, color: "#4F46E5", bg: "#E0E7FF", homeOrder: 80,
    collapsible: true,
    visibleToEmails: ["narongkorn.a@menatransport.co.th", "kittaboon.l@menatransport.co.th"],
    items: [
      { href: "/ai-mixer-maintenance", label: "AI จัดการงานซ่อมรถโม่", icon: Bot, exact: true,
        desc: "ถาม-ตอบ/ช่วยวางแผนงานซ่อม (ทดสอบ)" },
    ],
  },
]

type Viewer = {
  email?: string | null
  isAdmin?: boolean
  /** true = ผู้ใช้เห็นสาขานี้ได้ (ส่ง canSeeBranch(scope, b) เข้ามา) */
  canSeeBranch?: (branch: string) => boolean
}

function groupVisible(group: NavGroup, viewer: Viewer) {
  return !group.visibleToEmails || group.visibleToEmails.includes(viewer.email ?? "")
}

function itemVisible(item: NavItem, viewer: Viewer) {
  if (item.adminOnly && !viewer.isAdmin) return false
  if (item.branch && viewer.canSeeBranch && !viewer.canSeeBranch(item.branch)) return false
  return true
}

/** กลุ่มเมนูสำหรับ sidebar — กรองตามสิทธิ์แล้ว (คงลำดับใน NAV_GROUPS) */
export function sidebarGroups(viewer: Viewer): NavGroup[] {
  return NAV_GROUPS
    .filter((g) => groupVisible(g, viewer))
    .map((g) => ({ ...g, items: g.items.filter((i) => itemVisible(i, viewer)) }))
    .filter((g) => g.items.some((i) => !i.subheader))
}

export type HomeModule = {
  key: string
  title: string
  desc: string
  icon: ElementType
  color: string
  bg: string
  links: { href: string; label: string; desc: string; icon: ElementType }[]
}

/** การ์ดโมดูลสำหรับหน้าหลัก — กรองตามสิทธิ์ + เรียงตาม homeOrder */
export function homeModules(viewer: Viewer): HomeModule[] {
  return NAV_GROUPS
    .filter((g) => groupVisible(g, viewer))
    .sort((a, b) => a.homeOrder - b.homeOrder)
    .map((g) => ({
      key: g.key,
      title: g.homeTitle ?? g.label,
      desc: g.homeDesc,
      icon: g.homeIcon,
      color: g.color,
      bg: g.bg,
      links: g.items
        .filter((i) => !i.subheader && !i.hideOnHome && itemVisible(i, viewer))
        .map((i) => ({ href: i.href, label: i.homeLabel ?? i.label, desc: i.desc ?? "", icon: i.icon })),
    }))
    .filter((m) => m.links.length > 0)
}
