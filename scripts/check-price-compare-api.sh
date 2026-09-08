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
echo "check-price-compare-api: OK"
