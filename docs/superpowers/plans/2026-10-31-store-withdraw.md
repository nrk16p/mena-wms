# เบิกอะไหล่ออนไลน์ + คิวสโตร์ (store withdraw) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ยานยนต์ยื่นคำขอเบิกใน WMS → จอคิวสโตร์แบบครัว → สโตร์กดส่งของ/ตัดยอด/รับคืน แล้วระบบสร้าง WD / DD ใน ATMS ด้วยบัญชีของสโตร์คนนั้นเอง พร้อม API ทุกขั้น

**Architecture:** api-ncac (FastAPI, Render) ถือตัวยิง ATMS ทั้งหมด (form POST แบบ openjob) เป็น service ที่ "ทำต่อจากขั้นที่ค้างได้" · mena-wms (Next.js 16, Mongo `master_data`) ถือคำขอ สถานะ คิว สิทธิ์ และรหัส ATMS ของสโตร์ (เข้ารหัส) แล้วเรียก api-ncac ตอนส่งของ/รับคืน/ดึงรายการ ATMS

**Tech Stack:** Python 3 + FastAPI + requests + BeautifulSoup + pytest (api-ncac) · Next.js 16 App Router + TypeScript + MongoDB driver + NextAuth + `npx tsx scripts/check-*.ts` (WMS)

**Spec:** `docs/superpowers/specs/2026-10-31-store-withdraw-design.md` (BA: `docs/superpowers/specs/assets/2026-10-31-store-withdraw-ba.html`, swimlane: `…/assets/2026-10-31-store-withdraw-swimlane.png`)

**Worktrees:**
- WMS: `~/Documents/project/master-sku-web-store-wd` — สร้าง branch `feat/store-withdraw` จาก `docs/store-withdraw` (ห้ามทำใน checkout หลัก `master-sku-web` — หลาย session ใช้ร่วม)
- api-ncac: `git -C ~/Documents/project/ncac/api-ncac worktree add ~/Documents/project/ncac/api-ncac-store-wd -b feat/store-withdraw origin/main` (checkout หลักอยู่ที่ feat/petty-cash และมีไฟล์ค้าง ห้ามแตะ) · venv ใน repo เป็นแบบ Windows → สร้าง venv ใหม่ใน worktree (`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt`)

## Global Constraints

- ห้ามสร้าง WD/DD ซ้ำจากคำขอเดียว — ทุกการยิง ATMS ต้องทำต่อจาก state ที่บันทึกไว้ได้ และหัวใบต้องมี `remark` ที่มีเลขคำขอ `SW-YYMM-NNN`
- ยิง ATMS ด้วยบัญชีของสโตร์คนที่กดเท่านั้น ห้าม fallback ไป env `ATMS_USERNAME` หรือบัญชีอื่น
- pacing ระหว่างคำขอ ATMS ≥ 1 วินาที · สโตร์หนึ่งคนส่งได้ทีละใบ
- เลขคำขอ `SW-YYMM-NNN` YY = ค.ศ. 2 หลัก, counter key `store_withdraw:YYMM` ใน collection `counters`
- รหัส ATMS เก็บแบบ AES-256-GCM key จาก env `STORE_ATMS_CRED_KEY` (32 bytes base64) — ห้ามส่งรหัสกลับไป browser ห้าม log
- ยกเลิกได้เฉพาะสถานะ `NEW` · ปฏิเสธต้องมีเหตุผล · `issuedQty ≤ requestedQty` · คืนได้ ≤ `issuedQty − returnedQty`
- ไม่ต้องมีหัวหน้าอนุมัติ: ยื่นแล้วเข้าคิวทันที · นำร่องคลังลาดกระบัง `inventory_id = 4`
- ประเภทคำขอ `stock` (เบิกจากสต๊อกจริง) / `cutoff` (เบิกตัดยอด: ของรับเข้าระบบแต่อยู่ที่ร้าน) — ทั้งสองแบบยานยนต์เป็นคนยื่น
- WD ที่คีย์ตรงใน ATMS ต้องขึ้นในจอคิว (อ่านอย่างเดียว) แคช 3 นาทีต่อคลัง
- งานที่แตะ ATMS (`issue`, `returns/:rid/accept`) เรียกผ่าน API key ไม่ได้ ต้องเป็นสโตร์ที่ login อยู่
- ข้อความในหน้าจอเป็นภาษาไทยแบบคนพูด (ผ่านสกิล humanizer) · ใช้ UX component เดิมของโปรเจกต์ (toast/confirm/skeleton) ห้าม `window.confirm/alert`
- ไม่ push / ไม่ deploy จนกว่าผู้ใช้สั่ง · ทุกการเขียนลง ATMS จริง (นอกจาก dry-run) ต้องได้รับอนุญาตจากผู้ใช้ในแชตก่อน

## Review Focus

1. กดส่งของสองครั้งเร็ว ๆ / สองแท็บพร้อมกัน → ต้องได้ WD ใบเดียว (test ใน Task 5 `issue: concurrent calls → one ATMS call`)
2. api-ncac ตอบหลังสร้างหัวใบแล้วล่มกลางรายการ → ลองใหม่ต้องใช้ gm_id เดิมและข้ามบรรทัดที่ทำแล้ว (test ใน Task 2 `resume skips done lines` + Task 5 `issue: retry passes saved progress`)
3. response หายหลังสร้างหัวใบ (ไม่รู้ gm_id) → ลองใหม่ต้องค้นใบจาก remark ก่อน ไม่สร้างใหม่ (test ใน Task 2 `issue without gm_id searches remark first`)
4. สโตร์เปลี่ยนรหัสใน ATMS → ได้ 401 แล้ว UI ขอรหัสใหม่ ไม่ใช่ error ค้าง และสถานะเป็น `ISSUE_FAILED` ที่ลองใหม่ได้ (test ใน Task 5 `issue: auth error → ISSUE_FAILED + needCreds`)
5. คืนเกินจำนวนที่เบิก / คืนซ้ำ → ปฏิเสธ 409 (test ใน Task 4 `returnableQty`, Task 8 `return over issued → 409`)

---

## Phase 0 — สำรวจ ATMS ส่วนที่เหลือ (ต้องขออนุญาตผู้ใช้ก่อนเขียน ATMS)

### Task 0: บันทึก HTML ตัวอย่างและพฤติกรรมที่ยังไม่รู้

**Files:**
- Create: `tests/fixtures/atms_withdraw/*.html` (api-ncac worktree) — `wd_add.html`, `wd_item_add.html`, `wd_view_empty.html`, `wd_view_items.html`, `wd_view_approved.html`, `wd_index.html`, `dd_add.html`, `dd_item_add.html`, `profile.html`, `mr_item_code.json`, `sku.json`, `serial.json`, `wd_code.json`
- Create: `docs/atms-withdraw-recon.md` (api-ncac) — ผลสำรวจ

- [ ] **Step 1:** GET อย่างเดียว (ใช้ login env ใน `~/Documents/project/task/1_Jan2026/ext_cost/.env`, 3 วินาทีต่อคำขอ): `/inv/deposit.item/add/good_movement_id/<dd>/inventory_id/4` ของ DD คืนของที่มีอยู่จริง (หาจาก `/inv/deposit/index` ที่มี "เบิก" อ้าง), `/inv/withdraw/index?inventory_id=4&from_created_at=<วันนี้>`, WD ที่อนุมัติแล้ว 1 ใบ + ที่มีรายการผูก MR 1 ใบ → เซฟเป็น fixture (ลบชื่อ-เบอร์โทรใน profile ออกก่อนเซฟ)
- [ ] **Step 2:** ขออนุญาตผู้ใช้ในแชต: "ขอเพิ่มรายการ 1 บรรทัด (SKU ราคาถูก จำนวน 1) ลงใบทดสอบ LBWD26102206 (id 560724) แล้วกดอนุมัติ จากนั้นทำใบรับคืนอ้างใบนี้ เพื่อดูว่าสต๊อกตัดตอนไหน — ใบทดสอบต้องยกเลิกเองใน ATMS หลังจบ" รอคำว่าใช่
- [ ] **Step 3:** หลังได้อนุญาต: POST item → จด `Location` ที่ได้, GET `/inv/withdraw/approve/id/560724` แบบ `allow_redirects=False` → จดว่ามีหน้า confirm/POST ต่อไหม, เปิด view ดูสถานะอนุมัติ + ปุ่มที่เปลี่ยน, เช็ก `/inv/stock.history` หรือ sku ว่ายอดลด · ทำ DD คืน → ดูฟิลด์ `deposit.item/add` + วิธีตั้ง `spare_part_returned`
- [ ] **Step 4:** เขียน `docs/atms-withdraw-recon.md`: URL + method + field ของทุกขั้น, รูปแบบ Location สำเร็จ, ข้อความ error ของฟอร์ม, คอลัมน์ของ `/inv/withdraw/index`, วิธีบอกว่าอนุมัติแล้วจาก view
- [ ] **Step 5:** Commit `git add tests/fixtures/atms_withdraw docs/atms-withdraw-recon.md && git commit -m "docs: ATMS withdraw/deposit recon + fixtures"`

ถ้า Step 3 พบว่าพฤติกรรมต่างจาก spec (เช่น approve ต้อง POST) ให้แก้ Interfaces ใน Task 1–2 ตามจริงก่อนเริ่ม และบอกผู้ใช้

---

## Phase 1 — api-ncac: ตัวยิง ATMS

### Task 1: `AtmsWithdrawClient` — อ่านหน้า / lookup / profile

**Files:**
- Create: `services/atms_withdraw_service.py`
- Test: `tests/atms/test_withdraw_read.py` (+ `tests/atms/__init__.py`)

**Interfaces:**
- Consumes: `AtmsClient`, `AtmsAuthError`, `AtmsOpenJobError`, `AtmsNotFoundError`, `_form_errors`, `_label_pairs` จาก `services/atms_openjob_service.py`
- Produces:
  - `class AtmsWithdrawClient(AtmsClient)` — ctor เดิม + `pace: float = 1.0` (หน่วงระหว่าง request เขียน)
  - `options() -> dict` = `{"inventories": [{"id": int, "name": str}], "pick_tos": [{"id": int, "name": str}]}` (จาก `/inv/withdraw/add`)
  - `lookup(kind: Literal["mr_item","sku","serial","wd"], q: str, limit: int = 20, inventory_id: int | None = None, sku_id: int | None = None) -> list[dict]` — คืน JSON ของ ATMS ตรง ๆ (`id`, `name`, + `code/inventory_id/has_serial_no` สำหรับ sku, `driver/mechanic` สำหรับ mr_item)
  - `profile() -> dict` = `{"username","email","name","branch","department","is_driver": bool,"is_mechanic": bool}`
  - `get_withdraw(gm_id: int) -> dict` = `{"id","code","inventory","pick_to","remark","user","created_at","approved": bool,"spare_part_returned": bool,"items":[{"sku_code","sku_name","amount": float,"mr_item": str|None}]}`
  - `list_withdraws(inventory_id: int, date_ddmmyyyy: str) -> list[dict]` = `[{"id","code","pick_to","user","remark","created_at","approved"}]` (ตั้ง rows-per-page 1000 ก่อน แล้วคืนค่าเดิมหลังดึง ตาม `pipeline_atms_supplier.py`)
  - `find_withdraw_by_remark(token: str, inventory_id: int, date_ddmmyyyy: str) -> list[int]`

- [ ] **Step 1: เขียนเทสต์ (session.request ถูก monkeypatch ให้คืน fixture จาก Task 0)**

```python
def test_options_parses_inventories_and_pick_tos(fake_client):
    o = fake_client.options()
    assert {"id": 4, "name": "คลังลาดกระบัง"} in o["inventories"]
    assert {"id": 45, "name": "CM-งานซ่อม"} in o["pick_tos"]

def test_get_withdraw_empty_view(fake_client):
    w = fake_client.get_withdraw(560724)
    assert w["code"] == "LBWD26102206" and w["approved"] is False and w["items"] == []

def test_get_withdraw_approved_has_items(fake_client):
    w = fake_client.get_withdraw(APPROVED_ID)   # id จาก fixture wd_view_approved.html
    assert w["approved"] is True and len(w["items"]) >= 1

def test_profile_fields(fake_client):
    p = fake_client.profile()
    assert p["username"] and p["email"].endswith("@menatransport.co.th")

def test_login_page_raises_auth_error(fake_client_login_page):
    with pytest.raises(AtmsAuthError):
        fake_client_login_page.get_withdraw(560724)

def test_find_withdraw_by_remark(fake_client):
    assert fake_client.find_withdraw_by_remark("SW-2610-001", 4, "31/10/2026") == [EXPECTED_ID]
```

- [ ] **Step 2:** `.venv/bin/pytest tests/atms/test_withdraw_read.py -v` → FAIL (import error)
- [ ] **Step 3:** เขียน `AtmsWithdrawClient` ใน `services/atms_withdraw_service.py` — parse ด้วย BeautifulSoup แบบ openjob (label `dt/dd` → `_label_pairs`)
- [ ] **Step 4:** pytest → PASS
- [ ] **Step 5:** Commit `feat(atms): withdraw client — options, lookup, profile, view, list`

### Task 2: ยิงใบเบิก / ใบคืน แบบทำต่อได้

**Files:**
- Modify: `services/atms_withdraw_service.py`
- Test: `tests/atms/test_withdraw_write.py`

**Interfaces:**
- Produces:
  - `@dataclass IssueLine(sku_id: int, amount: float, mr_item_id: int | None = None, serial_no_id: int | None = None, remark: str = "")`
  - `@dataclass IssueProgress(gm_id: int | None = None, done: list[int] = field(default_factory=list), approved: bool = False, code: str | None = None)` — `done` = index ของ line ที่ส่งแล้ว
  - `issue_withdraw(inventory_id: int, pick_to_id: int, remark_token: str, lines: list[IssueLine], progress: IssueProgress | None = None, remark: str = "", date_ddmmyyyy: str | None = None) -> IssueProgress` — ขั้นตอน: ถ้า `progress.gm_id` ว่าง → `find_withdraw_by_remark(remark_token, …)` ก่อน (เจอ 1 ใบ = ใช้ใบนั้น, เจอ >1 = raise `AtmsOpenJobError("พบหลายใบที่มีเลข …")`) → ไม่เจอค่อย POST หัวใบ (`remark` = `f"{remark_token} {remark}".strip()`) → ทุก line ที่ index ไม่อยู่ใน `done` POST แล้ว append → approve → `get_withdraw` ตรวจ `approved` และจำนวนบรรทัด = len(lines) → คืน progress ครบ
  - เมื่อพังกลางทาง raise `WithdrawPartialError(progress: IssueProgress, cause: Exception)` (subclass `AtmsOpenJobError`) — ผู้เรียกเก็บ `progress` ไว้ส่งกลับมาตอนลองใหม่
  - `return_to_stock(inventory_id: int, withdraw_id: int, remark_token: str, lines: list[ReturnLine], progress: IssueProgress | None = None, mark_complete: bool = False) -> IssueProgress` — DD `type=deposit`, `purchase_order_id=""`, `withdraw_id`; `ReturnLine` field ตามที่ Task 0 พบ; `mark_complete` = ตั้ง "คืนอะไหล่ครบแล้ว" ตามวิธีจาก Task 0
  - ทุก request เขียน: `time.sleep(self.pace)` ก่อนยิง · `self.dry_run` = ไม่ยิง คืน progress ปลอม `gm_id=0`

- [ ] **Step 1: เขียนเทสต์ (fake transport จดลำดับ request)**

```python
def test_issue_full_sequence(fake_writer):
    p = fake_writer.issue_withdraw(4, 45, "SW-2610-001", [IssueLine(6106, 2, 257041), IssueLine(133, 1)])
    assert p.gm_id == 560800 and p.done == [0, 1] and p.approved and p.code.startswith("LBWD")
    assert fake_writer.calls == ["GET index(remark)", "POST withdraw/add", "POST item", "POST item", "approve", "GET view"]

def test_resume_skips_done_lines(fake_writer):
    p = fake_writer.issue_withdraw(4, 45, "SW-2610-001", LINES3, progress=IssueProgress(gm_id=560800, done=[0]))
    assert [c for c in fake_writer.calls if c == "POST item"] == ["POST item", "POST item"]
    assert "POST withdraw/add" not in fake_writer.calls

def test_issue_without_gm_id_searches_remark_first(fake_writer_existing):   # index มีใบ remark SW-2610-001 อยู่แล้ว
    p = fake_writer_existing.issue_withdraw(4, 45, "SW-2610-001", LINES2)
    assert "POST withdraw/add" not in fake_writer_existing.calls and p.gm_id == EXISTING_ID

def test_failure_mid_lines_returns_progress(fake_writer_fail_on_2nd_item):
    with pytest.raises(WithdrawPartialError) as e:
        fake_writer_fail_on_2nd_item.issue_withdraw(4, 45, "SW-2610-001", LINES3)
    assert e.value.progress.gm_id == 560800 and e.value.progress.done == [0]

def test_approve_not_confirmed_raises(fake_writer_view_unapproved):
    with pytest.raises(WithdrawPartialError):
        fake_writer_view_unapproved.issue_withdraw(4, 45, "SW-2610-001", LINES2)

def test_dry_run_makes_no_post(fake_writer):
    fake_writer.dry_run = True
    fake_writer.issue_withdraw(4, 45, "SW-2610-001", LINES2)
    assert not any(c.startswith("POST") for c in fake_writer.calls)

def test_return_to_stock_sequence(fake_writer):
    p = fake_writer.return_to_stock(4, 560800, "SW-2610-001-R1", [RETURN_LINE], mark_complete=True)
    assert p.approved and "POST deposit/add" in fake_writer.calls
```

- [ ] **Step 2:** pytest → FAIL
- [ ] **Step 3:** เขียนตาม Interfaces (ไม่มี retry อัตโนมัติสำหรับ POST — POST ซ้ำ = บรรทัดซ้ำ; retry ได้เฉพาะ GET)
- [ ] **Step 4:** pytest → PASS
- [ ] **Step 5:** Commit `feat(atms): resumable issue_withdraw + return_to_stock`

### Task 3: routes `/atms/withdraw/*`

**Files:**
- Create: `routes/atms/withdraw.py`
- Modify: `main.py` (include router หลัง `atms_openjob_router`)
- Test: `tests/atms/test_withdraw_routes.py`

**Interfaces:**
- ทุก route ต้องมี header `x-api-key` = env `PIPELINE_API_KEY` (dependency `require_api_key`; ไม่มี/ผิด = 401) และ auth ATMS แบบใดแบบหนึ่ง: `X-ATMS-Username` + `X-ATMS-Password` (สร้าง client ด้วย username/password → login เอง + relogin ได้) หรือ `X-PHPSESSID` · ห้ามใช้ env login
- แคช client ต่อ username ในหน่วยความจำ 20 นาที (dict + lock) เพื่อไม่ login ทุกคำขอ · lock ต่อ username ให้ยิงเขียนได้ทีละงาน
- Endpoints (JSON):
  - `GET  /atms/withdraw/options` → `options()`
  - `GET  /atms/withdraw/lookup/{kind}?q=&limit=&inventory_id=&sku_id=` → `{"results": [...]}`
  - `GET  /atms/withdraw/whoami` → `profile()`
  - `GET  /atms/withdraw/{gm_id}` → `get_withdraw`
  - `GET  /atms/withdraw/list?inventory_id=&date=DD/MM/YYYY` → `{"rows": [...]}`
  - `POST /atms/withdraw/issue` body `{inventory_id, pick_to_id, remark_token, remark, lines:[IssueLine], progress?: IssueProgress, dry_run?: bool}` → `200 {"progress": IssueProgress}` · partial → `409 {"detail": msg, "progress": IssueProgress}` · auth → `401` · อื่น → `422`
  - `POST /atms/withdraw/return` body `{inventory_id, withdraw_id, remark_token, lines, progress?, mark_complete, dry_run?}` → เหมือน issue

- [ ] **Step 1: เทสต์ด้วย `fastapi.testclient` + monkeypatch `AtmsWithdrawClient`**

```python
def test_missing_api_key_401(client): assert client.get("/atms/withdraw/options").status_code == 401
def test_no_atms_creds_401(client): assert client.get("/atms/withdraw/options", headers=KEY).status_code == 401
def test_issue_partial_returns_409_with_progress(client, partial_client):
    r = client.post("/atms/withdraw/issue", headers=KEY | CREDS, json=ISSUE_BODY)
    assert r.status_code == 409 and r.json()["progress"]["gm_id"] == 560800
def test_issue_ok(client, ok_client):
    assert client.post("/atms/withdraw/issue", headers=KEY | CREDS, json=ISSUE_BODY).json()["progress"]["approved"] is True
```

- [ ] **Step 2:** pytest → FAIL · **Step 3:** เขียน router · **Step 4:** pytest ทั้งโฟลเดอร์ `tests/atms` → PASS
- [ ] **Step 5:** รัน local `uvicorn main:app` แล้ว `curl` `/atms/withdraw/options` + `/lookup/sku?q=กรอง&inventory_id=4` + `/issue` ด้วย `dry_run: true` ของจริง → ได้ข้อมูล/ไม่มี POST
- [ ] **Step 6:** Commit `feat(atms): /atms/withdraw routes (api-key + per-user ATMS creds)`

---

## Phase 2 — WMS: ข้อมูล สถานะ API

### Task 4: แกนตรรกะล้วน `lib/store-withdraw/core.ts`

**Files:**
- Create: `lib/store-withdraw/types.ts`, `lib/store-withdraw/core.ts`, `lib/store-withdraw/crypto.ts`
- Test: `scripts/check-store-withdraw-core.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type SwKind = "stock" | "cutoff"`
  - `type SwStatus = "NEW"|"PREPARING"|"READY"|"ISSUING"|"ISSUED"|"ISSUE_FAILED"|"RECEIVED"|"REJECTED"|"CANCELLED"`
  - `type SwLine = { skuId: number; skuCode: string; skuName: string; requestedQty: number; issuedQty: number | null; short: boolean; returnedQty: number; mrItemId: number | null; mrItemLabel: string | null; serialNoId: number | null; remark: string }`
  - `type SwReturnStatus = "RETURN_REQUESTED"|"RETURNING"|"RETURNED"|"RETURN_FAILED"`
  - `type SwReturn = { rid: string; status: SwReturnStatus; lines: { lineIndex: number; qty: number }[]; requestedBy: string; acceptedBy: string | null; atms: AtmsProgress; createdAt: Date }`
  - `type AtmsProgress = { gmId: number | null; done: number[]; approved: boolean; code: string | null; error: string | null; needCreds: boolean; lastCheckAt: Date | null; drift: string | null }`
  - `type SwRequest = { _id?; no: string; kind: SwKind; status: SwStatus; inventoryId: number; inventoryName: string; pickToId: number; pickToName: string; plate: string; mrCode: string | null; urgent: boolean; remark: string; lines: SwLine[]; requestedBy: { email: string; name: string; via: "web"|"api" }; claimedBy: { email: string; name: string } | null; rejectReason: string | null; atms: AtmsProgress; returns: SwReturn[]; createdAt: Date; updatedAt: Date }`
  - `type SwAction = "claim"|"ready"|"issue"|"issued"|"issueFailed"|"receive"|"reject"|"cancel"`
- Produces (`core.ts`):
  - `nextStatus(req: Pick<SwRequest,"status"|"kind">, action: SwAction): SwStatus | null` — ตาราง: NEW+claim→PREPARING, PREPARING+ready→READY, READY+issue→ISSUING, (kind cutoff) NEW+issue→ISSUING, ISSUE_FAILED+issue→ISSUING, ISSUING+issued→ISSUED, ISSUING+issueFailed→ISSUE_FAILED, ISSUED+receive→RECEIVED (stock เท่านั้น), NEW|PREPARING|READY+reject→REJECTED, NEW+cancel→CANCELLED, อื่น = null
  - `queueSort(a: SwRequest[]): SwRequest[]` — urgent ก่อน แล้ว createdAt เก่าก่อน
  - `issueLines(lines: SwLine[]): { index: number; line: SwLine }[]` — เฉพาะ `(issuedQty ?? requestedQty) > 0`
  - `validateLineEdit(line: SwLine, issuedQty: number): string | null` — `<0` หรือ `> requestedQty` = ข้อความ error ไทย
  - `returnableQty(line: SwLine, pending: number): number` = `issuedQty − returnedQty − pending` (ไม่ต่ำกว่า 0)
  - `formatNo(yymm: string, seq: number): string` → `"SW-2610-012"`
  - `waitMinutes(createdAt: Date, now: Date): number`
- Produces (`crypto.ts`): `encryptSecret(plain: string): string` (`v1:<iv b64>:<tag b64>:<ct b64>`), `decryptSecret(token: string): string` — key `STORE_ATMS_CRED_KEY`; ไม่มี key = throw `"ยังไม่ได้ตั้ง STORE_ATMS_CRED_KEY"`

- [ ] **Step 1: เขียน `scripts/check-store-withdraw-core.ts` (assert แบบ check-price-compare-core.ts)**

```ts
eq(nextStatus({ status: "NEW", kind: "stock" }, "issue"), null)            // stock ต้องผ่านจัดของ
eq(nextStatus({ status: "NEW", kind: "cutoff" }, "issue"), "ISSUING")       // ตัดยอดข้ามได้
eq(nextStatus({ status: "ISSUE_FAILED", kind: "stock" }, "issue"), "ISSUING")
eq(nextStatus({ status: "PREPARING", kind: "stock" }, "cancel"), null)
eq(nextStatus({ status: "ISSUED", kind: "cutoff" }, "receive"), null)
eq(queueSort([r("a", false, "10:00"), r("b", true, "10:30"), r("c", false, "09:00")]).map(x => x.no), ["b", "c", "a"])
eq(validateLineEdit(line({ requestedQty: 2 }), 3), "จ่ายได้ไม่เกินที่ขอ (2)")
eq(returnableQty(line({ issuedQty: 4, returnedQty: 1 }), 2), 1)
eq(formatNo("2610", 12), "SW-2610-012")
eq(decryptSecret(encryptSecret("pw-ทดสอบ")), "pw-ทดสอบ")
ok(encryptSecret("x") !== encryptSecret("x"))                                // iv สุ่ม
```

- [ ] **Step 2:** `STORE_ATMS_CRED_KEY=$(openssl rand -base64 32) npx tsx scripts/check-store-withdraw-core.ts` → FAIL
- [ ] **Step 3:** เขียน 3 ไฟล์ (crypto ใช้ `node:crypto` `createCipheriv("aes-256-gcm")`)
- [ ] **Step 4:** รันซ้ำ → `all passed`
- [ ] **Step 5:** Commit `feat(store-withdraw): types + state machine + queue sort + cred crypto`

### Task 5: DB + ตัวส่ง ATMS `lib/store-withdraw/db.ts`, `ncac.ts`, `issue.ts`

**Files:**
- Create: `lib/store-withdraw/db.ts`, `lib/store-withdraw/ncac.ts`, `lib/store-withdraw/issue.ts`, `lib/store-withdraw/creds.ts`
- Test: `scripts/check-store-withdraw-issue.ts` (ใช้ Mongo ชั่วคราว: db `master_data_test_sw` บน `MONGO_URI` เดิม ลบทิ้งท้ายเทสต์ — ห้ามแตะ `master_data`)

**Interfaces:**
- `db.ts`: `swCol()` (`store_withdraw_requests`, unique index `no`, index `{inventoryId:1,status:1,createdAt:1}`), `swLogCol()` (`store_withdraw_log`), `credCol()` (`store_atms_creds`, unique `email`), `atmsCacheCol()` (`store_withdraw_atms_cache`, TTL 3 นาทีบน `fetchedAt`)
  - `nextNo(now: Date): Promise<string>` — `counters` `findOneAndUpdate({_id:"store_withdraw:YYMM"},{$inc:{seq:1}},{upsert:true,returnDocument:"after"})`
  - `transition(no: string, action: SwAction, actor: {email;name;via}, patch?: Partial<SwRequest>): Promise<SwRequest>` — อ่าน → `nextStatus` → `findOneAndUpdate({no, status: เดิม}, …)` ไม่เจอ = throw `ConflictError("สถานะเปลี่ยนไปแล้ว ลองรีเฟรช")` → เขียน log
- `creds.ts`: `saveCreds(email, username, password, profile)` (เข้ารหัส password), `getCreds(email): Promise<{username; password} | null>`, `deleteCreds(email)`, `credStatus(email): Promise<{linked: boolean; atmsUsername?: string; branch?: string}>`
- `ncac.ts`: `ncac<T>(method, path, opts: { creds?: {username;password}; body?; query? }): Promise<{ status: number; data: T }>` — base `NCAC_BASE`, header `x-api-key: NCAC_API_KEY`, `X-ATMS-Username/Password`, timeout 90 วินาที
- `issue.ts`: `issueRequest(no: string, actor): Promise<SwRequest>` — `transition(…,"issue")` (กันซ้ำ) → `getCreds(actor.email)` ไม่มี = `issueFailed` + `needCreds:true` → `ncac POST /atms/withdraw/issue` ด้วย `remark_token = no`, `progress = req.atms` → 200 = `issued` + เก็บ progress/code · 409 = `issueFailed` + เก็บ progress จาก body · 401 = `issueFailed` + `needCreds:true` · อื่น = `issueFailed` + error · `acceptReturn(no, rid, actor)` แบบเดียวกันกับ `/atms/withdraw/return` (`remark_token = ${no}-${rid}`, `mark_complete` เมื่อคืนครบทุกบรรทัด)

- [ ] **Step 1: เทสต์ (stub `ncac` ผ่าน `globalThis.fetch`)**

```ts
// issue: concurrent calls → one ATMS call
await Promise.all([issueRequest(no, store), issueRequest(no, store)]).catch(() => {})
eq(fetchCalls("/atms/withdraw/issue"), 1)
// issue: retry passes saved progress
stub409({ gm_id: 560800, done: [0] }); await issueRequest(no2, store).catch(() => {})
stub200(); await issueRequest(no2, store)
eq(lastBody("/atms/withdraw/issue").progress, { gm_id: 560800, done: [0], approved: false, code: null })
// issue: auth error → ISSUE_FAILED + needCreds
stub401(); const r = await issueRequest(no3, store).catch(e => e); eq((await get(no3)).status, "ISSUE_FAILED"); eq((await get(no3)).atms.needCreds, true)
// stock request cannot issue from NEW
eq(await issueRequest(newStockNo, store).catch(e => e.name), "ConflictError")
// nextNo increments per month
eq(await nextNo(new Date("2026-10-31")), "SW-2610-001"); eq(await nextNo(new Date("2026-10-31")), "SW-2610-002")
```

- [ ] **Step 2:** รัน → FAIL · **Step 3:** เขียน · **Step 4:** รัน → PASS (และ db เทสต์ถูกลบ)
- [ ] **Step 5:** Commit `feat(store-withdraw): mongo store, ATMS creds, resumable issue via api-ncac`

### Task 6: สิทธิ์ + API routes

**Files:**
- Modify: `lib/access-policy.ts` — เพิ่ม section `"store-withdraw"` (ผู้ขอ) และ `"store-queue"` (สโตร์) ใน `SECTIONS` + `SECTION_LABELS` (`"เบิกอะไหล่ (ยื่นคำขอ)"`, `"คิวงานสโตร์"`), `VEHICLE` ได้ `"store-withdraw": "edit"`, `IT` ได้ทั้งคู่ (มีอยู่แล้วผ่าน `all`), section อื่น `none`; สโตร์ให้ผ่าน overrides รายคนที่ `/admin/users` · PAGE/API prefixes: `/store-withdraw/queue` + `/api/store-withdraw/queue`, `/api/store-withdraw/:no/claim|lines|ready|issue|reject|returns/:rid/accept`, `/api/store-withdraw/atms-link` → `store-queue`; ที่เหลือใต้ `/store-withdraw`, `/api/store-withdraw` → `store-withdraw`
- Modify: `middleware.ts` — ให้ `/api/store-withdraw` (ยกเว้น issue / accept / claim / lines / ready / reject / atms-link) เรียกด้วย `x-api-key` = env `STORE_WITHDRAW_API_KEYS` (คั่นด้วย comma) + header `x-user` (อีเมล) ได้
- Create: `app/api/store-withdraw/route.ts` (GET list: `?mine=1` | `?inv=&status=`, POST create), `app/api/store-withdraw/[no]/route.ts` (GET detail+log), `…/[no]/{cancel,claim,ready,issue,reject,receive}/route.ts`, `…/[no]/lines/route.ts` (PATCH), `…/[no]/returns/route.ts` (POST), `…/[no]/returns/[rid]/accept/route.ts`, `app/api/store-withdraw/lookup/[kind]/route.ts`, `app/api/store-withdraw/lookup/cutoff/route.ts` (GET `?mr=<MR code>&inv=` → `{ lines: [{ skuId, skuCode, skuName, qty, ddCode }] }` อ่านสำเนา Mongo `atms` อย่างเดียว: PR ที่ `หมายเหตุ`/item note ขึ้นต้น `1.<MR>` → PO → `deposit_header.purchase_order` ของคลังนั้น; กรองด้วย MR code ตรง ห้าม scan ทั้ง collection (สกิล mongo-safe); DD มีเฉพาะ 2026+ ไม่เจอ = คืน `[]`), `app/api/store-withdraw/options/route.ts`, `app/api/store-withdraw/atms-link/route.ts` (GET status, POST link `{username,password}` → api-ncac `whoami` → อีเมลต้องตรง session → `saveCreds`; DELETE unlink), `app/api/store-withdraw/queue/route.ts` (GET `?inv=` → `{ columns: {NEW,PREPARING,READY,DONE_TODAY}, atmsKeyed: [...] }`)
- Modify: `scripts/check-access-policy.ts` — เพิ่ม assert section ใหม่
- Test: `scripts/check-store-withdraw-api.sh` (แบบ `check-price-compare-api.sh`: dev server + `scripts/mint-session-token.ts`)

**Interfaces:**
- POST create body: `{ kind, inventoryId, pickToId, plate, mrCode?, urgent?, remark?, lines: [{ skuId, requestedQty, mrItemId?, serialNoId?, remark? }] }` → `201 { no }` · validate: lines ≥ 1, qty > 0, skuId ซ้ำในใบเดียว = รวมให้, pickTo/inventory ต้องอยู่ใน options
- PATCH lines body: `{ lines: [{ index, issuedQty, short }] }` ใช้ `validateLineEdit`
- POST returns body: `{ lines: [{ lineIndex, qty }] }` → 409 ถ้าเกิน `returnableQty`
- Error ทุกตัวเป็น `{ error: "<ข้อความไทยสั้น บอกว่าทำอะไรต่อ>" }`

- [ ] **Step 1:** เพิ่ม assert ใน `check-access-policy.ts` (`VEHICLE` → `store-withdraw: edit`, `store-queue: none`; `/api/store-withdraw/X/issue` → `store-queue`) + เขียน `check-store-withdraw-api.sh`: create → claim → lines → ready → issue (ncac ชี้ไป mock server ใน script ที่ตอบ 200) → receive → returns → accept; cancel หลัง claim = 409; return over issued → 409; x-api-key POST issue = 401/403; x-api-key POST create = 201
- [ ] **Step 2:** รัน → FAIL · **Step 3:** เขียน · **Step 4:** `npx tsx scripts/check-access-policy.ts && bash scripts/check-store-withdraw-api.sh` → PASS · `npx tsc --noEmit` ผ่าน
- [ ] **Step 5:** Commit `feat(store-withdraw): access sections + REST API`

---

## Phase 3 — หน้าจอ

### Task 7: หน้าผู้ขอเบิก `/store-withdraw`

**Files:**
- Create: `app/store-withdraw/page.tsx` (รายการคำขอของฉัน + ปุ่ม "ขอเบิกใหม่"), `app/store-withdraw/new/page.tsx`, `components/store-withdraw/request-form.tsx`, `components/store-withdraw/status-chip.tsx`, `components/store-withdraw/sku-picker.tsx` (ค้นผ่าน `/api/store-withdraw/lookup/sku` debounce 300ms ยิงตอนหยุดพิมพ์ โชว์ `stockQty` จาก `atms_sku_master`), `components/store-withdraw/mr-picker.tsx`
- Modify: เมนูหลัก (ไฟล์ nav เดิมของโปรเจกต์) เพิ่ม "เบิกอะไหล่"

- [ ] **Step 1:** ทำฟอร์ม: ประเภท (เบิกจากสต๊อก / เบิกตัดยอด), คลัง (ค่าเริ่มต้น ลาดกระบัง), จุดประสงค์, ทะเบียน, MR (ค้นแล้วเลือก MR item → ใส่ทั้งใบหรือรายบรรทัด), ป้าย "รถจอดรออะไหล่", รายการ SKU + จำนวน, หมายเหตุ
- [ ] **Step 1b:** ประเภท "เบิกตัดยอด" + เลือก MR แล้ว → เรียก `/lookup/cutoff` เติมรายการจาก DD ให้ แก้/ลบได้ · ไม่เจอ = ข้อความ "ยังไม่เจอใบรับของ MR นี้ ใส่รายการเองได้"
- [ ] **Step 2:** รายการของฉัน: poll 10 วินาที, ชิปสถานะ, ปุ่ม ยกเลิก (NEW) / รับแล้ว (ISSUED, stock) / ขอคืน (ISSUED|RECEIVED) + กล่องเลือกจำนวนคืน
- [ ] **Step 3:** เช็กในเบราว์เซอร์ (dev + mock ncac) บนจอกว้าง 390px และ 1280px: ยื่น → เห็นในรายการ → ยกเลิกได้ → ข้อความ error ภาษาไทย
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` ผ่าน · Commit `feat(store-withdraw): requester pages`

### Task 8: จอคิวสโตร์ `/store-withdraw/queue` + ผูกบัญชี ATMS

**Files:**
- Create: `app/store-withdraw/queue/page.tsx`, `components/store-withdraw/queue-board.tsx`, `components/store-withdraw/ticket-card.tsx`, `components/store-withdraw/prepare-dialog.tsx` (ติ๊กรายการ แก้ issuedQty ทำเครื่องหมายของขาด อ่านสต๊อกสดผ่าน `lib/atms-sku-live.ts`), `components/store-withdraw/atms-link-dialog.tsx`, `public/sounds/new-ticket.mp3` (เสียงสั้น ไม่มีลิขสิทธิ์ หรือ WebAudio beep)
- Modify: `lib/store-withdraw/db.ts` — `listAtmsKeyed(inventoryId, now)` ใช้ cache collection 3 นาที → ncac `/atms/withdraw/list` ด้วย creds ของสโตร์คนที่เปิดจอ, ตัดใบที่ `atms.gmId` ตรงกับคำขอใน WMS

- [ ] **Step 1:** ยังไม่ผูก ATMS → ขึ้นกล่องผูกบัญชีก่อน (username/password ATMS, บอกว่าเก็บแบบเข้ารหัส, ปุ่มเลิกผูกในเมนูจอ)
- [ ] **Step 2:** 4 ช่อง ใหม่ / กำลังจัด / พร้อมส่ง / ส่งแล้ววันนี้ · ใบคืนสีม่วง · ใบ urgent แถบแดง · เวลารอ > 30 นาทีเป็นสีเตือน · การ์ด "คีย์ใน ATMS" สีเทา อ่านอย่างเดียว · poll 10 วินาที · เสียงเมื่อมีใบใหม่ (ปุ่มเปิดเสียงครั้งแรก เพราะ browser บล็อก autoplay)
- [ ] **Step 3:** ปุ่ม: รับงาน → กำลังจัด · จัดครบ (prepare dialog) · ส่งของ / ตัดยอด (ใบ cutoff ปุ่มอยู่ในช่องใหม่) → spinner ระหว่างส่ง → ได้เลข WD บนการ์ด · ISSUE_FAILED = การ์ดขอบแดง ข้อความ + ปุ่มลองใหม่ (needCreds → เปิดกล่องผูกบัญชี) · ปฏิเสธ (บังคับเหตุผล) · รับคืน
- [ ] **Step 4:** เช็กในเบราว์เซอร์กับ mock ncac: สองแท็บกดส่งพร้อมกัน → ได้ ISSUED ใบเดียว อีกแท็บขึ้น toast "สถานะเปลี่ยนไปแล้ว" · บนแท็บเล็ต 768px ใช้ได้
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint` · Commit `feat(store-withdraw): kitchen-style store queue + ATMS account link`

---

## Phase 4 — ซิงก์กลับ + คู่มือ API

### Task 9: ตรวจใบที่ WMS สร้างกับ ATMS + หน้าคู่มือ API

**Files:**
- Create: `lib/store-withdraw/drift.ts` — `checkDrift(no): Promise<SwRequest>` เรียก ncac `GET /atms/withdraw/{gmId}` เทียบ `approved` + จำนวนบรรทัด + amount ต่อ SKU → ต่างกัน = เซ็ต `atms.drift` (ข้อความไทย) ไม่แก้ข้อมูลอื่น · 404 = drift "ใบถูกลบใน ATMS"
- Create: `app/api/store-withdraw/[no]/check/route.ts` (POST, สโตร์), `app/api/store-withdraw/drift-tick/route.ts` (POST, `x-api-key` เท่านั้น: ตรวจใบ ISSUED/RECEIVED อายุ ≤ 7 วัน ทีละใบ ห่าง 1 วินาที สูงสุด 40 ใบต่อรอบ ใช้ creds ของสโตร์ผู้ส่งใบนั้น)
- Create (api-ncac): `scripts/pipeline/store_withdraw_drift.py` + ลงทะเบียนใน pipeline registry ให้ `POST /pipeline/run/store-withdraw-drift` เรียก WMS `drift-tick` ทุก 30 นาที 07:00–20:00 (ตามกลไก schedule เดิมของ api-ncac)
- Create: `app/store-withdraw/api-guide/page.tsx` (แบบ `/repair-external/api-guide`: header, ตัวอย่าง curl ทุก endpoint ฝั่งผู้ขอ, รหัส error)
- Modify: `components/store-withdraw/ticket-card.tsx` — ธง "ATMS ถูกแก้" + ข้อความ drift · เปิดดูรายละเอียดใบ = เรียก `/check`
- Test: `scripts/check-store-withdraw-drift.ts` (stub ncac: approved→unapproved, บรรทัดหาย, 404)

- [ ] **Step 1:** เทสต์ 3 เคส drift + เคสตรงกัน (drift = null) → FAIL · **Step 2:** เขียน → PASS
- [ ] **Step 3:** pytest api-ncac `tests/test_pipeline_registry.py` ผ่าน (มีชื่อใหม่)
- [ ] **Step 4:** Commit ทั้งสอง repo `feat(store-withdraw): ATMS drift check + API guide`

---

## Phase 5 — ทดสอบจริงที่ลาดกระบัง

### Task 10: end-to-end กับ ATMS จริง (ต้องได้อนุญาตผู้ใช้ทุกครั้งที่เขียน ATMS)

- [ ] **Step 1:** deploy api-ncac branch เป็น preview หรือรัน local + ngrok ตามที่ผู้ใช้เลือก (ห้ามแก้ Render settings เอง — เขียนขั้นตอนให้ผู้ใช้ทำ) · WMS รัน dev ชี้ไป api-ncac นั้น · ตั้ง env `STORE_ATMS_CRED_KEY`, `STORE_WITHDRAW_API_KEYS`, `PIPELINE_API_KEY`
- [ ] **Step 2:** ขออนุญาตผู้ใช้ แล้วทำ 1 ใบ stock (1 SKU ราคาถูก จำนวน 1) ด้วยบัญชี ATMS ของสโตร์ลาดกระบังที่ผู้ใช้นัดไว้ → เปิด ATMS ตรวจ: ผู้ใช้งาน = สโตร์คนนั้น, remark มี SW-…, บรรทัดผูก MR item, อนุมัติแล้ว, สต๊อกลด
- [ ] **Step 3:** คืน 1 ชิ้น → ตรวจ DD อ้าง WD + สต๊อกกลับ + คืนครบ
- [ ] **Step 4:** ทดสอบ kill เน็ตกลางการส่ง (หยุด api-ncac หลังหัวใบ) → ลองใหม่ → ใบเดียว
- [ ] **Step 5:** สรุปผล + รายการใบทดสอบที่ต้องยกเลิกใน ATMS ให้ผู้ใช้ · แก้บั๊กที่เจอ (TDD) · Commit

### Task 11: ขึ้นระบบ + นำร่อง

- [ ] **Step 1:** ถามผู้ใช้ก่อน push ทั้งสอง repo (สกิล ship-it) · env บน Vercel/Render ผู้ใช้เป็นคนตั้ง (เขียนรายการให้)
- [ ] **Step 2:** ตั้งสิทธิ์ `store-queue` ให้สโตร์ลาดกระบังที่ `/admin/users` (ผู้ใช้ส่งรายชื่อ)
- [ ] **Step 3:** นำร่อง 2 สัปดาห์คู่กับกระดาษ · ทุกเย็นเทียบรายการ SW ↔ WD ใน ATMS (สคริปต์ `scripts/report-store-withdraw-daily.ts` อ่านอย่างเดียว)
- [ ] **Step 4:** ประกาศอัปเดตระบบแบบ PO (สกิล humanizer) + คลิปสอนสั้น (สกิล thai-guide-video ถ้าผู้ใช้ต้องการ)

---

## ประมาณเวลา (วันทำงาน เริ่ม จ. 2 พ.ย. 2026)

| Phase | งาน | วัน | เสร็จประมาณ |
|---|---|---|---|
| 0 | สำรวจ ATMS ส่วนที่เหลือ (รออนุญาตเขียนใบทดสอบ) | 0.5 | 2 พ.ย. |
| 1 | api-ncac ตัวยิง ATMS (Task 1–3) | 2 | 4 พ.ย. |
| 2 | WMS แกน + DB + API (Task 4–6) | 3 | 9 พ.ย. |
| 3 | หน้าผู้ขอ + จอคิวสโตร์ (Task 7–8) | 4 | 13 พ.ย. |
| 4 | ซิงก์กลับ + คู่มือ API (Task 9) | 1.5 | 17 พ.ย. |
| 5 | ทดสอบจริงลาดกระบัง + แก้ (Task 10) | 1.5 | 18 พ.ย. |
| — | ขึ้นระบบ (Task 11 Step 1–2) | 0.5 | 19 พ.ย. |
| — | นำร่องคู่กระดาษ 2 สัปดาห์ | 10 | 3 ธ.ค. |

สมมติฐาน: ทำต่อเนื่องทุกวันทำงาน · ผู้ใช้ตอบอนุญาตเขียน ATMS ได้ภายในวัน · มีสโตร์ลาดกระบัง 1 คนว่างช่วยทดสอบ Task 10 · ไม่รวมงาน Safety Stock / อะไหล่ลงคัน (พักไว้)
