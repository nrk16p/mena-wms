# scripts/check-price-compare-api.sh — รัน: TOKEN=<cookie> bash scripts/check-price-compare-api.sh
set -e
H="Cookie: next-auth.session-token=$TOKEN"
B=http://localhost:3000/api/price-compare
echo "== no session → 401"; curl -s -o /dev/null -w "%{http_code}\n" $B | grep -q 401
echo "== create"; NEW=$(curl -s -H "$H" -H "Content-Type: application/json" -X POST $B -d '{"title":"ทดสอบ API"}')
echo "$NEW" | grep -q '"docNo":"PC-'
ID=$(echo "$NEW" | sed -E 's/.*"_id":"([a-f0-9]+)".*/\1/')
DOCNO=$(echo "$NEW" | sed -E 's/.*"docNo":"([^"]+)".*/\1/')
echo "id=$ID docNo=$DOCNO"
echo "== get by docNo"; curl -s -H "$H" $B/$DOCNO | grep -q '"title":"ทดสอบ API"'
echo "== get by ObjectId (fallback)"; curl -s -H "$H" $B/$ID | grep -q '"title":"ทดสอบ API"'
echo "== put invalid (qty 0) → 400"
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "Content-Type: application/json" -X PUT $B/$DOCNO -d '{"title":"x","items":[{"name":"a","qty":0,"unit":"ชิ้น"}],"suppliers":[{"name":"s","prices":[1]}]}' | grep -q 400
echo "== put ok"
curl -s -H "$H" -H "Content-Type: application/json" -X PUT $B/$DOCNO -d '{"title":"แก้แล้ว","items":[{"name":"a","qty":2,"unit":"ชิ้น"}],"suppliers":[{"name":"s1","prices":[100]},{"name":"s2","prices":[90]}],"selectedSupplier":2,"status":"ร่าง"}' | grep -q '"title":"แก้แล้ว"'
echo "== status ร่าง→รอลงนาม"
curl -s -H "$H" -H "Content-Type: application/json" -X PUT $B/$DOCNO -d '{"title":"แก้แล้ว","items":[{"name":"a","qty":2,"unit":"ชิ้น"}],"suppliers":[{"name":"s1","prices":[100]},{"name":"s2","prices":[90]}],"selectedSupplier":2,"fewerQuotesReason":"ทดสอบ 2 ราย","status":"รอลงนาม"}' | grep -q '"status":"รอลงนาม"'
echo "== delete non-draft → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -X DELETE $B/$DOCNO | grep -q 400
echo "== back to draft"
curl -s -H "$H" -H "Content-Type: application/json" -X PUT $B/$DOCNO -d '{"title":"แก้แล้ว","items":[{"name":"a","qty":2,"unit":"ชิ้น"}],"suppliers":[{"name":"s1","prices":[100]},{"name":"s2","prices":[90]}],"selectedSupplier":2,"status":"ร่าง"}' >/dev/null
echo "== log has ≥4 entries (เช็คก่อนลบ — log route ต้อง resolve doc ก่อน query จึงใช้ไม่ได้กับใบที่ลบแล้ว)"
test "$(curl -s -H "$H" $B/$DOCNO/log | grep -o '"action"' | wc -l)" -ge 4
echo "== delete"; curl -s -H "$H" -X DELETE $B/$DOCNO | grep -q '"ok":true'
echo "== unknown docNo → 404"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" $B/PC-0000-000 | grep -q 404
echo "== not a key (bad id) → 400"; curl -s -o /dev/null -w "%{http_code}\n" -H "$H" $B/not-a-key | grep -q 400

# หมายเหตุ: ใช้ -G --data-urlencode เพราะคำค้นเป็นภาษาไทย (UTF-8 หลายไบต์) — curl ที่ใส่ต่อท้าย URL ตรงๆ
# ไม่เข้ารหัส %XX ให้เอง ทำให้ HTTP parser ของ Next.js ปฏิเสธเป็น 400 ก่อนถึงโค้ดแอปเลย (คนละสาเหตุกับ session)
echo "== sku-search: no session → 401"; curl -s -o /dev/null -w "%{http_code}\n" -G --data-urlencode "q=น้ำมัน" "$B/sku-search" | grep -q 401
echo "== sku-search: q=น้ำมัน → 200, ≤20 แถว, ไม่มี code ซ้ำ"
SKU_RES=$(curl -s -H "$H" -G --data-urlencode "q=น้ำมัน" "$B/sku-search")
echo "$SKU_RES" | python3 -c "
import json,sys
rows = json.load(sys.stdin)
assert isinstance(rows, list), 'ต้องเป็น array'
assert len(rows) <= 20, f'เกิน 20 แถว: {len(rows)}'
codes = [r['code'] for r in rows]
assert len(codes) == len(set(codes)), 'มี code ซ้ำ'
for r in rows:
    assert r['code'] != '-', 'ต้องตัด code \"-\" ออก'
print(f'ok: {len(rows)} rows')
"
echo "== sku-search: q สั้นกว่า 2 ตัว → 200 []"; curl -s -H "$H" -G --data-urlencode "q=x" "$B/sku-search" | grep -q '^\[\]$'

# ใบ seed โหมดผสม (สร้างด้วย node scripts/seed-price-compare-uh03.mjs --mixed) — ถ้าไม่มีก็ข้าม ไม่ seed เอง
echo "== mixed list row (PC-2609-999)"
MIXED_ROW=$(curl -s -H "$H" -G --data-urlencode "q=PC-2609-999" "$B")
if echo "$MIXED_ROW" | grep -q '"docNo":"PC-2609-999"'; then
  echo "$MIXED_ROW" | python3 -c "
import json,sys
rows = [r for r in json.load(sys.stdin) if r['docNo'] == 'PC-2609-999']
assert len(rows) == 1, f'ต้องเจอใบเดียว: {len(rows)}'
r = rows[0]
assert r['selectedName'] == 'ผสม 3 เจ้า', f\"selectedName ผิด: {r['selectedName']}\"
assert r['selectedNet'] == 50076, f\"selectedNet ผิด: {r['selectedNet']}\"
assert r['selectedSupplier'] is None, f\"selectedSupplier ต้องเป็น null: {r['selectedSupplier']}\"
print('ok: mixed row')
"
else
  echo "skip mixed-list check"
fi
echo "check-price-compare-api: OK"
