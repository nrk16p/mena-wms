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
npx tsx scripts/store-withdraw-test-infra.ts "$TMP/infra.json" "$TMP/ncac-calls.log" > "$TMP/infra.out" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do [ -f "$TMP/infra.json" ] && break; sleep 1; done
[ -f "$TMP/infra.json" ] || { echo "infra ไม่ขึ้น"; cat "$TMP/infra.out"; exit 1; }
MONGO_URI=$(python3 -c "import json;print(json.load(open('$TMP/infra.json'))['mongoUri'])")
NCAC_BASE=$(python3 -c "import json;print(json.load(open('$TMP/infra.json'))['ncacBase'])")

echo "== เปิด next dev :$PORT"
MONGO_URI="$MONGO_URI" MONGO_DB=master_data STORE_WITHDRAW_DB=sw_api_test NCAC_BASE="$NCAC_BASE" NCAC_API_KEY=k-test \
  ATMS_LOOKUP_USERNAME=svc ATMS_LOOKUP_PASSWORD=svcpw STORE_ATMS_CRED_KEY=$(python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())") \
  STORE_WITHDRAW_API_KEYS="key-one,key-two" NEXTAUTH_URL="http://localhost:$PORT" NEXTAUTH_SECRET="$SECRET" \
  npx next dev -p $PORT > "$TMP/dev.out" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 90); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done

REQ_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"req1@menatransport.co.th","name":"ผู้ขอ","employee":{"username":"req1","department":"ยานยนต์","position":"ช่าง"}}' | tail -1)
REQ2_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"req2@menatransport.co.th","name":"ผู้ขออีกคน","employee":{"username":"req2","department":"ยานยนต์","position":"ช่าง"}}' | tail -1)
# accessAt = เพิ่งรีเฟรชสิทธิ์ → route ไม่ไปอ่าน override จาก DB ทับ (ในระบบจริง token มี accessAt หลัง login เสมอ)
NOW_MS=$(python3 -c "import time;print(int(time.time()*1000))")
VIEW_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"viewer@menatransport.co.th","name":"ดูอย่างเดียว","employee":{"username":"viewer","department":"Store","position":"สโตร์"},"accessOverrides":{"store-queue":"view"},"accessAt":'$NOW_MS'}' | tail -1)
STORE_TOKEN=$(npx tsx scripts/mint-session-token.ts '{"email":"store1@menatransport.co.th","name":"สโตร์ 1","employee":{"username":"store1","department":"Store","position":"สโตร์"},"accessOverrides":{"store-queue":"edit"},"accessAt":'$NOW_MS'}' | tail -1)
R="Cookie: next-auth.session-token=$REQ_TOKEN"
R2="Cookie: next-auth.session-token=$REQ2_TOKEN"
S="Cookie: next-auth.session-token=$STORE_TOKEN"
V="Cookie: next-auth.session-token=$VIEW_TOKEN"
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
code 400 "lookup kind ผิด" -H "$R" "$B/lookup/bogus?q=x"
code 200 "lookup cutoff" -H "$R" "$B/lookup/cutoff?mr=MR-1&inv=4"
expect "cutoff คืน lines เป็น list" "isinstance(d['lines'],list)"

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
expect "ใบอยู่ช่อง NEW และยังไม่ผูกบัญชี = atmsKeyed ว่าง" "any(r['no']=='$NO' for r in d['columns']['NEW']) and d['atmsKeyed']==[]"
code 200 "live-stock (ncac จำลอง)" -H "$S" "$B/live-stock?inv=4&items=OIL-001:501,FLT-002:502"
expect "สต๊อกสด 7 (live) + สำเนา 3 (ไม่ live)" "d['stock']['OIL-001']=={'qty':7,'live':True} and d['stock']['FLT-002']=={'qty':3,'live':False}"

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

echo "== cancel / claim / lines / ready / issue"
code 403 "คนอื่นยกเลิกใบไม่ได้" -H "$R2" -X POST "$B/$NO/cancel"
code 200 "claim" -H "$S" -X POST "$B/$NO/claim"
expect "PREPARING + claimedBy" "d['request']['status']=='PREPARING' and d['request']['claimedBy']['email']=='store1@menatransport.co.th'"
code 409 "cancel หลัง claim" -H "$R" -X POST "$B/$NO/cancel"
code 409 "claim ซ้ำ" -H "$S" -X POST "$B/$NO/claim"
code 400 "แก้จำนวนเกินที่ขอ" -H "$S" -H "$J" -X PATCH "$B/$NO/lines" -d '{"lines":[{"index":0,"issuedQty":9,"short":false}]}'
code 200 "แก้จำนวนจ่าย" -H "$S" -H "$J" -X PATCH "$B/$NO/lines" -d '{"lines":[{"index":0,"issuedQty":4,"short":true},{"index":1,"issuedQty":1,"short":false}]}'
expect "issuedQty=4 short" "d['request']['lines'][0]['issuedQty']==4 and d['request']['lines'][0]['short']==True"
code 400 "ปฏิเสธต้องมีเหตุผล" -H "$S" -H "$J" -X POST "$B/$NO/reject" -d '{}'
code 409 "issue ก่อน ready" -H "$S" -X POST "$B/$NO/issue"
code 200 "ready" -H "$S" -X POST "$B/$NO/ready"
code 409 "แก้บรรทัดหลัง ready" -H "$S" -H "$J" -X PATCH "$B/$NO/lines" -d '{"lines":[{"index":0,"issuedQty":1,"short":false}]}'

echo "== x-api-key"
code 201 "api-key สร้าง" -H "x-api-key: key-two" -H "x-user: ext.user@menatransport.co.th" -H "$J" -X POST "$B" -d "$BODY"
APINO=$(jget "d['no']")
code 200 "api-key ดูรายละเอียด" -H "x-api-key: key-two" -H "x-user: ext.user@menatransport.co.th" "$B/$APINO"
expect "via=api และ requestedBy จาก x-user" "d['request']['requestedBy']['via']=='api' and d['request']['requestedBy']['email']=='ext.user@menatransport.co.th'"
code 400 "api-key ไม่มี x-user" -H "x-api-key: key-one" -H "$J" -X POST "$B" -d "$BODY"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" -X POST "$B/$NO/issue")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then ok "api-key issue ถูกปฏิเสธ ($CODE)"; else bad "api-key issue ได้ $CODE"; fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: wrong" -H "x-user: a@b.c" -H "$J" -X POST "$B" -d "$BODY")
if [ "$CODE" = 401 ]; then ok "api-key ผิด 401"; else bad "api-key ผิดได้ $CODE"; fi
code 200 "api-key ยกเลิกใบตัวเอง" -H "x-api-key: key-two" -H "x-user: ext.user@menatransport.co.th" -X POST "$B/$APINO/cancel"

echo "== issue (ncac จำลอง)"
code 200 "issue" -H "$S" -X POST "$B/$NO/issue"
expect "ISSUED + เลข WD" "d['request']['status']=='ISSUED' and d['request']['atms']['code']=='LBWD-9001'"
grep -q "POST /atms/withdraw/issue user=store1" "$TMP/ncac-calls.log" && ok "ยิง ncac ด้วยบัญชีสโตร์" || bad "ไม่เห็นการยิง ncac ของสโตร์"
code 409 "issue ซ้ำ" -H "$S" -X POST "$B/$NO/issue"
code 200 "queue หลังมี gmId: ตัดแถว 9001 ออก" -H "$S" "$B/queue?inv=4"
expect "atmsKeyed เหลือเฉพาะ 8123" "[x['id'] for x in d['atmsKeyed']]==[8123]"

echo "== receive / returns / accept"
code 403 "คนอื่นกดรับแทนไม่ได้" -H "$R2" -X POST "$B/$NO/receive"
code 200 "receive" -H "$R" -X POST "$B/$NO/receive"
expect "RECEIVED" "d['request']['status']=='RECEIVED'"
code 409 "คืนเกินที่จ่าย (4)" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"lines":[{"lineIndex":0,"qty":5}]}'
code 201 "ขอคืน 1" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"lines":[{"lineIndex":0,"qty":1}]}'
RID=$(jget "d['rid']")
code 409 "ขอคืนซ้อนเกินคงเหลือ (3+1>4)" -H "$R" -H "$J" -X POST "$B/$NO/returns" -d '{"lines":[{"lineIndex":0,"qty":4}]}'
code 200 "queue เห็นใบคืนช่อง NEW" -H "$S" "$B/queue?inv=4"
expect "ใบคืนอยู่ NEW และใบเดิมอยู่ DONE_TODAY" "any(r.get('itemType')=='return' for r in d['columns']['NEW']) and any(r['no']=='$NO' for r in d['columns']['DONE_TODAY'])"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: key-one" -H "x-user: ext.user@menatransport.co.th" -X POST "$B/$NO/returns/$RID/accept")
if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then ok "api-key accept ถูกปฏิเสธ ($CODE)"; else bad "api-key accept ได้ $CODE"; fi
code 200 "accept คืน" -H "$S" -X POST "$B/$NO/returns/$RID/accept"
expect "RETURNED + returnedQty=1" "d['request']['returns'][0]['status']=='RETURNED' and d['request']['lines'][0]['returnedQty']==1"
code 200 "log" -H "$R" "$B/$NO"
expect "log มีหลายรายการ" "len(d['log'])>=5"

echo
if [ "$FAILS" = 0 ]; then echo "check-store-withdraw-api: OK"; else echo "check-store-withdraw-api: $FAILS FAILED"; tail -30 "$TMP/dev.out"; exit 1; fi
