import { ClipboardCheck, Code2, FileJson, KeyRound, ListChecks, PackagePlus, Search, TriangleAlert } from "lucide-react"
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
          <p className="text-xs text-[#9AA8A0]">สำหรับระบบอื่นที่ยื่นคำขอเบิกแทนผู้ใช้ — ยื่น · ดูสถานะ · ยกเลิก · กดรับของ · ขอคืน · สรุปการใช้ (Mobile/PM)</p>
        </div>
      </div>

      <div className="space-y-4">
        <Section icon={KeyRound} title="การยืนยันตัวตน">
          <p>ทุก endpoint ด้านล่างส่ง 2 header นี้ (ขอ API key จากผู้ดูแลระบบ WMS):</p>
          <ul className="ml-1 space-y-2">
            <Param name="x-api-key" required>กุญแจของระบบที่เรียก</Param>
            <Param name="x-user" required>อีเมล @menatransport.co.th ของ<b>คนที่ทำรายการจริง</b> ใบจะเป็นของอีเมลนี้ และเรียกดู/ยกเลิก/รับของ/ขอคืนได้เฉพาะใบของอีเมลตัวเอง</Param>
          </ul>
          <p>งานฝั่งสโตร์ (รับงาน จัดของ ส่งของ ปฏิเสธ รับคืน) <b>เรียกด้วย API key ไม่ได้</b> ต้องล็อกอินเข้า WMS เอง</p>
        </Section>

        <Section icon={Search} title="ตัวเลือกและค้นหา">
          <Ep verb="GET" path="/api/store-withdraw/options" />
          <CodeBlock>{`curl ${HDR} "${API}/options"

{ "inventories": [ { "id": 4, "name": "ลาดกระบัง" } ],
  "pickTos":     [ { "id": 7, "name": "ซ่อมรถ" } ] }`}</CodeBlock>
          <p><code>inventoryId</code> และ <code>pickToId</code> ตอนยื่นคำขอต้องมาจากรายการนี้</p>
          <Ep verb="GET" path="/api/store-withdraw/lookup/{mr|mrv|sku|serial|wd|po|dd}?q=&limit=&inv=&sku_id=" />
          <CodeBlock>{`curl ${HDR} "${API}/lookup/sku?q=น้ำมันเครื่อง&inv=4&limit=10"

{ "results": [ { "skuId": 501, "skuCode": "OIL-001", "skuName": "น้ำมันเครื่อง", "stockQty": 12, "raw": { ... } } ] }`}</CodeBlock>
          <ul className="ml-1 space-y-2">
            <Param name="q" required>คำค้นอย่างน้อย 2 ตัวอักษร (สั้นกว่านี้ได้ <code>results: []</code>)</Param>
            <Param name="limit">ค่าเริ่มต้น 20 สูงสุด 50</Param>
            <Param name="inv">รหัสคลัง — ใช้กรองสต๊อกของ <code>kind=sku</code> (<code>stockQty</code> เป็น <code>null</code> ถ้าไม่มีข้อมูล)</Param>
            <Param name="sku_id">ใช้กับ <code>kind=serial</code> เพื่อจำกัดเฉพาะ SKU นั้น</Param>
          </ul>
          <p>เอา <code>skuId / skuCode / skuName</code> จากผลค้น SKU ไปใส่ในบรรทัดของคำขอ · <code>kind</code> ที่ไม่ใช่ mr, sku, serial, wd, po, dd ตอบ 400</p>
        </Section>

        <Section icon={Search} title="อ้างอิงใบ PR / PO / DD และดึงรายการมาใส่คำขอ">
          <Ep verb="GET" path="/api/store-withdraw/lookup/{po|dd|pr}?q=&inv=&limit=" />
          <CodeBlock>{`curl ${HDR} "${API}/lookup/po?q=LBPO2610&inv=4"

{ "results": [ { "id": 157902, "code": "LBPO26100704", "kind": "po", "date": "25/10/2026",
                 "supplier": "...", "status": "ยังไม่ได้รับสินค้า", "total": 1100, "ref": "LBPR26100561" } ] }`}</CodeBlock>
          <p>ค้นเลขใบจาก ATMS (<code>q</code> อย่างน้อย 2 ตัวอักษร) · ค้นย้อนหลัง 90 วัน เรียงใหม่สุดก่อน · DD ที่ไม่มี supplier/status/total ได้ <code>null</code></p>
          <p><b>PR:</b> <code>lookup/pr?q=71-1234</code> — <code>q</code> คือ<b>ทะเบียน/เบอร์รถ</b> ได้ PR ล่าสุดของรถคันนั้นไม่เกิน 5 ใบ (ใหม่สุดก่อน) แต่ละใบมี <code>remark</code> (ข้อความหมายเหตุของ PR) ไว้ตรวจว่าตรงงาน</p>
          <p><b>MR ของรถ:</b> <code>lookup/mrv?q=71-1234</code> — <code>q</code> คือ<b>ทะเบียน/เบอร์รถ</b> ได้หัวใบแจ้งซ่อม (MR) ล่าสุดของรถคันนั้นไม่เกิน 5 ใบ (ใหม่สุดก่อน) แต่ละใบมี <code>code, date, plate, vehicle_no, step, driver, mechanic</code> และ <code>remark</code> (สรุปรายการซ่อมในใบ รูปแบบ &quot;ประเภทการซ่อม: รายละเอียด&quot; คั่นด้วย · ไม่เกิน 300 ตัว ว่างถ้าอ่านไม่ได้) พร้อม <code>items</code> (แต่ละรายการมี <code>type</code> กับ <code>detail</code>) ไว้แยกใบที่คล้ายกัน · เลือกแล้วค่อยเรียก <code>lookup/mr?q=&lt;เลข MR&gt;</code> เพื่อเอารายการในใบ</p>
          <Ep verb="GET" path="/api/store-withdraw/lookup/doc/{po|dd|pr}/{id}?inv=" />
          <CodeBlock>{`curl ${HDR} "${API}/lookup/doc/po/157902?inv=4"

{ "doc":   { "id": 157902, "code": "LBPO26100704", "kind": "po", "date": "25/10/2026", "supplier": "...", "pr": "LBPR26100561", "po": null },
  "lines": [ { "skuCode": "LB03SS00471", "skuName": "LB03SS00471 : ลูกหมากคันเกียร์ LH 8*8", "group": "ระบบช่วงล่าง", "isLabour": false,
               "docQty": 1, "receivedQty": 0, "qty": 0, "unitPrice": 300,
               "skuId": 4101, "stockQty": 12, "alreadyCut": 0, "cutBy": [ "SW-2611-004" ] } ],
  "warnings": [ "ใบนี้ยังไม่ได้รับของ" ] }`}</CodeBlock>
          <ul className="ml-1 space-y-2">
            <Param name="qty">จำนวนตั้งต้นที่ควรนำเข้า = จำนวนที่<b>รับแล้ว</b> (DD = จำนวนในใบ) · PO ที่ยังไม่รับ = 0</Param>
            <Param name="PR / PO / DD">นำเข้า<b>เฉพาะอะไหล่</b> — บรรทัดค่าแรงถูกตัดออกที่เซิร์ฟเวอร์ (มีคำเตือน &quot;ข้ามบรรทัดค่าแรง N รายการ&quot;) · <code>qty</code> ตั้งต้น = จำนวนที่ขอในใบ (<code>docQty</code>) · <code>receivedQty</code> เป็น 0 เสมอ</Param>
            <Param name="skuId">เอาไปใส่บรรทัดคำขอได้เลย · <code>null</code> = หา SKU ในคลังนี้ไม่เจอ ใส่ในคำขอไม่ได้</Param>
            <Param name="isLabour">เป็น false เสมอ เพราะบรรทัดค่าแรงถูกตัดออกแล้ว</Param>
            <Param name="alreadyCut / cutBy">ยอดที่คำขออื่นอ้างใบนี้และตัดไปแล้ว กับเลขคำขอเหล่านั้น (ไม่นับที่ยกเลิก/ปฏิเสธ) · ไว้เตือนอย่างเดียว ไม่บล็อก</Param>
          </ul>
          <p>ไม่พบใบตอบ 404 · เรียกด้วย API key ได้เหมือน <code>lookup</code> อื่น (อ่านอย่างเดียว) · ใส่ <code>ref</code> ในคำขอเพื่อให้สโตร์เห็นว่าอ้างใบไหน</p>
        </Section>

        <Section icon={PackagePlus} title="ยื่นคำขอเบิก">
          <Ep verb="POST" path="/api/store-withdraw" />
          <CodeBlock>{`curl -X POST ${HDR} -H "Content-Type: application/json" "${API}" -d '{
  "workType": "garage_in",      // garage_in = อู่ใน | garage_out = อู่นอก | mobile_pm = Mobile/PM
  "inventoryId": 4,
  "pickToId": 7,
  "plate": "70-1234",          // ทะเบียนรถ หรือเบอร์รถ เช่น "เบอร์ 1234" (mobile_pm ไม่บังคับ)
  "summaryDueAt": "2026-11-05T17:00:00+07:00",   // mobile_pm เท่านั้น และบังคับ · กำหนดสรุปการใช้
  "mrCode": "MR-2610-001",      // ไม่บังคับ
  "ref": { "type": "po", "code": "LBPO26100704", "id": 157902 },   // ไม่บังคับ · type = po | dd | pr · code 3-40 ตัว · id ไม่บังคับ
  "urgent": false,               // true = รถจอดรอ
  "remark": "",
  "lines": [
    { "skuId": 501, "skuCode": "OIL-001", "skuName": "น้ำมันเครื่อง", "requestedQty": 2,
      "mrItemId": null, "mrItemLabel": null, "serialNoId": null, "remark": "" }
  ]
}'

201  { "no": "SW-2610-001" }`}</CodeBlock>
          <ul className="ml-1 space-y-2">
            <Param name="workType" required><code>garage_in</code> (อู่ใน) · <code>garage_out</code> (อู่นอก) · <code>mobile_pm</code> (Mobile/PM) · ระบบแปลงเป็น <code>kind</code> ให้เอง: อู่ใน/Mobile-PM = <code>stock</code> (เบิกจากสต๊อก), อู่นอก = <code>cutoff</code> (ตัดยอด) · ตอนดูใบ (<code>GET</code>) มี <code>workType</code> ทุกใบ</Param>
            <Param name="kind">ส่งแบบเดิมได้ (<code>stock</code> หรือ <code>cutoff</code>) ถ้าไม่ส่ง <code>workType</code> ระบบอนุมานให้: stock = อู่ใน, cutoff = อู่นอก · ส่งสองตัวที่ขัดกัน เช่น <code>garage_in</code> กับ <code>cutoff</code> ตอบ 400</Param>
            <Param name="plate" required>ทะเบียนรถ หรือเบอร์รถ (ยาวไม่เกิน 20 ตัว) · <code>mobile_pm</code> ไม่ต้องใส่ก็ได้ เพราะทะเบียนไปใส่ตอนสรุปการใช้</Param>
            <Param name="summaryDueAt">บังคับเฉพาะ <code>mobile_pm</code> · วันเวลาแบบ ISO ที่ต้องกลับมาสรุปว่าใช้ของกับรถคันไหน · ต้องเป็นเวลาหลังจากตอนนี้ และไม่เกิน 60 วัน ไม่งั้นตอบ 400 · <code>mrCode</code> ไม่บังคับเหมือนกัน</Param>
            <Param name="ref">ใบ PR / PO / DD ที่อ้างอิง · ผิดรูปแบบตอบ 400 · ส่งต่อไปอยู่ในหมายเหตุของใบเบิกใน ATMS · ตอนดูใบ (<code>GET</code>) มี <code>ref</code> เสมอ (<code>null</code> ถ้าไม่ได้อ้างอิง)</Param>
            <Param name="lines" required>อย่างน้อย 1 บรรทัด · <code>skuId</code> (จำนวนเต็ม), <code>skuCode</code>, <code>skuName</code>, <code>requestedQty</code> (&gt; 0) บังคับ · SKU ซ้ำในใบเดียวระบบรวมจำนวนให้</Param>
          </ul>
        </Section>

        <Section icon={ListChecks} title="ดูใบ · ยกเลิก · รับของ · ขอคืน">
          <Ep verb="GET" path="/api/store-withdraw?mine=1&status=&limit=" />
          <CodeBlock>{`curl ${HDR} "${API}?mine=1&status=NEW,ISSUED&limit=50"

{ "items": [ { "no": "SW-2610-001", "status": "ISSUED", "lines": [ ... ], "atms": { "code": "LBWD-9001", ... }, ... } ] }`}</CodeBlock>
          <p>ต้องใส่ <code>mine=1</code> เสมอเมื่อเรียกด้วย API key (ไม่ใส่ตอบ 403) · <code>status</code> คั่นด้วย comma · <code>limit</code> ค่าเริ่มต้น 200 สูงสุด 500 · เรียงใหม่สุดก่อน</p>
          <p>ค้นย้อนหลัง: ใส่ <code>q=</code> เพิ่มได้ (เช่น <code>?mine=1&amp;q=71-0626</code>) ค้นจากทะเบียน/เบอร์รถ เลข PR/PO/DD เลขใบเบิก และเลข MR ในใบล่าสุด 500 ใบของคุณ ตอบกลับไม่เกิน 100 ใบ · ไม่สนตัวพิมพ์ ช่องว่าง ขีด จุด · เว้นวรรคหลายคำ = ต้องตรงทุกคำ · q สั้นกว่า 2 ตัวอักษรเท่ากับไม่ค้น (ใช้ <code>status</code>/<code>limit</code> ตามปกติเมื่อไม่ค้น)</p>

          <Ep verb="GET" path="/api/store-withdraw/{no}" />
          <CodeBlock>{`curl ${HDR} "${API}/SW-2610-001"

{ "request": { "no": "SW-2610-001", "kind": "stock", "status": "ISSUED", "plate": "70-1234",
               "lines": [ { "skuCode": "OIL-001", "requestedQty": 2, "issuedQty": 2, "short": false, "returnedQty": 0, ... } ],
               "atms": { "code": "LBWD-9001", "approved": true, "error": null, "drift": null, ... },
               "returns": [ ... ] },
  "log": [ { "action": "create", "from": null, "to": "NEW", "at": "2026-10-31T02:10:00.000Z", ... } ] }`}</CodeBlock>
          <p>สถานะ: <code>NEW</code> รอสโตร์ · <code>PREPARING</code> กำลังจัด · <code>READY</code> จัดเสร็จ · <code>ISSUING</code> กำลังตัดใน ATMS · <code>ISSUED</code> ส่งของแล้ว · <code>ISSUE_FAILED</code> ส่ง ATMS ไม่สำเร็จ (สโตร์ลองใหม่) · <code>RECEIVED</code> ผู้ขอรับของแล้ว · <code>REJECTED</code> สโตร์ปฏิเสธ (ดู <code>rejectReason</code>) · <code>CANCELLED</code> ยกเลิก</p>
          <p>Mobile/PM: <code>HANDED_OUT</code> เบิกแล้ว รอสรุปการใช้ · <code>SUMMARIZED</code> สรุปแล้ว รอตัดสต๊อก · <code>SETTLING</code> กำลังตัดใน ATMS · <code>SETTLE_FAILED</code> ตัดสต๊อกไม่สำเร็จ (สโตร์ลองใหม่) · <code>SETTLED</code> ตัดแล้ว (เลข WD ต่อทะเบียนอยู่ใน <code>settleGroups[].atms.code</code>)</p>

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
  "reasonCode": "claim",                  // บังคับ · ดูรหัสด้านล่าง · ไม่ใส่/ผิดตอบ 400
  "reasonNote": "ลูกหมากไม่ตรงรุ่น",              // ไม่บังคับ (บังคับถ้า reasonCode = other) · ไม่เกิน 300 ตัวอักษร
  "attachmentIds": ["9f3a1c0b7d2e4a55"],        // ไม่บังคับ (บังคับถ้า reasonCode = claim) · id จากขั้นตอนแนบไฟล์ด้านล่าง
  "lines": [ { "lineIndex": 0, "qty": 1 } ]     // lineIndex = ลำดับบรรทัดในใบ เริ่มที่ 0
}'

201  { "rid": "R3FA9C1" }`}</CodeBlock>
          <p><code>reasonCode</code>: <code>unused</code> ไม่ได้ใช้ · <code>claim</code> ส่งเคลม · <code>sell</code> ขายออก · <code>keep_other_truck</code> เก็บไว้ใช้คันอื่น · <code>over_order</code> เบิกเกินที่ใช้จริง · <code>job_cancelled</code> งานยกเลิก/ซ่อมเสร็จก่อน · <code>other</code> อื่นๆ (ต้องมี <code>reasonNote</code>)</p>
          <p><b>ส่งเคลม (<code>claim</code>) ต้องแนบหลักฐานอย่างน้อย 1 ไฟล์</b> (รูปหรือ PDF ที่ตัวเองอัปโหลดไว้ในใบนี้ หัวข้อ <code>return</code> ยืนยันแล้ว และยังไม่เคยใช้กับรายการอื่น) ไม่ครบตอบ 400 · เหตุผลอื่นแนบเพิ่มได้ไม่บังคับ</p>
          <p>ขอคืนได้เมื่อสถานะ <code>ISSUED</code> หรือ <code>RECEIVED</code> · คืนเกินจำนวนที่เบิก (รวมที่รอคืนอยู่) ตอบ 409 · สโตร์ต้องเป็นคนกดรับคืนใน WMS ผลอยู่ใน <code>returns[]</code> ของใบ · ใบ <code>mobile_pm</code> ขอคืนไม่ได้ (ตอบ 409) ของเหลือให้กรอกตอนสรุปการใช้แทน</p>
        </Section>

        <Section icon={FileJson} title="แนบรูป/ไฟล์หลักฐาน">
          <p>แนบได้ 3 ขั้น: ขอลิงก์อัปโหลด → ส่งไฟล์ขึ้นลิงก์นั้นตรง ๆ → กดยืนยัน (ระบบเช็กว่าไฟล์อยู่ในที่เก็บและขนาดตรง) · ใช้ได้กับใบของอีเมลใน <code>x-user</code> เท่านั้น ส่วนสโตร์แนบผ่านหน้าเว็บ</p>
          <Ep verb="POST" path="/api/store-withdraw/{no}/attachments/presign" />
          <CodeBlock>{`curl -X POST ${HDR} -H "Content-Type: application/json" "${API}/SW-2610-001/attachments/presign" -d '{
  "context": "return",              // return | reject | summary | receipt | other
  "filename": "ลูกหมาก.jpg",
  "contentType": "image/jpeg",      // image/jpeg, image/png, image/webp, image/heic, application/pdf
  "size": 183204,                   // ไบต์ ไม่เกิน 10 MB
  "sha256": "<เลขฐานสิบหก 64 ตัว>"      // ไม่บังคับ แต่ควรส่ง (เก็บเป็นหลักฐานว่าไฟล์ไม่ถูกเปลี่ยน)
}'

201  { "id": "9f3a1c0b7d2e4a55", "uploadUrl": "https://...", "key": "store-withdraw/SW-2610-001/9f3a...-ลูกหมาก.jpg" }

curl -X PUT -H "Content-Type: image/jpeg" --data-binary @ลูกหมาก.jpg "<uploadUrl>"     # Content-Type ต้องตรงกับที่ขอ

curl -X POST ${HDR} -H "Content-Type: application/json" "${API}/SW-2610-001/attachments/confirm" -d '{ "id": "9f3a1c0b7d2e4a55" }'`}</CodeBlock>
          <ul className="ml-1 space-y-2">
            <Param name="จำนวน">ไม่เกิน 8 ไฟล์ต่อหัวข้อ (<code>context</code>) ต่อใบ · ชนิดไฟล์อื่นหรือใหญ่เกิน 10 MB ตอบ 400</Param>
            <Param name="confirm">ตอบ 409 ถ้ายังไม่เจอไฟล์หรือขนาดไม่ตรงกับที่แจ้ง · ยืนยันได้เฉพาะคนที่ขอลิงก์ · ยืนยันแล้วระบบบันทึกใน log ของใบ</Param>
            <Param name="ผูกกับรายการ">ส่ง <code>attachmentIds</code> ตอนขอคืน (<code>context: &quot;return&quot;</code>) · ไฟล์ที่ผูกแล้วใช้ซ้ำกับรายการอื่นไม่ได้</Param>
            <Param name="แก้/ลบ">ทำไม่ได้ ไฟล์ที่ยืนยันแล้วเก็บไว้เป็นหลักฐาน 7 ปี</Param>
          </ul>
          <Ep verb="GET" path="/api/store-withdraw/{no}/attachments" />
          <CodeBlock>{`curl ${HDR} "${API}/SW-2610-001/attachments"

{ "items": [ { "id": "9f3a1c0b7d2e4a55", "context": "return", "filename": "ลูกหมาก.jpg", "contentType": "image/jpeg",
               "size": 183204, "by": { ... }, "confirmedAt": "...", "linkedTo": { "type": "return", "rid": "R3FA9C1" },
               "url": "https://... (ลิงก์ดาวน์โหลด หมดอายุใน 5 นาที)" } ] }`}</CodeBlock>
        </Section>

        <Section icon={ClipboardCheck} title="Mobile/PM: เบิกไปก่อน สรุปการใช้ทีหลัง">
          <p>ขั้นตอน: ยื่นพร้อม <code>summaryDueAt</code> → สโตร์รับงาน จัดของ กดส่งของ (ยังไม่ตัดใน ATMS) ใบเป็น <code>HANDED_OUT</code> → ช่างสรุปว่าใช้ของกับรถคันไหน ใบเป็น <code>SUMMARIZED</code> → สโตร์รับของเหลือคืนแล้วกดตัดสต๊อก ได้ WD หนึ่งใบต่อทะเบียน เฉพาะส่วนที่ใช้ ของเหลือไม่ตัด ใบเป็น <code>SETTLED</code></p>
          <p>ใบ <code>HANDED_OUT</code> ที่เลยกำหนดสรุปแล้ว ระบบไม่ทำอะไรเอง แค่ขึ้นสีแดง &quot;เลยกำหนดสรุป&quot; ที่หน้าผู้ขอและคิวสโตร์ · ใบมี <code>summaryDueAt</code> กับ <code>summaryExtensions</code> (เลื่อนไปกี่ครั้ง)</p>

          <Ep verb="POST" path="/api/store-withdraw/{no}/summary" />
          <CodeBlock>{`curl -X POST ${HDR} -H "Content-Type: application/json" "${API}/SW-2611-001/summary" -d '{
  "usages": [
    { "lineIndex": 0, "plate": "70-1234", "mrCode": "LBMR26110001", "mrItemId": 257041, "mrItemLabel": "LBMR26110001 PM-ระบบไฟ : 257041", "qty": 2 },
    { "lineIndex": 0, "plate": "71-5678", "mrCode": "LBMR26110002", "mrItemId": 257100, "mrItemLabel": "LBMR26110002 PM-ระบบเบรค : 257100", "qty": 1 }
  ],
  "note": ""                     // ไม่บังคับ
}'

{ "request": { ... "status": "SUMMARIZED",
               "summary": { "usages": [ ... ], "returns": [ { "lineIndex": 0, "qty": 1 } ], "note": "", "by": { ... }, "at": "..." } } }`}</CodeBlock>
          <ul className="ml-1 space-y-2">
            <Param name="usages">หนึ่งแถว = ใช้บรรทัดไหน (<code>lineIndex</code> เริ่ม 0) กับรถคันไหน MR ไหน ประเภทการซ่อมไหน (<code>mrItemId</code> + <code>mrItemLabel</code> จาก <code>lookup/mr</code>) กี่ชิ้น · ทุก field บังคับ · <code>qty</code> &gt; 0 · ใช้หลายคันก็ส่งหลายแถว</Param>
            <Param name="ของเหลือ">ระบบคิดให้เอง = จ่ายไป − ใช้รวม ต่อบรรทัด (ได้ใน <code>summary.returns</code>) · ใช้รวมเกินที่จ่ายตอบ 400 · ไม่ได้ใช้เลยส่ง <code>usages: []</code> ได้ (คืนทั้งหมด)</Param>
          </ul>
          <p>ได้เฉพาะเจ้าของใบ (403) และเฉพาะสถานะ <code>HANDED_OUT</code> (409) · สรุปแล้วแก้ไม่ได้</p>

          <Ep verb="POST" path="/api/store-withdraw/{no}/extend" />
          <CodeBlock>{`curl -X POST ${HDR} -H "Content-Type: application/json" "${API}/SW-2611-001/extend" -d '{ "summaryDueAt": "2026-11-08T17:00:00+07:00" }'

{ "request": { ... "summaryDueAt": "2026-11-08T10:00:00.000Z", "summaryExtensions": 1 } }`}</CodeBlock>
          <p>เลื่อนกำหนดได้เฉพาะเจ้าของใบตอนสถานะ <code>HANDED_OUT</code> · เวลาใหม่ต้องเป็นอนาคตและไม่เกิน 60 วันจากตอนนี้ · บันทึกเวลาเก่า/ใหม่ไว้ใน log</p>

          <Ep verb="POST" path="/api/store-withdraw/{no}/settle" />
          <p>งานของสโตร์ <b>เรียกด้วย API key ไม่ได้</b> (กดในคิวสโตร์) · ส่ง <code>{`{ "returnConfirmed": true }`}</code> เมื่อมีของเหลือ ไม่ส่งตอบ 400 · ตัดด้วยบัญชี ATMS ของสโตร์ที่กด · WD แยกใบต่อทะเบียน (<code>settleGroups[]</code> เรียงตามทะเบียน แต่ละกลุ่มมีเลข <code>{`{no}-{ลำดับ}`}</code> ในหมายเหตุ WD) · พลาดกลางทางเป็น <code>SETTLE_FAILED</code> กดอีกครั้งทำต่อเฉพาะทะเบียนที่ยังไม่เสร็จ ใบที่ตัดแล้วไม่ถูกสร้างซ้ำ · ไม่ได้ใช้เลย = ไม่สร้าง WD ปิดเป็น <code>SETTLED</code> ทันที</p>
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
            <Param name="400">ข้อมูลไม่ครบหรือไม่ถูกต้อง · ไม่ได้ส่ง <code>x-user</code> หรือไม่ใช่อีเมล @menatransport.co.th · ใส่เกิน 50 รายการ หมายเหตุเกิน 500 ตัวอักษร ทะเบียนเกิน 20 ตัวอักษร</Param>
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
