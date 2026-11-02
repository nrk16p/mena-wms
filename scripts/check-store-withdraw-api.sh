#!/usr/bin/env bash
# scripts/check-store-withdraw-api.sh — รัน: bash scripts/check-store-withdraw-api.sh
# เปิดเอง: Mongo ในเครื่อง (mongodb-memory-server) + api-ncac จำลอง + next dev (พอร์ต 3123) · ไม่แตะ DB/ATMS จริง
set -u
cd "$(dirname "$0")/.."
PORT=3123
B=http://localhost:$PORT/api/store-withdraw
TMP=$(mktemp -d)
MADE_ENV=0
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  sleep 1
  [ "$MADE_ENV" = 1 ] && rm -f .env
  rm -rf "$TMP"
}
trap cleanup EXIT

FAILS=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; FAILS=$((FAILS+1)); }
code() { # code <expected> <label> <curl args...>
  local want=$1 label=$2; shift 2
  local got; got=$(curl -s -o "$TMP/last.json" -w "%{http_code}" "$@")
  if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label: want $want got $got $(head -c 200 "$TMP/last.json")"; fi
}
jget() { python3 -c "import json,sys; d=json.load(open('$TMP/last.json')); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
expect() { # expect <label> <python-expr over d>
  if [ "$(jget "$2")" = "True" ]; then ok "$1"; else bad "$1: $(head -c 300 "$TMP/last.json")"; fi
}

# ── .env ชั่วคราว (mint-session-token.ts อ่านจากไฟล์นี้ · ลบตอนจบ) ──
SECRET=testsecret-store-withdraw-0123456789
if [ ! -f .env ]; then
  printf 'NEXTAUTH_URL=http://localhost:%s\nNEXTAUTH_SECRET=%s\n' "$PORT" "$SECRET" > .env
  MADE_ENV=1
else
  SECRET=$(grep '^NEXTAUTH_SECRET=' .env | cut -d= -f2- | tr -d '"')
fi

echo "== เปิด Mongo ในเครื่อง + api-ncac จำลอง"
echo '{}' > "$TMP/ctl.json"
NCAC_EXPECT_KEY=k-test npx tsx scripts/store-withdraw-test-infra.ts "$TMP/infra.json" "$TMP/ncac-calls.log" "$TMP/ctl.json" > "$TMP/infra.out" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do [ -f "$TMP/infra.json" ] && break; sleep 1; done
[ -f "$TMP/infra.json" ] || { echo "infra ไม่ขึ้น"; cat "$TMP/infra.out"; exit 1; }
MONGO_URI=$(python3 -c "import json;print(json.load(open('$TMP/infra.json'))['mongoUri'])")
NCAC_BASE=$(python3 -c "import json;print(json.load(open('$TMP/infra.json'))['ncacBase'])")

echo "== เปิด next dev :$PORT"
MONGO_URI="$MONGO_URI" MONGO_DB=master_data STORE_WITHDRAW_DB=sw_api_test NCAC_BASE="$NCAC_BASE" NCAC_API_KEY=k-test \
  ATMS_LOOKUP_USERNAME=svc ATMS_LOOKUP_PASSWORD=svcpw STORE_ATMS_CRED_KEY=$(python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())") \
  STORE_WITHDRAW_API_KEYS="key-one,key-two" STORE_WITHDRAW_TICK_KEY="tick-key-1" NEXTAUTH_URL="http://localhost:$PORT" NEXTAUTH_SECRET="$SECRET" \
  npx next dev -p $PORT > "$TMP/dev.out" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 90); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done

REQ_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"req1@menatransport.co.th","name":"ผู้ขอ","employee":{"username":"req1","department":"ยานยนต์","position":"ช่าง"}}' | tail -1)
REQ2_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"req2@menatransport.co.th","name":"ผู้ขออีกคน","employee":{"username":"req2","department":"ยานยนต์","position":"ช่าง"}}' | tail -1)
# accessAt = เพิ่งรีเฟรชสิทธิ์ → route ไม่ไปอ่าน override จาก DB ทับ (ในระบบจริง token มี accessAt หลัง login เสมอ)
NOW_MS=$(python3 -c "import time;print(int(time.time()*1000))")
AUDIT_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"auditor@menatransport.co.th","name":"ผู้ตรวจสอบ","employee":{"username":"auditor","department":"Accounting","position":"บัญชี"},"accessOverrides":{"store-audit":"view"},"accessAt":'$NOW_MS'}' | tail -1)
VIEW_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"viewer@menatransport.co.th","name":"ดูอย่างเดียว","employee":{"username":"viewer","department":"Store","position":"สโตร์"},"accessOverrides":{"store-queue":"view"},"accessAt":'$NOW_MS'}' | tail -1)
STORE_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"store1@menatransport.co.th","name":"สโตร์ 1","employee":{"username":"store1","department":"Store","position":"สโตร์"},"accessOverrides":{"store-queue":"edit"},"accessAt":'$NOW_MS'}' | tail -1)
R="Cookie: next-auth.session-token=$REQ_TOKEN"
R2="Cookie: next-auth.session-token=$REQ2_TOKEN"
S="Cookie: next-auth.session-token=$STORE_TOKEN"
V="Cookie: next-auth.session-token=$VIEW_TOKEN"
AU="Cookie: next-auth.session-token=$AUDIT_TOKEN"
J="Content-Type: application/json"

echo "== สิทธิ์"
code 401 "ไม่มี session" "$B"
code 403 "ผู้ขอเข้าคิวสโตร์ไม่ได้" -H "$R" "$B/queue?inv=4"
code 403 "ผู้ขอ claim ไม่ได้" -H "$R" -X POST "$B/SW-0000-001/claim"

code 200 "viewer เห็นตัวเลือกได้" -H "$V" "$B/options"
code 403 "view-only เข้าคิวไม่ได้ (route เช็กซ้ำ)" -H "$V" "$B/queue?inv=4"
code 403 "view-only claim ไม่ได้" -H "$V" -X POST "$B/SW-0000-001/claim"
code 403 "view-only live-stock ไม่ได้" -H "$V" "$B/live-stock?inv=4&items=OIL-001:501"

echo "== options / lookup"
code 200 "options" -H "$R" "$B/options"
expect "options มีคลัง+จุดประสงค์" "d['inventories'][0]['id']==4 and d['pickTos'][0]['id']==7"
code 200 "lookup sku" -H "$R" "$B/lookup/sku?q=oil&inv=4"
expect "sku รวมสต๊อก (501=12, 599=null)" "[x['stockQty'] for x in d['results']]==[12,None]"
code 200 "lookup mr" -H "$R" "$B/lookup/mr?q=MR1"
code 200 "lookup limit ติดลบ" -H "$R" "$B/lookup/mr?q=MR1&limit=-5"
code 200 "lookup limit 0" -H "$R" "$B/lookup/mr?q=MR1&limit=0"
code 400 "lookup kind ผิด" -H "$R" "$B/lookup/bogus?q=x"
code 400 "lookup/cutoff ถูกลบแล้ว" -H "$R" "$B/lookup/cutoff?mr=MR-1&inv=4"

echo "== อ้างอิง PO / DD"
code 200 "lookup po" -H "$R" "$B/lookup/po?q=LBPO26&inv=4"
expect "po ส่งต่อผล doc/search (kind, q, inv ไปถึง ncac)" "d['results'][0]['code']=='LBPO26100704' and d['results'][0]['kind']=='po' and d['results'][0]['q']=='LBPO26' and d['results'][0]['inv']=='4'"
code 200 "lookup dd" -H "$R" "$B/lookup/dd?q=LBDD26"
expect "dd ส่งต่อ" "d['results'][0]['kind']=='dd' and d['results'][0]['status'] is None"
code 200 "lookup po สั้นเกินไป" -H "$R" "$B/lookup/po?q=L"
expect "q สั้น = ว่าง" "d['results']==[]"
code 200 "api-key lookup po" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" "$B/lookup/po?q=LBPO26"
code 401 "lookup po ไม่ล็อกอิน" "$B/lookup/po?q=LBPO26"
code 200 "รายการในใบ po" -H "$R" "$B/lookup/doc/po/157902?inv=4"
expect "doc + lines (OIL-001→501 สต๊อก 12 / FLT-002→502 จากสำเนา / ค่าแรง LB00269 ถูกตัดทิ้งที่เซิร์ฟเวอร์)" "d['doc']['code']=='LBPO26100704' and [l['skuId'] for l in d['lines']]==[501,501,502] and d['lines'][0]['stockQty']==12 and not any(l['isLabour'] for l in d['lines']) and [l['qty'] for l in d['lines']]==[2,1,0]"
expect "warnings ข้ามค่าแรง" "'ข้ามบรรทัดค่าแรง 1 รายการ (นำเข้าเฉพาะอะไหล่)' in d['warnings']"
code 200 "รายการในใบ dd (api-key)" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" "$B/lookup/doc/dd/157902?inv=4"
code 404 "ใบที่ไม่พบ" -H "$R" "$B/lookup/doc/po/404404"
code 400 "ชนิดใบผิด" -H "$R" "$B/lookup/doc/xx/1"
code 400 "id ผิด" -H "$R" "$B/lookup/doc/po/abc"
code 200 "lookup pr ด้วยทะเบียน" -H "$R" "$B/lookup/pr?q=71-1234&inv=4&limit=20"
expect "pr: kind/q ถึง ncac · limit ถูกจำกัด 5 · remark ส่งต่อ" "d['results'][0]['kind']=='pr' and d['results'][0]['q']=='71-1234' and d['results'][0]['limit']=='5' and d['results'][0]['remark']=='71-1234 เปลี่ยนผ้าเบรค'"
code 200 "lookup mrv ด้วยทะเบียน" -H "$R" "$B/lookup/mrv?q=71-1234&limit=20"
expect "mrv: q ถึง ncac · limit ถูกจำกัด 5 · หัว MR + remark ส่งต่อ" "d['results'][0]['code']=='LBMR26100001' and d['results'][0]['plate']=='71-1234' and d['results'][0]['limit']=='5' and d['results'][0]['remark'].startswith('อู่ใน-CM-ระบบเครื่องยนต์')"
code 200 "lookup mrv สั้นเกินไป" -H "$R" "$B/lookup/mrv?q=7"
code 200 "api-key lookup mrv" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" "$B/lookup/mrv?q=71-1234"
code 401 "lookup mrv ไม่ล็อกอิน" "$B/lookup/mrv?q=71-1234"
code 200 "รายการในใบ pr" -H "$R" "$B/lookup/doc/pr/55?inv=4"
expect "pr: ไม่มีค่าแรง · qty=จำนวนที่ขอ · เตือนข้ามค่าแรง" "d['doc']['kind']=='pr' and [l['skuCode'] for l in d['lines']]==['OIL-001','OIL-001','FLT-002'] and not any(l['isLabour'] for l in d['lines']) and [l['qty'] for l in d['lines']]==[4,1,2] and 'ข้ามบรรทัดค่าแรง 1 รายการ (นำเข้าเฉพาะอะไหล่)' in d['warnings']"
code 401 "รายการในใบ ไม่ล็อกอิน" "$B/lookup/doc/po/157902"
REFBODY='{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"70-7777","mrCode":"MR-9","ref":{"type":"po","code":"LBPO26100704","id":157902},"lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":2}]}'
code 400 "ref type ผิด" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"x","ref":{"type":"xx","code":"LBPR123"},"lines":[{"skuId":1,"skuCode":"a","skuName":"a","requestedQty":1}]}'
code 400 "ref code ว่าง" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"x","ref":{"type":"po","code":"  "},"lines":[{"skuId":1,"skuCode":"a","skuName":"a","requestedQty":1}]}'
code 201 "สร้างพร้อม ref pr" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"71-1234","ref":{"type":"pr","code":"LBPR26100561","id":55},"lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":1}]}'
NPR=$(jget "d['no']")
code 200 "ดูใบที่อ้าง pr" -H "$R" "$B/$NPR"
expect "ref pr + workType อนุมานจาก kind=stock → garage_in" "d['request']['ref']['type']=='pr' and d['request']['workType']=='garage_in'"
code 200 "ยกเลิกใบ pr" -H "$R" -X POST "$B/$NPR/cancel"
echo "== ประเภทงาน (workType)"
WL='"inventoryId":4,"pickToId":7,"plate":"เบอร์ 1234","lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":1}]'
DUE=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2)).isoformat())")
code 201 "workType=mobile_pm (ไม่ส่ง kind)" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"mobile_pm\",\"summaryDueAt\":\"$DUE\",$WL}"
NW1=$(jget "d['no']")
code 200 "ดู mobile_pm" -H "$R" "$B/$NW1"
expect "mobile_pm → kind stock · ทะเบียนเป็นเบอร์รถได้" "d['request']['workType']=='mobile_pm' and d['request']['kind']=='stock' and d['request']['plate']=='เบอร์ 1234'"
code 201 "workType=garage_out" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"garage_out\",$WL}"
NW2=$(jget "d['no']")
code 200 "ดู garage_out" -H "$R" "$B/$NW2"
expect "garage_out → kind cutoff" "d['request']['workType']=='garage_out' and d['request']['kind']=='cutoff'"
code 201 "kind=cutoff แบบเดิม (ไม่ส่ง workType)" -H "$R" -H "$J" -X POST "$B" -d "{\"kind\":\"cutoff\",$WL}"
NW3=$(jget "d['no']")
code 200 "รายการของฉัน มี workType ทุกใบ" -H "$R" "$B?mine=1"
expect "list: ใบ NW3 อนุมานเป็น garage_out · ทุกใบมี workType" "[x['workType'] for x in d['items'] if x['no']=='$NW3'][0]=='garage_out' and all('workType' in x for x in d['items'])"
code 400 "workType ขัดกับ kind" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"garage_in\",\"kind\":\"cutoff\",$WL}"
expect "ข้อความ 400 เป็นไทย" "'อู่ใน' in d['error']"
code 400 "workType ผิดค่า" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"x\",$WL}"
code 400 "ไม่ส่ง workType และ kind" -H "$R" -H "$J" -X POST "$B" -d "{$WL}"
for N in "$NW1" "$NW2" "$NW3"; do curl -s -o /dev/null -H "$R" -X POST "$B/$N/cancel"; done
code 201 "สร้างพร้อม ref" -H "$R" -H "$J" -X POST "$B" -d "$REFBODY"
NREF=$(jget "d['no']")
code 200 "ดูใบที่มี ref" -H "$R" "$B/$NREF"
expect "รายละเอียดมี ref" "d['request']['ref']=={'type':'po','code':'LBPO26100704','id':157902}"
code 201 "สร้างใบที่ไม่อ้างอิง" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"70-6666","lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":1}]}'
NNOREF=$(jget "d['no']")
code 200 "รายการของฉัน มี ref" -H "$R" "$B?mine=1"
expect "list: ใบที่อ้างมี ref · ใบที่ไม่อ้างได้ ref เป็น null" "[x['ref'] for x in d['items'] if x['no']=='$NREF'][0]['code']=='LBPO26100704' and [x['ref'] for x in d['items'] if x['no']=='$NNOREF'][0] is None"
code 200 "ดูใบที่ไม่อ้างอิง" -H "$R" "$B/$NNOREF"
expect "detail: ref เป็น null" "d['request']['ref'] is None"
code 200 "ยกเลิกใบที่ไม่อ้างอิง" -H "$R" -X POST "$B/$NNOREF/cancel"
code 200 "รายการในใบ: ตัดไปแล้ว/cutBy" -H "$R" "$B/lookup/doc/po/157902?inv=4"
expect "OIL-001 alreadyCut=2 จากใบ $NREF" "d['lines'][0]['alreadyCut']==2 and d['lines'][0]['cutBy']==['$NREF'] and d['warnings'].count('บางบรรทัดมีคำขออื่นอ้างและตัดไปแล้ว')==1"
code 200 "ยกเลิกใบที่อ้าง" -H "$R" -X POST "$B/$NREF/cancel"
code 200 "รายการในใบหลังยกเลิก" -H "$R" "$B/lookup/doc/po/157902?inv=4"
expect "ยกเลิกแล้วไม่นับ" "d['lines'][0]['alreadyCut']==0 and d['lines'][0]['cutBy']==[]"

echo "== สร้างคำขอ"
BODY='{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"70-1234","mrCode":"MR-1","urgent":true,"lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":2},{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":3},{"skuId":502,"skuCode":"FLT-002","skuName":"ไส้กรอง","requestedQty":1}]}'
code 201 "สร้าง" -H "$R" -H "$J" -X POST "$B" -d "$BODY"
NO=$(jget "d['no']")
echo "   no=$NO"
code 400 "สร้างโดยไม่มีทะเบียน" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"","lines":[{"skuId":1,"skuCode":"a","skuName":"a","requestedQty":1}]}'
code 400 "สร้างโดยคลังไม่อยู่ใน options" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":99,"pickToId":7,"plate":"x","lines":[{"skuId":1,"skuCode":"a","skuName":"a","requestedQty":1}]}'
code 400 "สร้างจำนวน 0" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"x","lines":[{"skuId":1,"skuCode":"a","skuName":"a","requestedQty":0}]}'
code 200 "รายการของฉัน" -H "$R" "$B?mine=1"
expect "mine เห็นใบที่สร้าง" "any(r['no']=='$NO' for r in d['items'])"
code 200 "ดูรายละเอียด" -H "$R" "$B/$NO"
expect "รวม skuId ซ้ำ (501 = 5) และสถานะ NEW" "d['request']['status']=='NEW' and len(d['request']['lines'])==2 and d['request']['lines'][0]['requestedQty']==5"

echo "== คิวสโตร์"
code 200 "queue" -H "$S" "$B/queue?inv=4"
expect "ใบอยู่ช่อง NEW และ atmsKeyed อ่านด้วยบัญชี svc (ไม่ต้องผูกบัญชีสโตร์)" "any(r['no']=='$NO' for r in d['columns']['NEW']) and [x['id'] for x in d['atmsKeyed']]==[9001, 8123]"
grep -q "GET /atms/withdraw/list user=svc" "$TMP/ncac-calls.log" && ok "list ยิงด้วยบัญชีค้นข้อมูล svc" || bad "list ไม่ได้ใช้ svc"
code 200 "live-stock (ncac จำลอง)" -H "$S" "$B/live-stock?inv=4&items=OIL-001:501,FLT-002:502"
expect "สต๊อกสด 7 (live) + FLT-002 skuPk ไม่ตรง → ถอยไปสำเนา 3" "d['stock']['OIL-001']=={'qty':7,'live':True} and d['stock']['FLT-002']=={'qty':3,'live':False}"

echo "== ผูกบัญชี ATMS"
code 403 "ผูกอีเมลไม่ตรง" -H "$S" -H "$J" -X POST "$B/atms-link" -d '{"username":"other","password":"pw"}'
code 422 "ผูกรหัสผิด" -H "$S" -H "$J" -X POST "$B/atms-link" -d '{"username":"badstore","password":"pw"}'
code 200 "ผูกสำเร็จ" -H "$S" -H "$J" -X POST "$B/atms-link" -d '{"username":"store1","password":"secret-pw"}'
code 200 "สถานะผูก" -H "$S" "$B/atms-link"
expect "linked และไม่คืนรหัสผ่าน" "d['linked']==True and 'password' not in str(d) and 'secret-pw' not in str(d)"

code 200 "queue หลังผูกบัญชี" -H "$S" "$B/queue?inv=4"
expect "ยังไม่มี gmId = เห็นทั้ง 9001 และ 8123" "[x['id'] for x in d['atmsKeyed']]==[9001, 8123]"
CALLS_BEFORE=$(grep -c "GET /atms/withdraw/list" "$TMP/ncac-calls.log")
code 200 "queue ซ้ำ (แคช 3 นาที)" -H "$S" "$B/queue?inv=4"
[ "$(grep -c 'GET /atms/withdraw/list' "$TMP/ncac-calls.log")" = "$CALLS_BEFORE" ] && ok "แคช: ไม่ยิง ncac list ซ้ำ" || bad "ยิง ncac list ซ้ำทั้งที่มีแคช"

echo "== list ล่ม/ช้า ไม่ทำให้คิวค้าง + negative cache"
echo '{"list":"fail"}' > "$TMP/ctl.json"
code 200 "queue inv=5 ตอน ATMS ล่ม" -H "$S" "$B/queue?inv=5"
expect "คิวหลักมา atmsKeyed ว่าง" "d['atmsKeyed']==[] and 'NEW' in d['columns']"
N1=$(grep -c "GET /atms/withdraw/list" "$TMP/ncac-calls.log")
code 200 "queue inv=5 ซ้ำ" -H "$S" "$B/queue?inv=5"
[ "$(grep -c 'GET /atms/withdraw/list' "$TMP/ncac-calls.log")" = "$N1" ] && ok "พักหลังพลาด: ไม่ยิง ATMS ซ้ำใน 2 นาที" || bad "ยิง list ซ้ำหลังพลาด"
echo '{"list":"slow"}' > "$TMP/ctl.json"
T0=$(python3 -c "import time;print(time.time())")
code 200 "queue inv=6 ตอน ATMS ช้า" -H "$S" "$B/queue?inv=6"
python3 -c "import time,sys;sys.exit(0 if time.time()-$T0<4 else 1)" && ok "ไม่รอ list เกิน 4 วิ" || bad "คิวรอ list นานเกินไป"
echo '{}' > "$TMP/ctl.json"

echo "== cancel / claim / lines / ready / issue"
code 403 "คนอื่นยกเลิกใบไม่ได้" -H "$R2" -X POST "$B/$NO/cancel"
code 200 "claim" -H "$S" -X POST "$B/$NO/claim"
expect "PREPARING + claimedBy" "d['request']['status']=='PREPARING' and d['request']['claimedBy']['email']=='store1@menatransport.co.th'"
code 409 "cancel หลัง claim" -H "$R" -X POST "$B/$NO/cancel"
code 409 "claim ซ้ำ" -H "$S" -X POST "$B/$NO/claim"
code 404 "claim ใบที่ไม่มี" -H "$S" -X POST "$B/SW-0000-999/claim"
code 404 "ready ใบที่ไม่มี" -H "$S" -X POST "$B/SW-0000-999/ready"
code 404 "ดูใบที่ไม่มี" -H "$R" "$B/SW-0000-999"
code 400 "แก้จำนวนเกินที่ขอ" -H "$S" -H "$J" -X PATCH "$B/$NO/lines" -d '{"lines":[{"index":0,"issuedQty":9,"short":false}]}'
code 200 "แก้จำนวนจ่าย" -H "$S" -H "$J" -X PATCH "$B/$NO/lines" -d '{"lines":[{"index":0,"issuedQty":4,"short":true},{"index":1,"issuedQty":1,"short":false}]}'
expect "issuedQty=4 short" "d['request']['lines'][0]['issuedQty']==4 and d['request']['lines'][0]['short']==True"
code 400 "ปฏิเสธต้องมีเหตุผล" -H "$S" -H "$J" -X POST "$B/$NO/reject" -d '{}'
code 409 "issue ก่อน ready" -H "$S" -X POST "$B/$NO/issue"
code 200 "ready" -H "$S" -X POST "$B/$NO/ready"
code 409 "แก้บรรทัดหลัง ready" -H "$S" -H "$J" -X PATCH "$B/$NO/lines" -d '{"lines":[{"index":0,"issuedQty":1,"short":false}]}'

echo "== จัดครบ: จ่าย 0 ทุกบรรทัดไม่ได้"
code 201 "สร้างใบจ่ายศูนย์" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"stock","inventoryId":4,"pickToId":7,"plate":"70-0000","lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":2}]}'
NOZ=$(jget "d['no']")
code 200 "claim ใบจ่ายศูนย์" -H "$S" -X POST "$B/$NOZ/claim"
code 200 "ใส่จ่าย 0 + ของขาด" -H "$S" -H "$J" -X PATCH "$B/$NOZ/lines" -d '{"lines":[{"index":0,"issuedQty":0,"short":true}]}'
code 400 "ready จ่าย 0 ทุกบรรทัด" -H "$S" -X POST "$B/$NOZ/ready"
expect "ข้อความบอกให้ปฏิเสธแทน" "'ปฏิเสธแทน' in d['error']"
code 200 "ปฏิเสธใบจ่ายศูนย์" -H "$S" -H "$J" -X POST "$B/$NOZ/reject" -d '{"reason":"ของหมด"}'

echo "== สัญญา api-ncac: 403 = ตั้งค่า / ไม่รู้ผล = ค้าง ISSUING / ปฏิเสธและปิดมือจาก ISSUE_FAILED"
CUT='{"kind":"cutoff","inventoryId":4,"pickToId":7,"plate":"70-5555","lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":1}]}'
code 201 "สร้างใบตัดยอด A" -H "$R" -H "$J" -X POST "$B" -d "$CUT"
NA=$(jget "d['no']")
echo '{"forbid":true}' > "$TMP/ctl.json"
code 200 "issue ตอน ncac ตอบ 403" -H "$S" -X POST "$B/$NA/issue"
expect "ISSUE_FAILED + ข้อความตั้งค่า + ไม่ขอผูกบัญชีใหม่" "d['request']['status']=='ISSUE_FAILED' and d['request']['atms']['needCreds']==False and 'api-ncac' in d['request']['atms']['error']"
code 502 "ผูกบัญชีตอน ncac ตอบ 403" -H "$S" -H "$J" -X POST "$B/atms-link" -d '{"username":"store1","password":"secret-pw"}'
expect "ข้อความตั้งค่า ไม่ใช่รหัสผิด" "'api-ncac' in d['error']"
echo '{}' > "$TMP/ctl.json"
code 200 "ปฏิเสธใบ ISSUE_FAILED ที่ยังไม่มี WD" -H "$S" -H "$J" -X POST "$B/$NA/reject" -d '{"reason":"ยกเลิกงาน"}'
expect "REJECTED" "d['request']['status']=='REJECTED'"

code 201 "สร้างใบตัดยอด B" -H "$R" -H "$J" -X POST "$B" -d "$CUT"
NB=$(jget "d['no']")
echo '{"issue":"drop"}' > "$TMP/ctl.json"
code 200 "issue ตอนเชื่อมต่อหลุด" -H "$S" -X POST "$B/$NB/issue"
expect "ค้าง ISSUING ไม่ใช่ ISSUE_FAILED + บอกรอ 5 นาที" "d['request']['status']=='ISSUING' and 'รอ 5 นาที' in d['request']['atms']['error']"
echo '{}' > "$TMP/ctl.json"
N0=$(grep -c "POST /atms/withdraw/issue" "$TMP/ncac-calls.log")
code 409 "กดซ้ำทันทีไม่ได้ (กัน WD ซ้ำ)" -H "$S" -X POST "$B/$NB/issue"
[ "$(grep -c 'POST /atms/withdraw/issue' "$TMP/ncac-calls.log")" = "$N0" ] && ok "ไม่ยิง ncac ซ้ำ" || bad "ยิง ncac ซ้ำทั้งที่ยังไม่ครบ 5 นาที"
code 409 "ปฏิเสธใบที่ค้าง ISSUING ไม่ได้" -H "$S" -H "$J" -X POST "$B/$NB/reject" -d '{"reason":"x"}'

code 201 "สร้างใบตัดยอด C" -H "$R" -H "$J" -X POST "$B" -d "$CUT"
NC=$(jget "d['no']")
echo '{"issue":"409"}' > "$TMP/ctl.json"
code 200 "issue ทำไม่ครบ (มี WD แล้ว)" -H "$S" -X POST "$B/$NC/issue"
expect "ISSUE_FAILED และมี gmId" "d['request']['status']=='ISSUE_FAILED' and d['request']['atms']['gmId']==9001"
echo '{}' > "$TMP/ctl.json"
code 409 "ปฏิเสธตรง ๆ ไม่ได้เมื่อมี WD แล้ว" -H "$S" -H "$J" -X POST "$B/$NC/reject" -d '{"reason":"x"}'
code 400 "ปิดมือต้องมีหมายเหตุ" -H "$S" -H "$J" -X POST "$B/$NC/close-manual" -d '{}'
code 403 "ผู้ขอปิดมือไม่ได้" -H "$R" -H "$J" -X POST "$B/$NC/close-manual" -d '{"note":"x"}'
code 200 "ปิดมือ" -H "$S" -H "$J" -X POST "$B/$NC/close-manual" -d '{"note":"ลบ WD ใน ATMS แล้ว"}'
expect "REJECTED + ขึ้นต้น ปิดมือ" "d['request']['status']=='REJECTED' and d['request']['rejectReason'].startswith('ปิดมือ: ')"

echo "== x-api-key"
code 201 "api-key สร้าง" -H "x-api-key: key-two" -H "x-user: ext.user@menatransport.co.th" -H "$J" -X POST "$B" -d "$BODY"
APINO=$(jget "d['no']")
code 200 "api-key ดูรายละเอียด" -H "x-api-key: key-two" -H "x-user: ext.user@menatransport.co.th" "$B/$APINO"
expect "via=api และ requestedBy จาก x-user" "d['request']['requestedBy']['via']=='api' and d['request']['requestedBy']['email']=='ext.user@menatransport.co.th'"
code 400 "x-user ไม่ใช่อีเมลบริษัท" -H "x-api-key: key-one" -H "x-user: someone@gmail.com" -H "$J" -X POST "$B" -d "$BODY"
code 400 "x-user มีช่องว่าง" -H "x-api-key: key-one" -H "x-user: a b@menatransport.co.th" -H "$J" -X POST "$B" -d "$BODY"
code 400 "api-key ไม่มี x-user" -H "x-api-key: key-one" -H "$J" -X POST "$B" -d "$BODY"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" -X POST "$B/$NO/issue")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then ok "api-key issue ถูกปฏิเสธ ($CODE)"; else bad "api-key issue ได้ $CODE"; fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: wrong" -H "x-user: a@b.c" -H "$J" -X POST "$B" -d "$BODY")
if [ "$CODE" = 401 ]; then ok "api-key ผิด 401"; else bad "api-key ผิดได้ $CODE"; fi
code 200 "api-key ยกเลิกใบตัวเอง" -H "x-api-key: key-two" -H "x-user: ext.user@menatransport.co.th" -X POST "$B/$APINO/cancel"

echo "== drift"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/drift-tick")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ] || [ "$CODE" = 307 ]; then ok "drift-tick ไม่มีกุญแจถูกปฏิเสธ ($CODE)"; else bad "drift-tick ไม่มีกุญแจได้ $CODE"; fi
code 401 "drift-tick กุญแจผิด" -H "x-api-key: wrong" -X POST "$B/drift-tick"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: key-one" -X POST "$B/drift-tick")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ] || [ "$CODE" = 307 ]; then ok "กุญแจผู้ขอเรียก drift-tick ไม่ได้ ($CODE)"; else bad "กุญแจผู้ขอเรียก drift-tick ได้ $CODE"; fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: tick-key-1" -H "x-user: ext.user@menatransport.co.th" -H "$J" -X POST "$B" -d "$BODY")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ] || [ "$CODE" = 307 ]; then ok "กุญแจ tick ยื่นคำขอไม่ได้ ($CODE)"; else bad "กุญแจ tick ยื่นคำขอได้ $CODE"; fi
code 200 "drift-tick กุญแจถูก" -H "x-api-key: tick-key-1" -X POST "$B/drift-tick"
expect "drift-tick ตอบ checked/drifted/skipped" "sorted(d.keys())==['checked','drifted','skipped']"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" -X POST "$B/$NO/check")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then ok "api-key check ถูกปฏิเสธ ($CODE)"; else bad "api-key check ได้ $CODE"; fi
code 200 "สโตร์ check" -H "$S" -X POST "$B/$NO/check"
code 200 "หน้าคู่มือ API เปิดสาธารณะ" "http://localhost:$PORT/store-withdraw/api-guide"

echo "== issue (ncac จำลอง)"
code 200 "issue" -H "$S" -X POST "$B/$NO/issue"
expect "ISSUED + เลข WD" "d['request']['status']=='ISSUED' and d['request']['atms']['code']=='LBWD-9001'"
grep -q "POST /atms/withdraw/issue user=store1" "$TMP/ncac-calls.log" && ok "ยิง ncac ด้วยบัญชีสโตร์" || bad "ไม่เห็นการยิง ncac ของสโตร์"
code 409 "issue ซ้ำ" -H "$S" -X POST "$B/$NO/issue"
code 201 "สร้างใบตัดยอดพร้อม ref" -H "$R" -H "$J" -X POST "$B" -d '{"kind":"cutoff","inventoryId":4,"pickToId":7,"plate":"70-8888","mrCode":"MR-9","remark":"ด่วน","ref":{"type":"dd","code":"LBDD26100001","id":157902},"lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":1}]}'
NRM=$(jget "d['no']")
code 200 "issue ใบที่มี ref" -H "$S" -X POST "$B/$NRM/issue"
expect "ISSUED" "d['request']['status']=='ISSUED'"
grep -q "remark_token=$NRM remark=MR-9 LBDD26100001 70-8888 ด่วน" "$TMP/ncac-calls.log" && ok "remark ที่ส่ง ATMS มีเลขใบ แต่ remark_token ยังเป็นเลข SW" || bad "remark ที่ส่ง ncac ไม่ตรง: $(grep 'remark_token' "$TMP/ncac-calls.log" | tail -2)"
code 200 "queue หลังมี gmId: ตัดแถว 9001 ออก" -H "$S" "$B/queue?inv=4"
expect "atmsKeyed เหลือเฉพาะ 8123" "[x['id'] for x in d['atmsKeyed']]==[8123]"

echo "== receive / returns / accept"
code 403 "คนอื่นกดรับแทนไม่ได้" -H "$R2" -X POST "$B/$NO/receive"
code 200 "receive" -H "$R" -X POST "$B/$NO/receive"
expect "RECEIVED" "d['request']['status']=='RECEIVED'"
code 400 "ขอคืนไม่ใส่เหตุผล" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"lines":[{"lineIndex":0,"qty":1}]}'
code 400 "reasonCode ผิด" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"reasonCode":"xx","lines":[{"lineIndex":0,"qty":1}]}'
code 400 "อื่นๆ ไม่พิมพ์เหตุผล" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"reasonCode":"other","lines":[{"lineIndex":0,"qty":1}]}'
code 409 "คืนเกินที่จ่าย (4)" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"reasonCode":"unused","lines":[{"lineIndex":0,"qty":5}]}'
code 201 "ขอคืน 1" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"reasonCode":"unused","lines":[{"lineIndex":0,"qty":1}]}'
RID=$(jget "d['rid']")
code 409 "ขอคืนซ้อนเกินคงเหลือ (3+1>4)" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"reasonCode":"unused","lines":[{"lineIndex":0,"qty":4}]}'
code 200 "queue เห็นใบคืนช่อง NEW" -H "$S" "$B/queue?inv=4"
expect "ใบคืนอยู่ NEW และใบเดิมอยู่ DONE_TODAY" "any(r.get('itemType')=='return' for r in d['columns']['NEW']) and any(r['no']=='$NO' for r in d['columns']['DONE_TODAY'])"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" -X POST "$B/$NO/returns/$RID/accept")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then ok "api-key accept ถูกปฏิเสธ ($CODE)"; else bad "api-key accept ได้ $CODE"; fi
code 200 "accept คืน" -H "$S" -X POST "$B/$NO/returns/$RID/accept"
expect "RETURNED + returnedQty=1" "d['request']['returns'][0]['status']=='RETURNED' and d['request']['lines'][0]['returnedQty']==1"
code 200 "log" -H "$R" "$B/$NO"
expect "log มีหลายรายการ" "len(d['log'])>=5"

echo "== Mobile/PM แบบสรุปทีหลัง (ส่งของไม่ตัด ATMS → สรุปการใช้ → ตัดสต๊อก WD ต่อทะเบียน)"
PL='"lines":[{"skuId":501,"skuCode":"OIL-001","skuName":"น้ำมันเครื่อง","requestedQty":3},{"skuId":502,"skuCode":"FLT-002","skuName":"ไส้กรอง","requestedQty":1}]'
PAST=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=1)).isoformat())")
FAR=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=61)).isoformat())")
DUE2=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=5)).isoformat())")
code 400 "mobile_pm ไม่มีกำหนดสรุป" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"mobile_pm\",\"inventoryId\":4,\"pickToId\":7,$PL}"
expect "ข้อความไทยบอกให้ใส่กำหนด" "'กำหนดสรุปยอด' in d['error']"
code 400 "กำหนดสรุปเป็นอดีต" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"mobile_pm\",\"summaryDueAt\":\"$PAST\",\"inventoryId\":4,\"pickToId\":7,$PL}"
code 400 "กำหนดสรุปเกิน 60 วัน" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"mobile_pm\",\"summaryDueAt\":\"$FAR\",\"inventoryId\":4,\"pickToId\":7,$PL}"
code 400 "อู่ในยังต้องมีทะเบียน" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"garage_in\",\"inventoryId\":4,\"pickToId\":7,$PL}"
code 201 "mobile_pm ไม่มีทะเบียน/MR" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"mobile_pm\",\"summaryDueAt\":\"$DUE\",\"inventoryId\":4,\"pickToId\":7,$PL}"
NP=$(jget "d['no']")
code 200 "ดูใบ mobile_pm" -H "$R" "$B/$NP"
expect "plate ว่าง + summaryDueAt + summaryExtensions 0" "d['request']['plate']=='' and d['request']['summaryDueAt'] and d['request']['summaryExtensions']==0"
code 200 "claim mobile_pm" -H "$S" -X POST "$B/$NP/claim"
code 200 "ready mobile_pm" -H "$S" -X POST "$B/$NP/ready"
NI=$(grep -c "POST /atms/withdraw/issue" "$TMP/ncac-calls.log")
code 200 "ส่งของ mobile_pm" -H "$S" -X POST "$B/$NP/issue"
expect "HANDED_OUT ไม่มีเลข WD" "d['request']['status']=='HANDED_OUT' and d['request']['atms']['gmId'] is None"
[ "$(grep -c 'POST /atms/withdraw/issue' "$TMP/ncac-calls.log")" = "$NI" ] && ok "ส่งของ mobile_pm ไม่ยิง ATMS" || bad "ส่งของ mobile_pm ยิง ATMS"
code 409 "ส่งของซ้ำ" -H "$S" -X POST "$B/$NP/issue"
code 200 "queue มีช่องรอช่างสรุป" -H "$S" "$B/queue?inv=4"
expect "ใบอยู่ HANDED_OUT ไม่อยู่ช่องอื่น" "any(r['no']=='$NP' for r in d['columns']['HANDED_OUT']) and not any(r['no']=='$NP' for c in ['NEW','PREPARING','READY','DONE_TODAY'] for r in d['columns'][c])"
code 409 "mobile_pm ขอคืนไม่ได้" -H "$R" -H "$J" -X POST "$B/$NP/returns" -d '{"reasonCode":"unused","lines":[{"lineIndex":0,"qty":1}]}'
expect "ข้อความ 409 บอกให้สรุปแทน" "'สรุปการใช้' in d['error']"
code 403 "คนอื่นเลื่อนกำหนดไม่ได้" -H "$R2" -H "$J" -X POST "$B/$NP/extend" -d "{\"summaryDueAt\":\"$DUE2\"}"
code 400 "เลื่อนไปอดีตไม่ได้" -H "$R" -H "$J" -X POST "$B/$NP/extend" -d "{\"summaryDueAt\":\"$PAST\"}"
code 200 "เลื่อนกำหนด" -H "$R" -H "$J" -X POST "$B/$NP/extend" -d "{\"summaryDueAt\":\"$DUE2\"}"
expect "summaryExtensions = 1" "d['request']['summaryExtensions']==1 and d['request']['status']=='HANDED_OUT'"
U1='{"lineIndex":0,"plate":"70-2222","mrCode":"LBMR26110002","mrItemId":22,"mrItemLabel":"LBMR26110002 PM-เบรค : 22","qty":1}'
U2='{"lineIndex":0,"plate":"70-1111","mrCode":"LBMR26110001","mrItemId":11,"mrItemLabel":"LBMR26110001 PM-ไฟ : 11","qty":1}'
U3='{"lineIndex":1,"plate":"70-1111","mrCode":"LBMR26110001","mrItemId":11,"mrItemLabel":"LBMR26110001 PM-ไฟ : 11","qty":1}'
code 403 "คนอื่นสรุปไม่ได้" -H "$R2" -H "$J" -X POST "$B/$NP/summary" -d "{\"usages\":[$U1]}"
code 400 "สรุปเกินที่เบิก" -H "$R" -H "$J" -X POST "$B/$NP/summary" -d '{"usages":[{"lineIndex":1,"plate":"70-1111","mrCode":"M","mrItemId":1,"mrItemLabel":"x","qty":2}]}'
code 400 "สรุปไม่มี MR" -H "$R" -H "$J" -X POST "$B/$NP/summary" -d '{"usages":[{"lineIndex":0,"plate":"70-1111","mrCode":"","mrItemId":1,"mrItemLabel":"x","qty":1}]}'
code 403 "ผู้ขอตัดสต๊อกเองไม่ได้" -H "$R" -H "$J" -X POST "$B/$NP/settle" -d '{"returnConfirmed":true}'
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" -H "$J" -X POST "$B/$NP/settle" -d '{"returnConfirmed":true}')
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then ok "api-key settle ถูกปฏิเสธ ($CODE)"; else bad "api-key settle ได้ $CODE"; fi
code 409 "ตัดก่อนสรุปไม่ได้" -H "$S" -H "$J" -X POST "$B/$NP/settle" -d '{"returnConfirmed":true}'
code 200 "สรุปการใช้ 2 คัน" -H "$R" -H "$J" -X POST "$B/$NP/summary" -d "{\"usages\":[$U1,$U2,$U3],\"note\":\"ใช้สองคัน\"}"
expect "SUMMARIZED + ของเหลือ OIL 1 (คิดให้)" "d['request']['status']=='SUMMARIZED' and d['request']['summary']['returns']==[{'lineIndex':0,'qty':1}]"
code 409 "สรุปซ้ำไม่ได้" -H "$R" -H "$J" -X POST "$B/$NP/summary" -d '{"usages":[]}'
code 409 "เลื่อนหลังสรุปไม่ได้" -H "$R" -H "$J" -X POST "$B/$NP/extend" -d "{\"summaryDueAt\":\"$DUE2\"}"
code 200 "queue หลังสรุป" -H "$S" "$B/queue?inv=4"
expect "ใบไปอยู่ช่อง NEW (งานตัดสต๊อก)" "any(r['no']=='$NP' and r['status']=='SUMMARIZED' for r in d['columns']['NEW'])"
code 400 "ตัดสต๊อกไม่ติ๊กรับของคืน" -H "$S" -H "$J" -X POST "$B/$NP/settle" -d '{}'
expect "ข้อความบอกให้ติ๊ก" "'รับของคืนแล้ว' in d['error']"
NI=$(grep -c "POST /atms/withdraw/issue" "$TMP/ncac-calls.log")
code 200 "ตัดสต๊อก" -H "$S" -H "$J" -X POST "$B/$NP/settle" -d '{"returnConfirmed":true}'
expect "SETTLED + WD 2 ใบ (เรียงทะเบียน 70-1111, 70-2222)" "d['request']['status']=='SETTLED' and [(g['token'],g['plate'],g['status']) for g in d['request']['settleGroups']]==[('$NP-1','70-1111','DONE'),('$NP-2','70-2222','DONE')] and d['request']['returnConfirmedBy']['email']=='store1@menatransport.co.th'"
[ "$(grep -c 'POST /atms/withdraw/issue' "$TMP/ncac-calls.log")" = "$((NI+2))" ] && ok "ยิง ATMS 2 ครั้ง (หนึ่งครั้งต่อทะเบียน)" || bad "จำนวนครั้งที่ยิง ATMS ไม่ใช่ 2"
grep -q "remark_token=$NP-1 remark=LBMR26110001 70-1111" "$TMP/ncac-calls.log" && grep -q "remark_token=$NP-2 remark=LBMR26110002 70-2222" "$TMP/ncac-calls.log" && ok "token/หมายเหตุต่อทะเบียนถูก" || bad "token/หมายเหตุ settle: $(grep "remark_token=$NP" "$TMP/ncac-calls.log")"
grep -q "POST /atms/withdraw/issue user=store1" "$TMP/ncac-calls.log" && ok "ตัดด้วยบัญชีสโตร์" || bad "ไม่ได้ใช้บัญชีสโตร์"
NI=$(grep -c "POST /atms/withdraw/issue" "$TMP/ncac-calls.log")
code 409 "ตัดซ้ำไม่ได้" -H "$S" -H "$J" -X POST "$B/$NP/settle" -d '{"returnConfirmed":true}'
[ "$(grep -c 'POST /atms/withdraw/issue' "$TMP/ncac-calls.log")" = "$NI" ] && ok "ตัดซ้ำไม่ยิง ATMS" || bad "ตัดซ้ำยิง ATMS"
code 200 "ดูใบหลังตัด (log)" -H "$R" "$B/$NP"
expect "log มี handOut/extendDue/summarize/settled" "all(a in [l['action'] for l in d['log']] for a in ['handOut','extendDue','summarize','settled'])"
code 201 "mobile_pm คืนหมด" -H "$R" -H "$J" -X POST "$B" -d "{\"workType\":\"mobile_pm\",\"summaryDueAt\":\"$DUE\",\"inventoryId\":4,\"pickToId\":7,$PL}"
NZ=$(jget "d['no']")
for st in claim ready issue; do curl -s -o /dev/null -H "$S" -X POST "$B/$NZ/$st"; done
code 200 "สรุปไม่ได้ใช้เลย" -H "$R" -H "$J" -X POST "$B/$NZ/summary" -d '{"usages":[]}'
NI=$(grep -c "POST /atms/withdraw/issue" "$TMP/ncac-calls.log")
code 200 "ตัดสต๊อกใบคืนหมด" -H "$S" -H "$J" -X POST "$B/$NZ/settle" -d '{"returnConfirmed":true}'
expect "SETTLED ไม่มี WD" "d['request']['status']=='SETTLED' and d['request']['settleGroups']==[]"
[ "$(grep -c 'POST /atms/withdraw/issue' "$TMP/ncac-calls.log")" = "$NI" ] && ok "คืนหมดไม่ยิง ATMS" || bad "คืนหมดยิง ATMS"

echo "== ไฟล์แนบหลักฐาน + ตรวจสอบย้อนหลัง (ไม่แตะที่เก็บไฟล์จริง: เช็กเฉพาะสิทธิ์/ตรวจข้อมูลก่อนถึงขั้นสร้างลิงก์)"
PRE='{"context":"return","filename":"a.jpg","contentType":"application/zip","size":10}'
code 401 "presign ไม่มี session" -H "$J" -X POST "$B/$NO/attachments/presign" -d "$PRE"
code 401 "confirm ไม่มี session" -H "$J" -X POST "$B/$NO/attachments/confirm" -d '{"id":"x"}'
code 401 "list แนบไม่มี session" "$B/$NO/attachments"
code 400 "presign ชนิดไฟล์ไม่รองรับ" -H "$R" -H "$J" -X POST "$B/$NO/attachments/presign" -d "$PRE"
code 400 "presign ผ่าน API key (ผู้ขอ) ผ่านด่านสิทธิ์ แล้วติดชนิดไฟล์" -H "x-api-key: key-one" -H "x-user: req1@menatransport.co.th" -H "$J" -X POST "$B/$NO/attachments/presign" -d "$PRE"
code 403 "presign คนอื่นที่ไม่ใช่เจ้าของใบ" -H "$R2" -H "$J" -X POST "$B/$NO/attachments/presign" -d '{"context":"return","filename":"a.jpg","contentType":"image/jpeg","size":10}'
code 403 "presign สโตร์ดูอย่างเดียว" -H "$V" -H "$J" -X POST "$B/$NO/attachments/presign" -d '{"context":"other","filename":"a.jpg","contentType":"image/jpeg","size":10}'
code 403 "list แนบ คนอื่นที่ไม่ใช่เจ้าของใบ" -H "$R2" "$B/$NO/attachments"
code 200 "list แนบ เจ้าของใบ (ยังไม่มีไฟล์)" -H "$R" "$B/$NO/attachments"
expect "items ว่าง" "d['items']==[]"
code 404 "presign ใบที่ไม่มี" -H "$R" -H "$J" -X POST "$B/SW-0000-404/attachments/presign" -d '{"context":"other","filename":"a.jpg","contentType":"image/jpeg","size":10}'
code 400 "ขอคืนแบบส่งเคลมไม่แนบไฟล์" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"reasonCode":"claim","lines":[{"lineIndex":0,"qty":1}]}'
code 400 "ขอคืนแนบไฟล์ที่ไม่มีจริง" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"reasonCode":"claim","attachmentIds":["ไม่มี"],"lines":[{"lineIndex":0,"qty":1}]}'
for m in PUT PATCH DELETE; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$R" -X $m "$B/$NO/attachments")
  if [ "$CODE" = 405 ] || [ "$CODE" = 404 ]; then ok "แก้/ลบไฟล์แนบไม่ได้ ($m $CODE)"; else bad "$m ไฟล์แนบได้ $CODE"; fi
done
AUD="$B/audit"
TODAY=$(python3 -c "import datetime;print(datetime.date.today().isoformat())")
OLD=$(python3 -c "import datetime;print((datetime.date.today()-datetime.timedelta(days=94)).isoformat())")
code 401 "audit ไม่มี session" "$AUD?from=$TODAY&to=$TODAY"
code 401 "audit รายใบไม่มี session" "$AUD/$NO"
code 401 "audit export ไม่มี session" "$AUD/export?from=$TODAY&to=$TODAY"
code 401 "audit ด้วย API key ไม่ได้ (session เท่านั้น)" -H "x-api-key: key-one" -H "x-user: req1@menatransport.co.th" "$AUD?from=$TODAY&to=$TODAY"
code 403 "audit ผู้ขอไม่มีสิทธิ์" -H "$R" "$AUD?from=$TODAY&to=$TODAY"
code 403 "audit สโตร์ (store-queue แก้ได้) ไม่ได้สิทธิ์ติดมา" -H "$S" "$AUD?from=$TODAY&to=$TODAY"
code 403 "audit รายใบ สโตร์ไม่ได้สิทธิ์" -H "$S" "$AUD/$NO"
code 403 "audit export ผู้ขอไม่มีสิทธิ์" -H "$R" "$AUD/export?from=$TODAY&to=$TODAY"
code 400 "audit ไม่ใส่ช่วงวันที่" -H "$AU" "$AUD"
code 400 "audit ช่วงเกิน 93 วัน" -H "$AU" "$AUD?from=$OLD&to=$TODAY"
code 400 "audit วันที่ผิดรูปแบบ" -H "$AU" "$AUD?from=x&to=y"
code 200 "audit ผู้มีสิทธิ์" -H "$AU" "$AUD?from=$TODAY&to=$TODAY"
expect "มีแถวของ $NO และ chainOk" "any(r['no']=='$NO' and r['chainOk'] for r in d['rows']) and d['truncated']==False"
code 200 "audit กรองด้วยเลขใบ" -H "$AU" "$AUD?from=$TODAY&to=$TODAY&q=$NO"
expect "เหลือใบเดียว" "[r['no'] for r in d['rows']]==['$NO']"
code 200 "audit รายใบ" -H "$AU" "$AUD/$NO"
expect "ไทม์ไลน์ + โซ่ log ผ่าน + ลิงก์ ATMS" "len(d['timeline'])>=5 and d['chain']['ok'] and d['atms'][0]['url'].startswith('https://www.mena-atms.com/inv/withdraw/view/id/')"
code 404 "audit รายใบที่ไม่มี" -H "$AU" "$AUD/SW-0000-404"
CODE=$(curl -s -o "$TMP/audit.xlsx" -w "%{http_code} %{content_type}" -H "$AU" "$AUD/export?from=$TODAY&to=$TODAY")
case "$CODE" in "200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ok "audit export xlsx";; *) bad "audit export: $CODE";; esac
[ "$(head -c 2 "$TMP/audit.xlsx")" = "PK" ] && ok "export เป็นไฟล์ zip/xlsx จริง" || bad "export ไม่ใช่ xlsx"
code 400 "audit export ไม่ใส่ช่วงวันที่" -H "$AU" "$AUD/export"

echo
if [ "$FAILS" = 0 ]; then echo "check-store-withdraw-api: OK"; else echo "check-store-withdraw-api: $FAILS FAILED"; tail -30 "$TMP/dev.out"; exit 1; fi
