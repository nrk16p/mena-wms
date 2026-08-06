import { Code2, Link2, Search, Filter, ListOrdered, FileJson, ShieldCheck, PencilLine } from "lucide-react"

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
            API Sync · อู่นอก & อะไหล่ลงคัน
          </h1>
          <p className="text-xs text-[#9AA8A0]">ดึงข้อมูลงานซ่อมด้วยทะเบียนหรือเบอร์รถ — สำหรับทีมที่ต้องการ sync ข้อมูลเข้าระบบของตัวเอง</p>
        </div>
      </div>

      <div className="space-y-4">
        <Section icon={Link2} title="Endpoint">
          <CodeBlock>{`GET ${BASE}/api/repair-external/sync?vehicle=<ทะเบียนหรือเบอร์รถ>`}</CodeBlock>
          <p className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="shrink-0 text-[#1B8C4B]" />
            เรียกได้ทันที <b>ไม่ต้อง login และไม่ต้องใช้ API key</b> (ทั้งอ่านและเขียน) · รองรับ CORS เรียกจากเว็บอื่นได้
          </p>
        </Section>

        <Section icon={Search} title="Parameters">
          <ul className="ml-1 space-y-2">
            <Param name="vehicle" required>
              ทะเบียนรถ <b>หรือ</b> เบอร์รถ — ใช้ช่องเดียวค้นทั้งสองอย่าง (ค้นบางส่วนได้ ไม่สนตัวพิมพ์เล็ก/ใหญ่)
              เช่น <code>70-1234</code>, <code>M123</code>
            </Param>
            <Param name="scope">
              กรองตามสถานะงาน — <code>active</code> = งานที่ยังไม่เสร็จทั้งหมด · <code>done</code> = งานที่ปิดแล้วทั้งหมด (รถเสร็จ / ลงคันเสร็จ) ·{" "}
              <b>ไม่ส่ง (ค่าเริ่มต้น)</b> = งานที่ยังไม่เสร็จทั้งหมด <b>+ งานปิดแล้วเฉพาะรายการล่าสุด 1 รายการ</b>
            </Param>
            <Param name="type">
              กรองตามประเภทงาน — <code>อู่นอก</code> = งานซ่อมอู่ภายนอก · <code>อะไหล่ลงคัน</code> = งานสั่งซื้ออะไหล่ลงคัน · ไม่ส่ง = ทั้งสองประเภท
            </Param>
            <Param name="limit">
              จำนวนรายการสูงสุด (ค่าเริ่มต้น 100, สูงสุด 500) เรียงจากวันที่รับแจ้งล่าสุดก่อน
            </Param>
            <Param name="history">
              ประวัติการแก้ไขต่อรายการ — ค่าเริ่มต้น<b>แนบมาให้เสมอ</b> (field <code>history</code>) · ส่ง <code>history=0</code> ถ้าต้องการ payload เบา
            </Param>
          </ul>
        </Section>

        <Section icon={Filter} title="ตัวอย่างการเรียกใช้">
          <p>ค้นด้วยทะเบียนรถ (ได้งานที่เปิดอยู่ทั้งหมด + รถเสร็จล่าสุด 1 รายการ):</p>
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
  "scope": "default",   // default = งานเปิดทั้งหมด + รถเสร็จล่าสุด 1 รายการ
  "count": 2,
  "items": [
    {
      "_id": "665f1c...",
      "jobType": "อู่นอก",           // ประเภทงาน: อู่นอก | อะไหล่ลงคัน (รายการเก่าอาจไม่มี field นี้ = อู่นอก)
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
      "note": "",
      "history": [               // ประวัติการแก้ไข (เก่า → ใหม่) · ปิดด้วย ?history=0
        {
          "action": "create",    // create | update | delete
          "by": "Nopparut",
          "at": "2026-07-18T03:12:45.000Z",
          "statusChange": { "from": "", "to": "รอรถเข้า" }
        },
        {
          "action": "update",
          "by": "Plug",
          "at": "2026-07-19T08:30:02.000Z",
          "statusChange": { "from": "รอรถเข้า", "to": "รถเข้าอู่ซ่อม" },
          "changes": [ { "field": "garageInDate", "label": "วันที่รถเข้าอู่ซ่อม", "from": "", "to": "2026-07-19" } ]
        }
      ]
    }
  ]
}`}</CodeBlock>
          <p className="text-[#9AA8A0]">หมายเหตุ: ไม่รวมรูปภาพ (images) เพื่อให้ payload เล็กและเร็ว · ถ้าไม่ส่ง <code>vehicle</code> จะได้ <code>400</code> พร้อมข้อความอธิบาย</p>
        </Section>

        <Section icon={PencilLine} title="การเขียนข้อมูล — POST / PUT / PATCH">
          <p className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="shrink-0 text-[#B07D12]" />
            ตอนนี้เขียนได้<b>โดยไม่ต้องใช้ API key</b> · กรุณาส่ง <code>x-user: ชื่อผู้ทำรายการ</code> ทุกครั้ง เพื่อบันทึกในประวัติ (ไม่ส่ง = "API ภายนอก")
          </p>

          <p className="pt-1 font-semibold text-[#14271C] dark:text-white">➕ POST — เปิดรายการใหม่</p>
          <CodeBlock>{`curl -X POST "${BASE}/api/repair-external/sync" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: <API_KEY>" \\
  -H "x-user: สมชาย (ทีมจัดซื้อ)" \\
  -d '{
    "plate": "สบ.70-1234",         // จำเป็น
    "fleetNo": "M123",
    "jobType": "อู่นอก",            // อู่นอก | อะไหล่ลงคัน (ไม่ส่ง = อู่นอก)
    "status": "รอรถเข้า",           // จำเป็น — ตาม workflow ของประเภทงาน
    "receivedDate": "2026-08-06",
    "symptom": "เบรกไม่อยู่",
    "garage": "อู่ ก.การช่าง",
    "mrNo": "MR-2026-001"
  }'`}</CodeBlock>
          <p className="text-[#9AA8A0]">ตอบกลับ <code>201</code> พร้อม <code>id</code> ของรายการ · กันซ้ำเหมือนหน้าเว็บ: รถคันเดียวกันมีรายการไม่เสร็จได้ 1 รายการ (ซ้ำ = <code>409</code> พร้อม <code>existingId</code>)</p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">✏️ PATCH — แก้บางฟิลด์ (แนะนำ เช่น อัพเดทสถานะ)</p>
          <CodeBlock>{`curl -X PATCH "${BASE}/api/repair-external/sync" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: <API_KEY>" \\
  -H "x-user: สมชาย (ทีมจัดซื้อ)" \\
  -d '{
    "id": "665f1c...",             // จาก GET /sync (field _id)
    "status": "รถเข้าอู่ซ่อม",
    "garageInDate": "2026-08-06"
  }'`}</CodeBlock>
          <p className="text-[#9AA8A0]">ฟิลด์ที่ไม่ส่งมา = คงค่าเดิม · การเปลี่ยนสถานะถูกบันทึกลง history อัตโนมัติ</p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">🔁 PUT — แทนที่ทั้งรายการ (ต้องส่งฟิลด์ครบทุกตัว)</p>
          <CodeBlock>{`curl -X PUT "${BASE}/api/repair-external/sync" \\
  -H "Content-Type: application/json" -H "x-api-key: <API_KEY>" \\
  -d '{ "id": "665f1c...", "plate": "สบ.70-1234", "status": "...", ...ฟิลด์อื่นทั้งหมด }'`}</CodeBlock>
          <p className="text-[#9AA8A0]">⚠ PUT ฟิลด์ที่ไม่ส่ง = ถูกล้างเป็นค่าว่าง — ถ้าจะแก้บางฟิลด์ใช้ PATCH เสมอ</p>

          <p className="pt-2">กติกาที่ระบบบังคับทุก method: รายการที่ปิดงานแล้ว (รถเสร็จ/ลงคันเสร็จ) <b>ย้อนสถานะไม่ได้</b> (<code>409</code>) · ทุกการเขียนลงประวัติ (history) พร้อมชื่อจาก <code>x-user</code></p>
        </Section>

        <Section icon={ListOrdered} title="สถานะที่เป็นไปได้ (status)">
          <p><b>🔧 อู่นอก:</b></p>
          <p>
            <code>รอรถเข้า</code> → <code>รถเข้าอู่ซ่อม</code> → <code>รอใบเสนอราคา</code> → <code>รออนุมัติ</code> →{" "}
            <code>ซ่อมไม่มีกำหนด</code> / <code>ซ่อมมีกำหนดเสร็จ</code> → <code>รถเสร็จ(ไม่มี PR)</code> → <code>รถเสร็จ</code>
          </p>
          <p className="pt-1"><b>🔩 อะไหล่ลงคัน:</b></p>
          <p>
            <code>รอดำเนินการ</code> → <code>รอใบเสนอราคา</code> → <code>รออนุมัติ</code> →{" "}
            <code>สั่งซื้อแล้ว-รอของ</code> → <code>ของถึง-รอลงคัน</code> → <code>ลงคันเสร็จ</code>
          </p>
          <p>งานถือว่า "ปิดแล้ว" เมื่อสถานะเป็น <code>รถเสร็จ</code> (อู่นอก) หรือ <code>ลงคันเสร็จ</code> (อะไหล่ลงคัน) — ตรงกับ <code>scope=done</code></p>
        </Section>
      </div>
    </div>
  )
}
