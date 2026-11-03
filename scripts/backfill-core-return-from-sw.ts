// scripts/backfill-core-return-from-sw.ts — เก็บตกแถว "รอคืนซาก" ของใบเบิก WMS ที่ได้ WD แล้ว (ISSUED/RECEIVED/SETTLED)
// ใช้เมื่อ log ฝั่งเซิร์ฟเวอร์มี "[core-return] สร้างแถวรอคืนซากไม่สำเร็จ" · รันซ้ำได้ ไม่สร้างซ้ำ ไม่ทับสถานะที่บันทึกแล้ว
//   MONGO_URI=... npx tsx scripts/backfill-core-return-from-sw.ts --since=2026-11-01             # ทดลอง: นับอย่างเดียว ไม่เขียน
//   MONGO_URI=... npx tsx scripts/backfill-core-return-from-sw.ts --since=2026-11-01 --execute   # เขียนจริง (คนกดเอง)
// อ่านใบตามช่วง updatedAt (มี index createdAt/updatedAt ฝั่งใบเบิก) ทีละ 200 ใบ เว้นจังหวะ กันคลัสเตอร์สะดุด
import { MongoClient } from "mongodb"

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1]
const EXECUTE = process.argv.includes("--execute")
const since = arg("since")
if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("ต้องระบุ --since=YYYY-MM-DD (จำกัดช่วง ไม่ไล่ทั้งคอลเลกชัน)")
if (!process.env.MONGO_URI) throw new Error("ตั้ง MONGO_URI ก่อน")

void (async () => {
  const client = new MongoClient(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  try {
    const { setStoreWithdrawClient, swCol } = await import("../lib/store-withdraw/db")
    const { planCoreRows, syncCoreRowsForRequest } = await import("../lib/core-return/sw-sync")
    const { baseCol } = await import("../lib/core-return/db")
    setStoreWithdrawClient(client)
    const actor = { email: "backfill@menatransport.co.th", name: "เก็บตกแถวซาก", via: "api" as const }
    const cur = (await swCol()).find({ status: { $in: ["ISSUED", "RECEIVED", "SETTLED"] }, createdAt: { $gte: new Date(since + "T00:00:00+07:00") } }).sort({ createdAt: 1 }).batchSize(200)
    let reqs = 0, planned = 0, missing = 0, created = 0
    for await (const r of cur) {
      reqs++
      const plan = planCoreRows(r)
      planned += plan.length
      const have = plan.length ? await (await baseCol()).countDocuments({ row_key: { $in: plan.map((p) => p.row_key) } }) : 0
      missing += plan.length - have
      if (EXECUTE && plan.length > have) created += (await syncCoreRowsForRequest(r, actor)).created
      if (reqs % 200 === 0) await new Promise((res) => setTimeout(res, 500))
    }
    console.log(`ใบ ${reqs} · แถวที่ควรมี ${planned} · ยังขาด ${missing}${EXECUTE ? ` · สร้างแล้ว ${created}` : " · โหมดทดลอง ยังไม่เขียน (ใส่ --execute)"}`)
  } finally {
    await client.close()
  }
})().catch((e) => { console.error(e); process.exit(1) })
