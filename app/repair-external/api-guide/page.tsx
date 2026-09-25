import { Code2, Link2, Search, Filter, ListOrdered, FileJson, ShieldCheck, PencilLine, Bell } from "lucide-react"
import { CodeBlock, Param, Section } from "@/components/api-guide-ui"

const BASE = "https://mena-wms.vercel.app"

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
            <Param name="comments">
              ความคิดเห็น/โน้ตในรายการ — ค่าเริ่มต้น<b>แนบมาให้เสมอ</b> (field <code>comments</code>) · ส่ง <code>comments=0</code> ถ้าต้องการ payload เบา
            </Param>
            <Param name="nextJobId">
              ใช้แทน <code>vehicle</code> ได้ — ดึงใบงานที่ผูกกับรหัส Job Request ของ Mena-Next (ตรงตัว)
            </Param>
            <Param name="files">
              ไฟล์แนบ + ใบเสนอราคา — ค่าเริ่มต้น<b>แนบมาให้เสมอ</b> (field <code>images</code>, <code>quotationImages</code>, <code>negotiationImages</code> เป็นลิงก์ ไม่ใช่ตัวไฟล์) · ส่ง <code>files=0</code> ถ้าต้องการ payload เบา
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
  "timezone": "Asia/Bangkok (+07:00)",   // เวลาทุก field เป็นเวลาไทย
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
      "stageEta": "2026-07-25",      // คาดว่าจะพ้น "สถานะปัจจุบัน" เมื่อไหร่ (ผูกกับขั้น ไม่ใช่ทั้งใบ)
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
      "quotationDetail": "ค่าแรง 8,000 + อะไหล่ 7,000",   // รายละเอียดใบเสนอราคา (ข้อความ)
      "quotationImages": [       // ไฟล์ใบเสนอราคา (รูป/PDF) · ปิดพร้อมไฟล์อื่นด้วย ?files=0
        {
          "fileType": "pdf",     // image | pdf
          "filename": "ใบเสนอราคา อู่ ก.pdf",
          "webpUrl": "https://mn-bucket.sgp1.digitaloceanspaces.com/media-docs/…/ใบเสนอราคา อู่ ก.pdf",   // PDF = ลิงก์ไฟล์ต้นฉบับ
          "batchId": "doc",
          "mediaId": 0
        }
      ],
      "images": [                // ไฟล์แนบของงาน (รูปรถ/อาการ/เอกสาร) รูปแบบเดียวกัน
        {
          "fileType": "image",
          "filename": "454307.jpg",
          "webpUrl": "https://mn-bucket.sgp1.digitaloceanspaces.com/media/6c45…/4905/webp/454307.webp",   // รูปขนาดเต็ม (webp)
          "thumbnailUrl": "https://mn-bucket.sgp1.digitaloceanspaces.com/media/6c45…/4905/thumbnail/454307-thumbnail.webp",   // รูปย่อ (มีเฉพาะรูป)
          "batchId": "6c4514d6-…",
          "mediaId": 4905
        }
      ],
      "negotiationImages": [],   // หลักฐานการต่อรองราคา รูปแบบเดียวกัน
      "history": [               // ประวัติการแก้ไข (เก่า → ใหม่) · ปิดด้วย ?history=0
        {
          "action": "create",    // create | update | delete
          "by": "Nopparut",
          "at": "2026-07-18T10:12:45.000+07:00",   // เวลาไทย
          "statusChange": { "from": "", "to": "แจ้งซ่อมอู่นอก" }
        },
        {
          "action": "update",
          "by": "Plug",
          "at": "2026-07-19T15:30:02.000+07:00",
          "statusChange": { "from": "แจ้งซ่อมอู่นอก", "to": "รถเข้าซ่อมอู่นอก" },
          "changes": [ { "field": "garageInDate", "label": "วันที่รถเข้าอู่ซ่อม", "from": "", "to": "2026-07-19" } ]
        }
      ],
      "comments": [              // ความคิดเห็น/โน้ตในรายการ (เก่า → ใหม่) · ปิดด้วย ?comments=0
        {
          "id": "66a2f1...",     // ใช้อ้างเป็น parentId ของข้อความตอบกลับ
          "parentId": null,      // null = ความคิดเห็นหลัก · มีค่า = ตอบกลับความคิดเห็น id นั้น
          "text": "อู่แจ้งว่ารออะไหล่อีก 3 วัน",
          "by": "Nopparut",
          "at": "2026-07-19T16:05:11.000+07:00"
        },
        {
          "id": "66a2f5...",
          "parentId": "66a2f1...",   // ตอบกลับความคิดเห็นด้านบน
          "text": "รับทราบ แจ้งฝ่ายเดินรถแล้ว",
          "by": "Plug",
          "at": "2026-07-19T16:40:00.000+07:00",
          "editedAt": "2026-07-19T17:02:00.000+07:00"   // มีเฉพาะข้อความที่ถูกแก้ไขภายหลัง
        }
      ]
    }
  ]
}`}</CodeBlock>
          <p className="text-[#9AA8A0]">หมายเหตุ: ไฟล์ทุกชุดส่งเป็นลิงก์สาธารณะ เปิด/ดาวน์โหลดได้ตรง ๆ ไม่ต้อง login · เช็ค <code>fileType</code> ก่อนแสดง (รูป = <code>webpUrl</code>/<code>thumbnailUrl</code>, PDF = <code>webpUrl</code> ชี้ไฟล์ PDF) · ไม่มีไฟล์ = <code>[]</code> · ความคิดเห็นส่งเฉพาะชื่อผู้เขียน (<code>by</code>) ไม่ส่งอีเมล · ถ้าไม่ส่ง <code>vehicle</code> จะได้ <code>400</code> พร้อมข้อความอธิบาย</p>
          <p className="text-[#9AA8A0]">
            🕒 <b className="text-[#37473E] dark:text-gray-200">เขตเวลา:</b> ทุก field ที่เป็นวัน-เวลา (<code>createdAt</code>, <code>updatedAt</code>, <code>statusSinceAt</code>, <code>history[].at</code>, <code>comments[].at</code>, <code>comments[].editedAt</code>)
            ส่งออกเป็น<b>เวลาไทย</b> รูปแบบ ISO 8601 พร้อม offset <code>+07:00</code> — นำไปแสดงผลได้ตรง ๆ และ parse ได้ทุกภาษา ส่วน field ที่เป็นวันที่ล้วน (<code>receivedDate</code>, <code>dueDate</code> ฯลฯ) เป็นวันไทยอยู่แล้วในรูปแบบ <code>YYYY-MM-DD</code>
          </p>
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
    "nextJobId": "JR-2026-0001",   // รหัส Job Request ฝั่ง Mena-Next — ส่งซ้ำ = 409 + existingId (กันเปิดซ้ำตอน retry)

    // ── 🚚 ข้อมูลรถ ──
    "jobType": "อู่นอก",            // อู่นอก | อะไหล่ลงคัน (ไม่ส่ง = อู่นอก)
    "plate": "สบ.70-1234",         // จำเป็น — ทะเบียนรถ
    "fleetNo": "M123",             // เบอร์รถ
    "receivedDate": "2026-08-06",  // วันที่รับแจ้ง (YYYY-MM-DD)
    "fleet": "Mixer",              // ฟลีท
    "plant": "โรงงาน A",            // แพล้นท์
    "driverName": "สมศักดิ์ ใจดี",     // ชื่อคนขับ
    "driverPhone": "081-234-5678", // เบอร์โทรคนขับ
    "drivableStatus": "วิ่งไม่ได้",     // สภาพรถ: "" | วิ่งได้ | วิ่งไม่ได้
    "cementStatus": "มีปูน",         // ปูนในโม่: "" | มีปูน | ไม่มีปูน
    "breakdownLocation": "13.7563,100.5018",   // พิกัดที่รถเสีย: ลิงก์ Google Maps / lat,long / ข้อความ
    "images": [ <file>, ... ],     // ไฟล์แนบ (รูป / PDF) — ดูหัวข้อ "อัปโหลดไฟล์" ด้านล่าง

    // ── 🔧 งานซ่อม ──
    "symptom": "เบรกไม่อยู่",        // รายละเอียดอาการ
    "garage": "อู่ ก.การช่าง",        // อู่
    "garageInDate": "2026-08-07",  // วันที่รถเข้าอู่ซ่อม
    "mrNo": "MR-2026-001",         // เลขใบแจ้งซ่อม MR

    // ── 🧾 ใบเสนอราคา ──
    "quotationDetail": "ค่าแรง 8,000 + อะไหล่ 7,000",   // รายละเอียดใบเสนอราคา
    "quotationImages": [ <file>, ... ],   // แนบใบเสนอราคา (PDF / รูป)

    // ── 📋 สถานะ · เอกสาร ──
    "status": "แจ้งซ่อมอู่นอก",       // จำเป็น — ตาม workflow ของประเภทงาน
    "waitingQuote": true,          // ติ๊ก 🔍 รอใบเสนอราคา (เฉพาะอู่นอก) — true/false
    "stageEta": "2026-08-10",      // แนะนำ — วันที่คาดว่าจะพ้นสถานะนี้ (หน้าเว็บบังคับกรอก, API ยังไม่บังคับ)
    "prCode": "LBPR26080001,LBPR26080002",   // รหัส PR หลายอันคั่นด้วย ,
    "poCode": "LBPO26080010",      // รหัส PO หลายอันคั่นด้วย ,
    "dueDate": "2026-08-15",       // วันกำหนดเสร็จ
    "completedDate": ""            // วันที่ซ่อมเสร็จ
  }'`}</CodeBlock>
          <p className="text-[#9AA8A0]">ทุก field ยกเว้น <code>plate</code> / <code>status</code> ไม่บังคับ — ไม่ส่ง = ค่าว่าง · วันที่ทุกช่องใช้รูปแบบ <code>YYYY-MM-DD</code> (ปี พ.ศ. ระบบแปลงเป็น ค.ศ. ให้) · บาง status ต้องมี field ประกอบ (เช่น <code>รถเสร็จ</code> ต้องมี <code>completedDate</code>) ไม่ครบจะได้ <code>400</code> พร้อมข้อความ</p>
          <p className="text-[#9AA8A0]">ตอบกลับ <code>201</code> พร้อม <code>id</code> ของรายการ · กันซ้ำเหมือนหน้าเว็บ: รถคันเดียวกันมีรายการไม่เสร็จได้ 1 รายการ (ซ้ำ = <code>409</code> พร้อม <code>existingId</code>)</p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">✏️ PATCH — แก้บางฟิลด์ (แนะนำ เช่น อัพเดทสถานะ)</p>
          <CodeBlock>{`curl -X PATCH "${BASE}/api/repair-external/sync" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: <API_KEY>" \\
  -H "x-user: สมชาย (ทีมจัดซื้อ)" \\
  -d '{
    "id": "665f1c...",             // จาก GET /sync (field _id) — หรือส่ง "nextJobId" แทน id ก็ได้
    "status": "รถเข้าซ่อมอู่นอก",
    "garageInDate": "2026-08-06"
  }'`}</CodeBlock>
          <p className="text-[#9AA8A0]">ฟิลด์ที่ไม่ส่งมา = คงค่าเดิม · การเปลี่ยนสถานะถูกบันทึกลง history อัตโนมัติ</p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">🔁 PUT — แทนที่ทั้งรายการ (ต้องส่งฟิลด์ครบทุกตัว)</p>
          <CodeBlock>{`curl -X PUT "${BASE}/api/repair-external/sync" \\
  -H "Content-Type: application/json" -H "x-api-key: <API_KEY>" \\
  -d '{ "id": "665f1c...", "plate": "สบ.70-1234", "status": "...", ...ฟิลด์อื่นทั้งหมด }'`}</CodeBlock>
          <p className="text-[#9AA8A0]">⚠ PUT ฟิลด์ที่ไม่ส่ง = ถูกล้างเป็นค่าว่าง — ถ้าจะแก้บางฟิลด์ใช้ PATCH เสมอ</p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">📎 อัปโหลดไฟล์แนบ / ใบเสนอราคา (2 ขั้น)</p>
          <p>1) ขอลิงก์อัปโหลด — รับ <code>.pdf .jpg .jpeg .png .webp</code> ไม่เกิน 25MB ต่อไฟล์ (ไม่ต้องมี API key):</p>
          <CodeBlock>{`curl -X POST "${BASE}/api/repair-external/sync/upload" \\
  -H "Content-Type: application/json" \\
  -d '{ "filename": "ใบเสนอราคา อู่ ก.pdf", "file_size": 245120 }'

// ตอบกลับ
{
  "ok": true,
  "upload_url": "https://mn-bucket.sgp1.digitaloceanspaces.com/media-docs/…?X-Amz-Signature=…",
  "method": "PUT",
  "headers": { "Content-Type": "application/pdf", "x-amz-acl": "public-read" },
  "expires_in": 600,              // ลิงก์ใช้ได้ 10 นาที
  "file": {                       // ← เก็บไว้ใส่ใน images / quotationImages
    "mediaId": 0, "batchId": "doc", "filename": "ใบเสนอราคา อู่ ก.pdf",
    "webpUrl": "https://mn-bucket.sgp1.digitaloceanspaces.com/media-docs/…/ใบเสนอราคา%20อู่%20ก.pdf",
    "thumbnailUrl": "", "fileType": "pdf"
  }
}`}</CodeBlock>
          <p>2) PUT ตัวไฟล์ไปที่ <code>upload_url</code> พร้อม <b>headers ตามที่ได้รับทุกตัว</b> (ไม่ตรง = <code>403</code>) แล้วใส่ <code>file</code> ลงในรายการ:</p>
          <CodeBlock>{`curl -X PUT "<upload_url>" \\
  -H "Content-Type: application/pdf" -H "x-amz-acl: public-read" \\
  --data-binary @"ใบเสนอราคา อู่ ก.pdf"

# แนบเข้าใบงาน — PATCH แทนที่ทั้ง array: ต้องส่งไฟล์เดิม (จาก GET) + ไฟล์ใหม่
curl -X PATCH "${BASE}/api/repair-external/sync" \\
  -H "Content-Type: application/json" -H "x-user: สมชาย (ทีมจัดซื้อ)" \\
  -d '{ "id": "665f1c...", "quotationImages": [ ...ไฟล์เดิม, <file> ] }'`}</CodeBlock>
          <p className="text-[#9AA8A0]">ไฟล์ที่ใส่ใน <code>images</code> / <code>quotationImages</code> / <code>negotiationImages</code> ต้องได้มาจาก <code>/sync/upload</code> หรือจาก GET เท่านั้น (ลิงก์ภายนอก = <code>400</code>) · ส่ง <code>[]</code> = ลบไฟล์ทั้งหมดออกจากใบ · รูปที่อัปโหลดผ่าน API ไม่มีรูปย่อ (<code>thumbnailUrl</code> ว่าง ใช้ <code>webpUrl</code> แทน)</p>

          <p className="pt-2">กติกาที่ระบบบังคับทุก method: รายการที่ปิดงานแล้ว (รถเสร็จ/ลงคันเสร็จ) <b>ย้อนสถานะไม่ได้</b> (<code>409</code>) · ทุกการเขียนลงประวัติ (history) พร้อมชื่อจาก <code>x-user</code></p>
        </Section>

        <Section icon={Bell} title="เชื่อมกับ Mena-Next — แจ้งเตือน · ข้อความ · feed">
          <p><b>ผูกใบงาน:</b> ส่ง <code>nextJobId</code> ตอน POST (หรือ PATCH ใบเดิมเพื่อผูกทีหลัง) แล้วใช้แทน <code>id</code> ได้ทุกเส้น · 1 รหัส ผูกได้ 1 ใบงาน</p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">💬 POST /sync/comment — เขียนข้อความลงใบงาน</p>
          <CodeBlock>{`curl -X POST "${BASE}/api/repair-external/sync/comment" \\
  -H "Content-Type: application/json" -H "x-user: สมชาย (ยานยนต์)" \\
  -d '{
    "nextJobId": "JR-2026-0001",   // หรือ "id": "665f1c..."
    "text": "ขอแยกค่าแรงกับค่าอะไหล่ในใบเสนอราคา",
    "parentId": "66a2f1..."        // ไม่บังคับ — ตอบกลับข้อความนั้น (comments[].id จาก GET)
  }'
// ตอบกลับ 201 { "ok": true, "id": "665f1c...", "commentId": "66b0...", "parentId": null }`}</CodeBlock>
          <p className="text-[#9AA8A0]">ขึ้นในไทม์ไลน์หน้าเว็บพร้อมป้าย 🔗 จาก Mena-Next · เขียนได้จนกว่าใบงานจะปิด (รถเสร็จ/ลงคันเสร็จ = <code>409</code>) · ≤ 2,000 ตัวอักษร · ใน GET ข้อความจาก API มี <code>kind: &quot;external&quot;</code></p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">📡 GET /sync/changes — feed เหตุการณ์ทุกใบงาน (ทางหลัก)</p>
          <CodeBlock>{`# ครั้งแรก: since = เวลาเริ่ม (ไม่ส่ง = 24 ชม.ล่าสุด)
curl "${BASE}/api/repair-external/sync/changes?since=2026-09-25T08:00:00%2B07:00"
# รอบต่อไป: ส่ง next_after ที่ได้ล่าสุด (เก็บไว้ฝั่ง Next) — ไม่ตกหล่น ไม่ซ้ำ
curl "${BASE}/api/repair-external/sync/changes?after=66b1c2...&type=quotation.updated,comment.created"

{
  "ok": true, "count": 2,
  "next_after": "66b1c9...",   // ใช้เป็น after รอบหน้า (ไม่มีอะไรใหม่ = ค่าเดิม)
  "has_more": false,           // true = ยังมีต่อ เรียกซ้ำทันทีด้วย next_after
  "events": [
    {
      "id": "66b1c5...", "type": "quotation.updated", "at": "2026-09-25T10:12:00.000+07:00",
      "repairId": "665f1c...", "nextJobId": "JR-2026-0001",
      "plate": "สบ.70-1234", "fleetNo": "M123", "status": "รถเข้าซ่อมอู่นอก",
      "by": "Nest", "source": "wms",          // wms = คนกดในหน้าเว็บ · api = มาจาก /sync (ของ Next เอง)
      "data": {
        "newFiles": [ { "filename": "ใบเสนอราคา.pdf", "url": "https://mn-bucket…/ใบเสนอราคา.pdf", "fileType": "pdf" } ],
        "quotationDetail": "ค่าแรง 8,000 + อะไหล่ 7,000", "fileCount": 1
      }
    },
    {
      "id": "66b1c9...", "type": "comment.created", "at": "…", "repairId": "665f1c...", "nextJobId": "JR-2026-0001",
      "by": "Nest", "source": "wms",
      "data": { "commentId": "66b1c8...", "parentId": null, "text": "อู่ส่งใบเสนอราคาแล้ว รบกวนตรวจ" }
    }
  ]
}`}</CodeBlock>
          <p>ชนิดเหตุการณ์ (<code>type</code>): <code>job.created</code> เปิดใบงาน · <code>status.changed</code> เปลี่ยนสถานะ (<code>data.from/to</code>) · <code>quotation.updated</code> แนบไฟล์ใบเสนอราคาเพิ่ม (<code>data.newFiles</code>) หรือแก้รายละเอียด · <code>comment.created</code> ข้อความใหม่ · กรองด้วย <code>type=a,b</code> หรือ <code>nextJobId=</code> · <code>limit</code> ≤ 500</p>

          <p className="pt-2 font-semibold text-[#14271C] dark:text-white">🔔 Webhook — แจ้งทันที (ทางเสริม)</p>
          <p>ถ้า Next ให้ URL ปลายทางมา WMS จะ <code>POST</code> เหตุการณ์ (รูปแบบเดียวกับ <code>events[]</code> ด้านบน ทีละรายการ) ไปทันทีหลังบันทึก พร้อม header <code>x-webhook-secret</code> ไว้ตรวจว่ามาจาก WMS จริง · ตอบ <code>2xx</code> ภายใน 5 วินาที · <b>ไม่ส่งซ้ำเมื่อพลาด</b> — ให้ใช้ feed ด้านบนเก็บตกเสมอ (ใช้ <code>id</code> กันประมวลผลซ้ำ)</p>
        </Section>

        <Section icon={ListOrdered} title="สถานะที่เป็นไปได้ (status)">
          <p><b>🔧 อู่นอก:</b></p>
          <p>
            <code>แจ้งซ่อมอู่นอก</code> → <code>รถเข้าซ่อมอู่นอก</code> → <code>รอ PR</code> →{" "}
            <code>ซ่อมไม่มีกำหนด</code> / <code>ซ่อมมีกำหนดเสร็จ</code> → <code>รถเสร็จ(ไม่มี PR)</code> → <code>รถเสร็จ</code>
          </p>
          <p className="text-[#9AA8A0]">
            หมายเหตุ: &quot;รอใบเสนอราคา&quot; ไม่ใช่สถานะของอู่นอกอีกต่อไป (ตั้งแต่ 11 ส.ค. 2026) — เป็น field แยก{" "}
            <code>waitingQuote</code> (<code>&quot;&quot;</code> หรือ <code>&quot;รอใบเสนอราคา&quot;</code>) ติ๊กควบคู่กับสถานะใดก็ได้ ·
            ส่ง status นอกรายการนี้จะได้ <code>400</code>
          </p>
          <p className="pt-1"><b>🔩 อะไหล่ลงคัน:</b></p>
          <p>
            <code>รอดำเนินการ</code> → <code>รอใบเสนอราคา</code> → <code>รอ PR</code> →{" "}
            <code>สั่งซื้อแล้ว-รอของ</code> → <code>ของถึง-รอลงคัน</code> → <code>ลงคันเสร็จ</code>
          </p>
          <p>งานถือว่า "ปิดแล้ว" เมื่อสถานะเป็น <code>รถเสร็จ</code> (อู่นอก) หรือ <code>ลงคันเสร็จ</code> (อะไหล่ลงคัน) — ตรงกับ <code>scope=done</code></p>
        </Section>
      </div>
    </div>
  )
}
