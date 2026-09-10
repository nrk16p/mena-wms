# scripts/check-rfq-api.sh — รัน: TOKEN=$(npx tsx scripts/mint-session-token.ts) bash scripts/check-rfq-api.sh
# ต้องมี dev server ที่ :3000 (หรือ PORT ที่กำหนด) และแคตตาล็อกนำเข้าแล้ว · ใช้อู่จริงรายแรกใน vendor_approval
set -e
PORT=${PORT:-3000}
H="Cookie: next-auth.session-token=$TOKEN"; J="Content-Type: application/json"
B=http://localhost:$PORT/api/rfq; Q=http://localhost:$PORT/api/q
VENDOR=$(node -r dotenv/config -e 'require("mongodb").MongoClient.connect(process.env.MONGO_URI).then(async c=>{const v=await c.db(process.env.MONGO_DB||"master_data").collection("vendor_approval").findOne({});console.log(v.vendor);process.exit(0)})')
DL=$(date -v+14d +%F 2>/dev/null || date -d "+14 days" +%F)
echo "== no session → 401"; curl -s -o /dev/null -w "%{http_code}\n" $B | grep -q 401
echo "== catalog"; curl -s -H "$H" $B/catalog | grep -q '"sheet":"S45"'
echo "== create"; NEW=$(curl -s -H "$H" -H "$J" -X POST $B -d "{\"title\":\"ทดสอบ API\",\"deadline\":\"$DL\",\"invites\":[{\"vendor\":\"$VENDOR\",\"sheets\":[\"S45\"],\"sections\":[\"labour\",\"parts\"]}]}")
echo "$NEW" | grep -q '"ok":true'
ID=$(echo "$NEW" | sed -E 's/.*"id":"([a-f0-9]+)".*/\1/'); TK=$(echo "$NEW" | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "id=$ID token=$TK"
echo "== unknown vendor → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X POST $B -d "{\"title\":\"x\",\"deadline\":\"$DL\",\"invites\":[{\"vendor\":\"ไม่มีอู่นี้\",\"sheets\":[]}]}" | grep -q 400
echo "== public GET (no cookie) sets openedAt + SVC always"; G=$(curl -s $Q/$TK); echo "$G" | grep -q '"openedAt":"20'; echo "$G" | grep -q '"sheets":\["S45","SVC"\]'
echo "$G" | grep -q '"createdBy"' && { echo "LEAK createdBy"; exit 1; } || true
echo "== bad token → 404"; curl -s -o /dev/null -w "%{http_code}\n" $Q/AAAAAAAAAAAAAAAAAAAAAAAA | grep -q 404
echo "== items before contact → 409"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"skip"}}}' | grep -q 409
echo "== contact missing phone/email → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"contact":{"name":"ช่างเอ","confirmedVendor":true}}' | grep -q 400
echo "== contact ok → กำลังกรอก"; curl -s -H "$J" -X PATCH $Q/$TK -d '{"contact":{"name":"ช่างเอ","phone":"0812345678","email":"","confirmedVendor":true}}' | grep -q '"status":"กำลังกรอก"'
echo "== items ok"; curl -s -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"hourly","L":{"rate":450,"hours":2},"S":{},"sameAsL":true}}}' | grep -q '"saved":1'
echo "== item not in sheet → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"items":{"NOPE":{"mode":"skip"}}}' | grep -q 400
echo "== parts ok"; PK=$(curl -s $Q/$TK | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const p=j.parts.find(p=>p.sheet==="S45");process.stdout.write(p.sku)})'); curl -s -H "$J" -X PATCH $Q/$TK -d "{\"parts\":{\"S45|$PK\":{\"priceL\":1200,\"sameAsL\":true,\"brand\":\"OEM\"}}}" | grep -q '"saved":1'
echo "== submit without ack → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X POST $Q/$TK/submit -d '{}' | grep -q 400
echo "== submit"; curl -s -H "$J" -X POST $Q/$TK/submit -d '{"acknowledgeBlank":true,"submitNote":"ครบแล้ว"}' | grep -q '"status":"ส่งแล้ว"'
echo "== write after submit → 409"; curl -s -o /dev/null -w "%{http_code}\n" -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"skip"}}}' | grep -q 409
echo "== list shows answered"; curl -s -H "$H" -G "$B" --data-urlencode "q=ทดสอบ" | grep -q '"answered":{"labour":1,"parts":1}'
echo "== return (needs note) → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"return"}' | grep -q 400
echo "== return ok"; curl -s -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"return","note":"ขอราคา S ด้วย"}' | grep -q '"status":"ส่งกลับแก้"'
echo "== vendor can write again"; curl -s -H "$J" -X PATCH $Q/$TK -d '{"items":{"MXS-RLR-INS":{"mode":"skip"}}}' | grep -q '"saved":1'
echo "== resubmit"; curl -s -H "$J" -X POST $Q/$TK/submit -d '{"acknowledgeBlank":true}' | grep -q '"status":"ส่งแล้ว"'
echo "== confirm as non-approver → 403"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"confirm","validFrom":"2026-09-10","validTo":"2027-09-10"}' | grep -q 403
echo "== log ≥ 6"; test "$(curl -s -H "$H" $B/$ID/log | grep -o '"action"' | wc -l)" -ge 6
echo "== cancel as non-approver → 403"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "$J" -X PATCH $B/$ID -d '{"action":"cancel"}' | grep -q 403
echo "check-rfq-api: OK (ใบทดสอบ $ID คงไว้ในสถานะ ส่งแล้ว — ลบเองด้วย mongo ถ้าต้องการ)"
