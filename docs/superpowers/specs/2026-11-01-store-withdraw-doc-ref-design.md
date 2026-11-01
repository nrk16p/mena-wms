# เบิกอะไหล่: อ้างอิง PO / DD แล้วนำเข้ารายการ — design

Date: 2026-11-01 · ต่อจาก `2026-10-31-store-withdraw-design.md` · branch ทำงาน: `feat/store-withdraw-doc-ref` (WMS worktree `~/Documents/project/master-sku-web-store-wd`, api-ncac worktree `~/Documents/project/ncac/api-ncac-store-wd`)

## ที่ผู้ใช้ตัดสินใจแล้ว (1/11/2026)

| เรื่อง | ตัดสินใจ |
|---|---|
| ที่ใช้ | หน้า `/store-withdraw/new` ทั้ง **เบิกจากสต๊อก** และ **เบิกตัดยอด** (ทั้งสองแบบ) |
| จำนวนตั้งต้น | ใช้จำนวนที่ **รับเข้าแล้ว** (DD = จำนวนในใบรับ · PO = คอลัมน์ "รับ") ไม่ใช่จำนวนที่สั่ง · แก้ได้ |
| ค่าแรง / บริการ | **ไม่ข้าม** นำเข้าได้เหมือนบรรทัดอื่น แต่ติดป้าย "ค่าแรง/บริการ" ให้เห็น (ATMS อาจไม่ยอมตัดสต๊อก ถ้าไม่ผ่านจะขึ้นที่สโตร์เป็น ISSUE_FAILED ตามปกติ) |
| กันตัดซ้ำ | เตือนอย่างเดียว ไม่บล็อก |

## ข้อมูลจาก ATMS (สำรวจแบบอ่านอย่างเดียว 1/11/2026)

- PO list `GET /inv/purchase.order/index/` filter: `code, department_id, from_t_date, inventory_id, order_by, purchase_request, received_status, related_party_transaction, supplier, to_t_date, vehicle` · คอลัมน์: รหัส · ใบขอสั่งซื้อ (PR) · ผู้ใช้งาน · approver · คลังสินค้า · แผนก · ยานพาหนะ · สถานะการรับสินค้า · วันที่ · กำหนดส่งสินค้า · รวม · ซัพพลายเออร์ · ap term · RPT · ลิงก์ view `/inv/purchase.order/view/id/<id>`
- PO view: label `รหัส · ซัพพลายเออร์ · ใบขอสั่งซื้อ (PR) · คลังสินค้า · แผนก · วันที่ · กำหนดส่งสินค้า · สถานะการรับสินค้า · ยานพาหนะ · หมายเหตุ …` + ตารางรายการ: `กลุ่มสินค้า | สินค้า ("<code> : <name>") | amount | รับ | ค้างรับ | unit price | รวม | หมายเหตุ` + แถว `grand total`, `ภาษีมูลค่าเพิ่ม`, `รวมสุทธิ`
- DD list `GET /inv/deposit/index/` filter: `code, from_created_at, from_received_at, inventory_id, order_by, purchase_order, supplier, supplier_ref_no, to_created_at, to_received_at, user` · DD view (ดู fixture `dd_view_return.html`): `กลุ่มสินค้า | สินค้า | serial no | amount | unit price | รวม | หมายเหตุ`
- **ไม่มี JSON autocomplete** (`/inv/deposit/code.json/`, `/inv/purchase.order/code.json/` ตอบ HTML) → ค้นจากหน้า index ด้วย filter `code`
- บรรทัดค่าแรงปนในใบจริง เช่น กลุ่ม `ค่าแรง-ระบบเบรค ครัช เกียร์` สินค้า `LB00269 : ค่าแรงซ่อมเกียร์` · อะไหล่เช่น `LB03SS00471 : ลูกหมากคันเกียร์ LH 8*8`
- ตัวอย่าง HTML จริง (มีข้อมูลบุคคล ห้ามคัดลอกเข้า repo ตรง ๆ ต้อง scrub): `/private/tmp/claude-501/-Users-menatransport-02-Documents-cluade-workspace/1b362335-b74a-4905-836c-e899cc926635/scratchpad/atms_po/{po_index.html,po_view.html,dd_index2.html}` · DD view ที่ scrub แล้วอยู่ใน api-ncac `tests/fixtures/atms_withdraw/dd_view_return.html`

## สัญญา (contract) ระหว่าง api-ncac ↔ WMS

### api-ncac (เส้นอ่านอย่างเดียว ใช้ `read_creds` เหมือน `/options` `/lookup`; ต้อง x-api-key)

`GET /atms/withdraw/doc/search?kind=po|dd&q=&inventory_id=&limit=20&from=&to=`
→ `{"results":[{"id":157902,"code":"LBPO26100704","kind":"po","date":"25/10/2026","supplier":"…","status":"ยังไม่ได้รับสินค้า","total":1100.0,"ref":"LBPR26100561"}]}`
- ค้นจากหน้า index ด้วย filter `code=<q>` (+ `inventory_id`) · `from`/`to` = DD/MM/YYYY ไม่ใส่ = ย้อนหลัง 90 วัน · `q` ≥ 2 ตัวอักษร ไม่งั้น `results: []` · limit 1–50 · เรียงใหม่สุด
- DD: `supplier` = ซัพพลายเออร์ถ้ามีคอลัมน์ · `ref` = เลข PO (คอลัมน์ purchase_order) หรือ WD (กรณีใบรับคืน) ตามที่มีใน list · `status` = null ถ้าไม่มี · `total` = number|null

`GET /atms/withdraw/doc/{kind}/{id}` (kind = po|dd)
→ ```{"id":157902,"code":"LBPO26100704","kind":"po","date":"25/10/2026","supplier":"…","inventory":"คลังลาดกระบัง","pr":"LBPR26100561","po":null,"withdraw":null,"remark":"…","lines":[{"sku_code":"LB03SS00471","sku_name":"LB03SS00471 : ลูกหมากคันเกียร์ LH 8*8","group":"ระบบช่วงล่าง","amount":1.0,"received":0.0,"remaining":1.0,"unit_price":300.0,"total":300.0,"remark":"บูธเซฟเกียร์","is_labour":false}]}```
- PO: `amount` = สั่ง · `received` = คอลัมน์ "รับ" · `remaining` = "ค้างรับ" · DD: `amount` = จำนวนที่รับ, `received` = เท่ากับ `amount`, `remaining` = null · `po` ของ DD = เลข PO ถ้ามี
- `sku_name` = ข้อความเต็มของคอลัมน์สินค้า (`"<code> : <name>"`) ตามที่ ATMS ใช้ · `sku_code` = ส่วนก่อน ` : `
- `is_labour` = กลุ่มสินค้าขึ้นต้นด้วย `ค่าแรง` (ข้อมูลประกอบเท่านั้น ห้ามกรองบรรทัดทิ้ง)
- 404 ถ้าไม่พบใบ · login หมดอายุ → 401 ตาม `_run` เดิม · ห้ามเขียนอะไรลง ATMS · ปฏิบัติตามกฎ pace ≥ 1 วิ ของ `AtmsWithdrawClient` และล็อกการอ่านรายการ (rows-per-page) เหมือน `list_withdraws`

### WMS (ทุกเส้น session หรือ x-api-key + x-user เหมือน `/lookup/*`; อ่านอย่างเดียว)

- `GET /api/store-withdraw/lookup/po?q=&inv=&limit=` และ `/lookup/dd?...` → `{"results":[{"id","code","kind","date","supplier","status","total","ref"}]}` (ส่งต่อจาก api-ncac `doc/search` ด้วยบัญชีอ่านเดิม) — เพิ่ม kind `po`,`dd` ใน `lookupKind()`
- `GET /api/store-withdraw/lookup/doc/{po|dd}/{id}?inv=` →
  ```json
  { "doc": { "id": 157902, "code": "LBPO26100704", "kind": "po", "date": "25/10/2026", "supplier": "…", "pr": "…", "po": null },
    "lines": [ { "skuCode": "LB03SS00471", "skuName": "LB03SS00471 : ลูกหมากคันเกียร์ LH 8*8", "group": "ระบบช่วงล่าง", "isLabour": false,
                 "docQty": 1, "receivedQty": 0, "qty": 0, "unitPrice": 300, "skuId": 4101, "stockQty": 12, "alreadyCut": 0, "cutBy": ["SW-2611-004"] } ],
    "warnings": ["…"] }
  ```
  - `qty` = จำนวนตั้งต้นที่นำเข้า = `receivedQty` (DD = จำนวนในใบ) · PO ที่ยังไม่รับ = 0 (UI ไม่ติ๊กให้ แต่เลือกเองได้)
  - `skuId`: หาจาก `master_data.atms_sku_master` ตามรหัสสินค้า (ดูฟิลด์จริงใน `lib/store-withdraw/service.ts` `mergeStock` และ `lib/atms-sku-live.ts`) ถ้าไม่เจอค่อยค้น ATMS `lookup/sku?q=<code>&inventory_id=<inv>` เลือกตัวที่รหัสตรงเป๊ะ (สูงสุด 25 ครั้งต่อใบ ห่างกันตามกฎ pace) ไม่เจอ = `null` (UI นำเข้าบรรทัดนั้นไม่ได้ ขึ้น "ไม่พบ SKU ในคลังนี้")
  - `stockQty` = จากสำเนา `atms_sku_master` ตาม `inv` (null ถ้าไม่มี)
  - `alreadyCut` = ผลรวม `issuedQty ?? requestedQty` ของบรรทัดรหัสเดียวกันในคำขอที่ `ref.code` = เลขใบนี้ และสถานะไม่ใช่ CANCELLED/REJECTED · `cutBy` = เลขคำขอเหล่านั้น · ใช้เตือนอย่างเดียว
  - `warnings` = ข้อความไทยสั้น ๆ เช่น "ใบนี้ยังไม่ได้รับของ" (PO ที่ received ทั้งใบ = 0), "ใบนี้มีบรรทัดค่าแรง/บริการ", "บางบรรทัดมีคำขออื่นอ้างและตัดไปแล้ว"
- **ลบ** route `app/api/store-withdraw/lookup/cutoff/route.ts` (คืน `[]` เสมอ ไม่มีใครควรใช้) และเอาการเรียกในฟอร์มออก
- `POST /api/store-withdraw` รับเพิ่ม `ref?: { "type": "po"|"dd", "code": "LBPO…", "id"?: number }` · ตรวจรูปแบบ (type ต้องเป็น po/dd, code 3–40 ตัว ไม่มีช่องว่างหัวท้าย) · เก็บใน `SwRequest.ref: {type, code, id|null} | null` · ส่งต่อใน remark ของใบเบิก ATMS: `"<mrCode> <ref.code> <plate> <remark>"` (ข้ามส่วนที่ว่าง; อย่าให้ `remark_token` เปลี่ยน)
- `GET /api/store-withdraw/...` ทุก response ที่คืนใบ มี `ref` (null ถ้าไม่มี)

### หน้าจอ
- ฟอร์ม `/store-withdraw/new` (ทั้งสอง kind): ส่วน "อ้างอิงใบ PO / DD (ไม่บังคับ)" = ปุ่มสลับ PO | DD + ช่องพิมพ์ค้นเลขใบแบบ autocomplete (debounce 300 ms, ≥2 ตัวอักษร, AbortController — ใช้ `use-lookup.ts` เดิม) แสดงเลขใบ · วันที่ · ซัพพลายเออร์ · สถานะรับ · รวม
- เลือกใบแล้วเปิดแผงรายการ: ติ๊กเลือกบรรทัด · แก้จำนวน (ไม่เกินจำนวนที่รับ ถ้าเกินเตือนสีส้มแต่ไม่บล็อก) · ป้าย `ค่าแรง/บริการ` · `ไม่พบ SKU ในคลังนี้` (ติ๊กไม่ได้) · `คงเหลือ N` · `ตัดไปแล้ว N (SW-…)` · ปุ่ม "นำเข้ารายการที่เลือก" (รวมบรรทัดซ้ำ SKU กับที่กรอกไว้ให้บวกจำนวน)
- บรรทัดที่นำเข้ามีแท็ก `fromDoc` ใน state (ไม่ส่งไปเซิร์ฟเวอร์) — เปลี่ยน/ล้างใบอ้างอิง หรือเปลี่ยนคลัง จะลบบรรทัด `fromDoc` ออก บรรทัดที่พิมพ์เองยังอยู่ · ส่งฟอร์ม: `ref` = ใบที่เลือก
- การ์ดสโตร์ (`ticket-card.tsx`) และรายการของฉัน (`my-requests-page.tsx`): แสดง "อ้างอิง PO LBPO…" / "DD LBDD…" เมื่อมี `ref`
- ภาษา UI: ไทยสั้น พูดแบบคน ห้าม "ระบบจะทำการ…" "ท่านสามารถ…ได้" · ใช้ swal/toast เดิม ห้าม window.confirm/alert · ใช้ได้ที่ 390 px และ 1280 px

### เอกสาร
- แก้หน้าคู่มือ API `app/store-withdraw/api-guide/page.tsx` (เพิ่ม `lookup/po|dd`, `lookup/doc/…`, field `ref`)
- แก้ `docs/store-withdraw-env.md` ถ้ามี env ใหม่ (คาดว่าไม่มี)

## ไม่ทำรอบนี้
ไม่สร้าง PO/DD ใน ATMS · ไม่ย้าย/แก้ใบเดิม · ไม่ล็อกไม่ให้ตัดเกินจำนวนที่รับ (เตือนเท่านั้น) · ไม่ทำวิดีโอใหม่
