import { Code2, Link2, Search, Filter, ListOrdered, FileJson, ShieldCheck } from "lucide-react"

const BASE = "https://mena-wms.vercel.app"

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1B8C4B]/10 text-[#1B8C4B]"><Icon size={16} /></span>
        {title}
      </h2>
      <div className="space-y-2 text-[13px] leading-relaxed text-[#4B5F54] dark:text-gray-300">{children}</div>
    </section>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-[#14271C] dark:bg-black/40 p-3.5 text-[12px] leading-relaxed text-[#c8e6d4]">
      <code>{children}</code>
    </pre>
  )
}

function Param({ name, required, children }: { name: string; required?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <code className="mt-0.5 shrink-0 rounded-md bg-[#F6FAF7] dark:bg-white/5 px-1.5 py-0.5 text-[12px] font-semibold text-[#1B8C4B]">{name}</code>
      <span>
        {required
          ? <b className="mr-1 text-[#dc2626]">(จำเป็น)</b>
          : <span className="mr-1 text-[#9AA8A0]">(ไม่บังคับ)</span>}
        {children}
      </span>
    </li>
  )
}

export default function Page() {
  return (
    <div className="mx-auto max-w-[860px] px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <Code2 size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
            API Sync · รถซ่อมอู่นอก
          </h1>
          <p className="text-xs text-[#9AA8A0]">ดึงข้อมูลงานซ่อมด้วยทะเบียนหรือเบอร์รถ — สำหรับทีมที่ต้องการ sync ข้อมูลเข้าระบบของตัวเอง</p>
        </div>
      </div>

      <div className="space-y-4">
        <Section icon={Link2} title="Endpoint">
          <CodeBlock>{`GET ${BASE}/api/repair-external/sync?vehicle=<ทะเบียนหรือเบอร์รถ>`}</CodeBlock>
          <p className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="shrink-0 text-[#1B8C4B]" />
            เรียกได้ทันที <b>ไม่ต้อง login และไม่ต้องใช้ API key</b> · อ่านข้อมูลอย่างเดียว (GET เท่านั้น) · รองรับ CORS เรียกจากเว็บอื่นได้
          </p>
        </Section>

        <Section icon={Search} title="Parameters">
          <ul className="ml-1 space-y-2">
            <Param name="vehicle" required>
              ทะเบียนรถ <b>หรือ</b> เบอร์รถ — ใช้ช่องเดียวค้นทั้งสองอย่าง (ค้นบางส่วนได้ ไม่สนตัวพิมพ์เล็ก/ใหญ่)
              เช่น <code>70-1234</code>, <code>M123</code>
            </Param>
            <Param name="scope">
              กรองตามสถานะงาน — <code>active</code> = งานที่ยังไม่เสร็จ · <code>done</code> = งานที่ปิดแล้ว (สถานะ "รถเสร็จ") · ไม่ส่ง = ทั้งหมด
            </Param>
            <Param name="limit">
              จำนวนรายการสูงสุด (ค่าเริ่มต้น 100, สูงสุด 500) เรียงจากวันที่รับแจ้งล่าสุดก่อน
            </Param>
          </ul>
        </Section>

        <Section icon={Filter} title="ตัวอย่างการเรียกใช้">
          <p>ค้นด้วยทะเบียนรถ:</p>
          <CodeBlock>{`curl "${BASE}/api/repair-external/sync?vehicle=70-1234"`}</CodeBlock>
          <p>ค้นด้วยเบอร์รถ เฉพาะงานที่ยังไม่เสร็จ:</p>
          <CodeBlock>{`curl "${BASE}/api/repair-external/sync?vehicle=M123&scope=active"`}</CodeBlock>
          <p>ตัวอย่าง JavaScript:</p>
          <CodeBlock>{`const res  = await fetch(
  "${BASE}/api/repair-external/sync?vehicle=70-1234"
)
const data = await res.json()
console.log(data.count, data.items)`}</CodeBlock>
        </Section>

        <Section icon={FileJson} title="รูปแบบผลลัพธ์ (Response)">
          <CodeBlock>{`{
  "ok": true,
  "vehicle": "70-1234",
  "scope": "all",
  "count": 2,
  "items": [
    {
      "_id": "665f1c...",
      "mrNo": "MR-2026-001",
      "plate": "70-1234",           // ทะเบียนรถ
      "fleetNo": "M123",            // เบอร์รถ
      "fleet": "Mixer",
      "plant": "โรงงาน A",
      "garage": "อู่ ก.การช่าง",
      "status": "ซ่อมมีกำหนดเสร็จ",   // สถานะปัจจุบัน
      "statusSince": "2026-07-20",
      "symptom": "เบรกไม่อยู่",
      "receivedDate": "2026-07-18",  // วันรับแจ้ง
      "garageInDate": "2026-07-19",  // วันรถเข้าอู่
      "dueDate": "2026-08-01",       // กำหนดเสร็จ
      "completedDate": "",           // วันซ่อมเสร็จ (ว่าง = ยังไม่เสร็จ)
      "repairPrice": 15000,
      "warranty": "3 เดือน",
      "prCode": "PR-001",
      "poCode": "",
      "note": ""
    }
  ]
}`}</CodeBlock>
          <p className="text-[#9AA8A0]">หมายเหตุ: ไม่รวมรูปภาพ (images) เพื่อให้ payload เล็กและเร็ว · ถ้าไม่ส่ง <code>vehicle</code> จะได้ <code>400</code> พร้อมข้อความอธิบาย</p>
        </Section>

        <Section icon={ListOrdered} title="สถานะที่เป็นไปได้ (status)">
          <p>
            <code>รอรถเข้า</code> → <code>รถเข้าอู่ซ่อม</code> → <code>รอใบเสนอราคา</code> → <code>รออนุมัติ</code> →{" "}
            <code>ซ่อมไม่มีกำหนด</code> / <code>ซ่อมมีกำหนดเสร็จ</code> → <code>รถเสร็จ(ไม่มี PR)</code> → <code>รถเสร็จ</code>
          </p>
          <p>งานถือว่า "ปิดแล้ว" เมื่อสถานะเป็น <code>รถเสร็จ</code> เท่านั้น (ตรงกับ <code>scope=done</code>)</p>
        </Section>
      </div>
    </div>
  )
}
