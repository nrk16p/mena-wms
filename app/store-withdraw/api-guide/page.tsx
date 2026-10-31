import { Code2, FileJson, KeyRound, ListChecks, PackagePlus, Search, TriangleAlert } from "lucide-react"
import { CodeBlock, Method, Param, Section } from "@/components/api-guide-ui"

const BASE = "https://mena-wms.vercel.app"
const API = `${BASE}/api/store-withdraw`
const HDR = `-H "x-api-key: <API_KEY>" -H "x-user: you@menatransport.co.th"`

function Ep({ verb, path }: { verb: "GET" | "POST"; path: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <Method verb={verb} />
      <code className="text-[12px] font-semibold text-[#14271C] dark:text-white">{path}</code>
    </p>
  )
}

export default function Page() {
  return (
    <div className="mx-auto max-w-[860px] px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <Code2 size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
            API เบิกอะไหล่หน้าร้านคลัง
          </h1>
          <p className="text-xs text-[#9AA8A0]">สำหรับระบบอื่นที่ยื่นคำขอเบิกแทนผู้ใช้ — ยื่น · ดูสถานะ · ยกเลิก · กดรับของ · ขอคืน</p>
        </div>
      </div>

      <div className="space-y-4">
        <Section icon={KeyRound} title="การยืนยันตัวตน">
          <p>ทุก endpoint ด้านล่างส่ง 2 header นี้ (ขอ API key จากผู้ดูแลระบบ WMS):</p>
          <ul className="ml-1 space-y-2">
            <Param name="x-api-key" required>กุญแจของระบบที่เรียก</Param>
            <Param name="x-user" required>อีเมลของ<b>คนที่ทำรายการจริง</b> — ใบจะเป็นของอีเมลนี้ และเรียกดู/ยกเลิก/รับของ/ขอคืนได้เฉพาะใบของอีเมลตัวเอง</Param>
          </ul>
          <p>งานฝั่งสโตร์ (รับงาน จัดของ ส่งของ ปฏิเสธ รับคืน) <b>เรียกด้วย API key ไม่ได้</b> ต้องล็อกอินเข้า WMS เอง</p>
        </Section>

        <Section icon={Search} title="ตัวเลือกและค้นหา">
          <Ep verb="GET" path="/api/store-withdraw/options" />
          <CodeBlock>{`curl ${HDR} "${API}/options"

{ "inventories": [ { "id": 4, "name": "ลาดกระบัง" } ],
  "pickTos":     [ { "id": 7, "name": "ซ่อมรถ" } ] }`}</CodeBlock>
          <p><code>inventoryId</code> และ <code>pickToId</code> ตอนยื่นคำขอต้องมาจากรายการนี้</p>
          <Ep verb="GET" path="/api/store-withdraw/lookup/{mr|sku|serial|wd}?q=&limit=&inv=&sku_id=" />
          <CodeBlock>{`curl ${HDR} "${API}/lookup/sku?q=น้ำมันเครื่อง&inv=4&limit=10"

{ "results": [ { "skuId": 501, "skuCode": "OIL-001", "skuName": "น้ำมันเครื่อง", "stockQty": 12, "raw": { ... } } ] }`}</CodeBlock>
          <ul className="ml-1 space-y-2">
            <Param name="q" required>คำค้นอย่างน้อย 2 ตัวอักษร (สั้นกว่านี้ได้ <code>results: []</code>)</Param>
            <Param name="limit">ค่าเริ่มต้น 20 สูงสุด 50</Param>
            <Param name="inv">รหัสคลัง — ใช้กรองสต๊อกของ <code>kind=sku</code> (<code>stockQty</code> เป็น <code>null</code> ถ้าไม่มีข้อมูล)</Param>
            <Param name="sku_id">ใช้กับ <code>kind=serial</code> เพื่อจำกัดเฉพาะ SKU นั้น</Param>
          </ul>
          <p>เอา <code>skuId / skuCode / skuName</code> จากผลค้น SKU ไปใส่ในบรรทัดของคำขอ · <code>kind</code> ที่ไม่ใช่ mr, sku, serial, wd ตอบ 400</p>
        </Section>

        <Section icon={PackagePlus} title="ยื่นคำขอเบิก">
          <Ep verb="POST" path="/api/store-withdraw" />
          <CodeBlock>{`curl -X POST ${HDR} -H "Content-Type: application/json" "${API}" -d '{
  "kind": "stock",              // stock = เบิกจากสต๊อก | cutoff = เบิกตัดยอด
  "inventoryId": 4,
  "pickToId": 7,
  "plate": "70-1234",
  "mrCode": "MR-2610-001",      // ไม่บังคับ
  "urgent": false,               // true = รถจอดรอ
  "remark": "",
  "lines": [
    { "skuId": 501, "skuCode": "OIL-001", "skuName": "น้ำมันเครื่อง", "requestedQty": 2,
      "mrItemId": null, "mrItemLabel": null, "serialNoId": null, "remark": "" }
  ]
}'

201  { "no": "SW-2610-001" }`}</CodeBlock>
          <ul className="ml-1 space-y-2">
            <Param name="kind" required><code>stock</code> หรือ <code>cutoff</code></Param>
            <Param name="plate" required>ทะเบียนรถ</Param>
            <Param name="lines" required>อย่างน้อย 1 บรรทัด · <code>skuId</code> (จำนวนเต็ม), <code>skuCode</code>, <code>skuName</code>, <code>requestedQty</code> (&gt; 0) บังคับ · SKU ซ้ำในใบเดียวระบบรวมจำนวนให้</Param>
          </ul>
        </Section>

        <Section icon={ListChecks} title="ดูใบ · ยกเลิก · รับของ · ขอคืน">
          <Ep verb="GET" path="/api/store-withdraw?mine=1&status=&limit=" />
          <CodeBlock>{`curl ${HDR} "${API}?mine=1&status=NEW,ISSUED&limit=50"

{ "items": [ { "no": "SW-2610-001", "status": "ISSUED", "lines": [ ... ], "atms": { "code": "LBWD-9001", ... }, ... } ] }`}</CodeBlock>
          <p>ต้องใส่ <code>mine=1</code> เสมอเมื่อเรียกด้วย API key (ไม่ใส่ตอบ 403) · <code>status</code> คั่นด้วย comma · <code>limit</code> ค่าเริ่มต้น 200 สูงสุด 500 · เรียงใหม่สุดก่อน</p>

          <Ep verb="GET" path="/api/store-withdraw/{no}" />
          <CodeBlock>{`curl ${HDR} "${API}/SW-2610-001"

{ "request": { "no": "SW-2610-001", "kind": "stock", "status": "ISSUED", "plate": "70-1234",
               "lines": [ { "skuCode": "OIL-001", "requestedQty": 2, "issuedQty": 2, "short": false, "returnedQty": 0, ... } ],
               "atms": { "code": "LBWD-9001", "approved": true, "error": null, "drift": null, ... },
               "returns": [ ... ] },
  "log": [ { "action": "create", "from": null, "to": "NEW", "at": "2026-10-31T02:10:00.000Z", ... } ] }`}</CodeBlock>
          <p>สถานะ: <code>NEW</code> รอสโตร์ · <code>PREPARING</code> กำลังจัด · <code>READY</code> จัดเสร็จ · <code>ISSUING</code> กำลังตัดใน ATMS · <code>ISSUED</code> ส่งของแล้ว · <code>ISSUE_FAILED</code> ส่ง ATMS ไม่สำเร็จ (สโตร์ลองใหม่) · <code>RECEIVED</code> ผู้ขอรับของแล้ว · <code>REJECTED</code> สโตร์ปฏิเสธ (ดู <code>rejectReason</code>) · <code>CANCELLED</code> ยกเลิก</p>

          <Ep verb="POST" path="/api/store-withdraw/{no}/cancel" />
          <CodeBlock>{`curl -X POST ${HDR} "${API}/SW-2610-001/cancel"

{ "request": { ... "status": "CANCELLED" } }`}</CodeBlock>
          <p>ยกเลิกได้เฉพาะใบที่ยังเป็น <code>NEW</code> — สถานะอื่นตอบ 409</p>

          <Ep verb="POST" path="/api/store-withdraw/{no}/receive" />
          <CodeBlock>{`curl -X POST ${HDR} "${API}/SW-2610-001/receive"

{ "request": { ... "status": "RECEIVED" } }`}</CodeBlock>
          <p>กดรับของได้เมื่อสถานะ <code>ISSUED</code> และเป็นใบ <code>{'kind: "stock"'}</code> (ใบตัดยอดไม่มีขั้นรับของ)</p>

          <Ep verb="POST" path="/api/store-withdraw/{no}/returns" />
          <CodeBlock>{`curl -X POST ${HDR} -H "Content-Type: application/json" "${API}/SW-2610-001/returns" -d '{
  "lines": [ { "lineIndex": 0, "qty": 1 } ]     // lineIndex = ลำดับบรรทัดในใบ เริ่มที่ 0
}'

201  { "rid": "R3FA9C1" }`}</CodeBlock>
          <p>ขอคืนได้เมื่อสถานะ <code>ISSUED</code> หรือ <code>RECEIVED</code> · คืนเกินจำนวนที่เบิก (รวมที่รอคืนอยู่) ตอบ 409 · สโตร์ต้องเป็นคนกดรับคืนใน WMS ผลอยู่ใน <code>returns[]</code> ของใบ</p>
        </Section>

        <Section icon={FileJson} title="field ที่ควรรู้ใน atms">
          <ul className="ml-1 space-y-2">
            <Param name="atms.code">เลขใบเบิก (WD) ที่ตัดใน ATMS · <code>null</code> = ยังไม่ได้ตัด</Param>
            <Param name="atms.error">ข้อความเมื่อส่ง ATMS ไม่สำเร็จ</Param>
            <Param name="atms.drift">ข้อความเมื่อใบใน ATMS ถูกแก้ภายหลัง (ถอนอนุมัติ จำนวนไม่ตรง ใบถูกลบ) · <code>null</code> = ตรงกัน · ระบบตรวจให้เป็นรอบ ๆ</Param>
          </ul>
        </Section>

        <Section icon={TriangleAlert} title="รหัส error">
          <p>ทุก error ตอบเป็น <code>{`{ "error": "ข้อความภาษาไทย" }`}</code></p>
          <ul className="ml-1 space-y-2">
            <Param name="400">ข้อมูลไม่ครบหรือไม่ถูกต้อง · ไม่ได้ส่ง <code>x-user</code> หรืออีเมลผิดรูปแบบ</Param>
            <Param name="401">API key ไม่ถูกต้อง (หรือไม่ได้ล็อกอิน)</Param>
            <Param name="403">ใบไม่ใช่ของ <code>x-user</code> · ลิสต์โดยไม่ใส่ <code>mine=1</code> · เรียกงานสโตร์ด้วย API key</Param>
            <Param name="404">ไม่พบใบเลขที่นั้น</Param>
            <Param name="409">สถานะใบเปลี่ยนไปแล้ว ทำรายการนี้ไม่ได้ (เช่น ยกเลิกหลังสโตร์รับงาน, คืนเกินจำนวน) — ดึงใบใหม่แล้วดูสถานะ</Param>
            <Param name="502 / 503">ค้นข้อมูลจาก ATMS ไม่ได้ชั่วคราว (ลองใหม่) หรือ WMS ยังไม่ได้ตั้งบัญชีค้นข้อมูล (แจ้งผู้ดูแล)</Param>
            <Param name="500">ระบบขัดข้อง — ลองใหม่ ถ้ายังไม่ได้แจ้งผู้ดูแล</Param>
          </ul>
        </Section>
      </div>
    </div>
  )
}
