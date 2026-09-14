"""เติม atms.drivercost_tail ย้อนหลังจากรายงาน ATMS "ค่าเที่ยว พจส." + สรุปลง truck_distance_summary

    python3 backfill_drivercost.py inspect 2023 08     # โหลดมาดูคอลัมน์อย่างเดียว ไม่เขียน DB
    python3 backfill_drivercost.py load 2023 08 12     # โหลด+เขียน drivercost_tail ช่วงเดือน
    python3 backfill_drivercost.py summary 2023 08 12  # สรุปลง truck_distance_summary
"""
import io, os, re, sys, warnings
from pathlib import Path
import pandas as pd, requests, urllib3
from pymongo import MongoClient, UpdateOne

warnings.simplefilter("ignore", urllib3.exceptions.InsecureRequestWarning)
BASE = "https://www.mena-atms.com"

env = {}
for line in Path("/Users/menatransport_02/Documents/project/ncac/api-ncac/scripts/.env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip().strip('"').strip("'")
MONGO_URI = env["MONGODB_URI"]


def login():
    s = requests.Session()
    s.post(f"{BASE}/account/user/login",
           data={"username": env["ATMS_USERNAME"], "password": env["ATMS_PASSWORD"], "submit": "login", "next": ""},
           verify=False, timeout=60).raise_for_status()
    return s


def list_files(s, year, month):
    """ไฟล์รายสาขาของเดือนนั้น — หน้า index แสดงหลายหน้า ไล่จนไม่เจอของใหม่"""
    out, page = {}, 1
    while page <= 5:
        p = {"type": "monthly-driver-cost", "use_as": "batch-report", "ref_id": 1,
             "year": year, "month": f"{month:02d}", "search_fields": "year,month",
             "order_by": "f.seq desc", "page": page}
        r = s.get(f"{BASE}/cms/file/index", params=p, verify=False, timeout=90)
        t = re.search(r"<table.*?</table>", r.text, re.S)
        if not t: break
        new = False
        for row in re.findall(r"<tr.*?</tr>", t.group(0), re.S):
            dl = re.search(r'href="/cms/file/download/id/(\d+)"', row)
            if not dl: continue
            fid = int(dl.group(1))
            if fid in out: continue
            text = re.sub(r"<[^>]+>", "|", row)
            m = re.search(r"ค่าเที่ยว พจส\.\s*:\s*(.+?)\s+on\s+(\d{4})-(\d{2})", text)
            if not m: continue
            if int(m.group(2)) != year or int(m.group(3)) != month: continue
            out[fid] = m.group(1).strip(); new = True
        if not new: break
        page += 1
    return out


def read_file(s, fid):
    r = s.get(f"{BASE}/cms/file/download/id/{fid}", verify=False, timeout=180)
    r.raise_for_status()
    return pd.read_excel(io.BytesIO(r.content), sheet_name=0, dtype=str, skiprows=1)


SUM_COLS = ['ตีเปล่า', 'ระยะทางรถหนัก', 'ขึ้นเขาหนัก', 'ขึ้นเขาสูงหนัก',
            'สำรอง', 'ระยะทางรถเบา', 'ขึ้นเขาเบา', 'ขึ้นเขาสูงเบา']


def cmd_inspect(year, month):
    s = login()
    files = list_files(s, year, month)
    print(f"{year}-{month:02d}: {len(files)} ไฟล์ → {list(files.values())}")
    for fid, branch in files.items():
        df = read_file(s, fid)
        print(f"\n--- file {fid} ({branch}) : {len(df)} แถว ---")
        print("คอลัมน์:", list(df.columns)[:40])
        miss = [c for c in SUM_COLS + ['ออก LDT', 'หัว', 'หาง', 'ประเภทรถร่วม'] if c not in df.columns]
        print("คอลัมน์ที่ขาด:", miss if miss else "(ครบ)")
        print(df[[c for c in ['ออก LDT','หัว','หาง','ประเภทรถร่วม'] + SUM_COLS if c in df.columns]].head(3).to_string())
        break


def cmd_load(year, m1, m2):
    s, cli = login(), MongoClient(MONGO_URI)
    col = cli["atms"]["drivercost_tail"]
    for month in range(m1, m2 + 1):
        files = list_files(s, year, month)
        mmyy = f"{month:02d}/{year}"
        frames = []
        for fid in files:
            df = read_file(s, fid)
            df["year"], df["month"], df["mmyy"] = str(year), f"{month:02d}", mmyy
            frames.append(df)
        if not frames:
            print(f"{mmyy}: ไม่มีไฟล์ ข้าม"); continue
        allrows = pd.concat(frames, ignore_index=True)
        existing = col.count_documents({"mmyy": mmyy})
        if existing:
            print(f"{mmyy}: มีอยู่แล้ว {existing} แถว → ลบก่อนเขียนใหม่")
            col.delete_many({"mmyy": mmyy})
        recs = allrows.where(pd.notna(allrows), None).to_dict("records")
        for i in range(0, len(recs), 2000):
            col.insert_many(recs[i:i + 2000], ordered=False)
        print(f"{mmyy}: เขียน {len(recs)} แถว จาก {len(files)} ไฟล์")
    cli.close()


def cmd_summary(year, m1, m2):
    """สูตรเดียวกับ driver_cost_etl/transform_summary.py — รวมทุกช่องระยะ แยก head/tail"""
    cli = MongoClient(MONGO_URI)
    src, dst = cli["atms"]["drivercost_tail"], cli["atms"]["truck_distance_summary"]
    for month in range(m1, m2 + 1):
        mmyy = f"{month:02d}/{year}"
        proj = {"_id": 0, "ออก LDT": 1, "ประเภทรถร่วม": 1, "หัว": 1, "หาง": 1, **{c: 1 for c in SUM_COLS}}
        df = pd.DataFrame(list(src.find({"mmyy": mmyy}, proj)))
        if df.empty:
            print(f"{mmyy}: ไม่มีข้อมูลใน drivercost_tail"); continue
        df["ออก LDT"] = pd.to_datetime(df["ออก LDT"], dayfirst=True, errors="coerce")
        df["month_year"] = df["ออก LDT"].dt.strftime("%Y-%m")
        df = df.dropna(subset=["month_year"])
        for c in SUM_COLS:
            if c not in df.columns: df[c] = 0
        df[SUM_COLS] = df[SUM_COLS].apply(pd.to_numeric, errors="coerce").fillna(0)

        parts = []
        for col_name, kind in (("หัว", "head"), ("หาง", "tail")):
            g = df.dropna(subset=[col_name]).groupby(["month_year", "ประเภทรถร่วม", col_name], as_index=False)[SUM_COLS].sum()
            if g.empty: continue
            g["total_distance"] = g[SUM_COLS].sum(axis=1)
            g = g[["month_year", "ประเภทรถร่วม", col_name, "total_distance"]].rename(columns={col_name: "plate"})
            g["type"] = kind
            parts.append(g)
        if not parts:
            print(f"{mmyy}: ไม่มีแถวที่จัดกลุ่มได้"); continue
        out = pd.concat(parts, ignore_index=True).rename(columns={"ประเภทรถร่วม": "vehicle_type"})
        out["updated_at"] = pd.Timestamp.utcnow()
        ops = [UpdateOne({"month_year": r["month_year"], "plate": r["plate"], "type": r["type"]},
                         {"$set": r}, upsert=True) for r in out.to_dict("records")]
        res = dst.bulk_write(ops, ordered=False)
        print(f"{mmyy}: สรุป {len(ops)} แถว (เพิ่ม {res.upserted_count} / แก้ {res.modified_count}) "
              f"เดือนปลายทาง: {sorted(out['month_year'].unique())}")
    cli.close()


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "inspect":  cmd_inspect(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "load":   cmd_load(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    elif cmd == "summary":cmd_summary(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
