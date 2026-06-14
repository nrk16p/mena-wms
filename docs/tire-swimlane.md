# ระบบจัดการยาง — Swimlane Flow

```zenuml
title ระบบจัดการยาง — MENA Transport

@Actor Driver as "🚛 คนขับ"
@Boundary App as "📱 App / Web"
@Control System as "⚙️ ระบบ (mena-wms)"
@Actor Admin as "🏭 Admin คลัง"
@Actor Manager as "👔 ผู้จัดการ"
@Database ATMS as "🔄 ATMS"

// ── 1. รับยางเข้า Stock ──────────────────────────────
Admin -> System.addStock("PR Code + Serial No\nราคา / ระยะมาตรฐาน") {
  return "บันทึก Stock เรียบร้อย"
}

// ── 2. คนขับขอเปลี่ยนยาง ─────────────────────────────
Driver -> App.enterVehicle("ทะเบียน + เลขไมล์ปัจจุบัน") {
  App -> System.getTires("plate, odometer") {
    return "รายการยางบนรถ\nตำแหน่ง / Serial No / % ประสิทธิภาพ"
  }
  return "แสดงยางบนรถ ⚠️ แดง = ใกล้หมด"
}

Driver -> App.selectTires("เลือกยาง + สาเหตุ + รูปถ่าย") {
  App -> System.submitRequest("items[]") {
    return "🟡 Pending — รอผู้จัดการอนุมัติ"
  }
}

// ── 3. ผู้จัดการอนุมัติ ───────────────────────────────
System -> Manager: "แจ้ง Pending Request"

Manager -> System.review("ดูรูป / ฿ต่อกม. / ประสิทธิภาพ") {
  if "อนุมัติ" {
    Manager -> System.approve("กำหนดวันนัดหมาย") {
      System -> Driver: "🔵 Approved + วันนัดหมาย"
    }
    Manager -> System.done() {
      System -> ATMS: "บันทึกการเปลี่ยนยาง"
    }
  } else {
    Manager -> System.reject("ระบุเหตุผล") {
      System -> Driver: "❌ Rejected + เหตุผล"
    }
  }
}

// ── 4. Sync ข้อมูลจาก ATMS ───────────────────────────
ATMS -> System.autoSync("ทุกวัน 02:00 UTC") {
  System -> System.updateChangeHistory()
  System -> System.updateStockStatus("Withdraw / Sold / Retreaded")
  System -> Admin: "สถานะ Stock อัปเดตแล้ว"
}

// ── 5. ตรวจสอบ Stock + ขอสั่งซื้อใหม่ ───────────────
Admin -> System.checkStock() {
  if "Stock เหลือน้อย" {
    Admin -> System.getPRReport("ล็อตก่อนหน้า") {
      return "฿/กม. จริง vs มาตรฐาน\nสาเหตุหลัก / ประสิทธิภาพ"
    }
    Admin -> Manager.sendPurchasePR("จำนวน / ยี่ห้อ / ขนาด\n+ แนบ PR Report ประกอบ") {
      if "อนุมัติ PR" {
        Manager -> Admin: "✅ อนุมัติ — ส่งฝ่ายจัดซื้อ"
        Admin -> System.receiveNewTires("Serial No ทุกเส้น\nPR Code ใหม่") {
          return "🟢 Stock พร้อมใช้งาน"
        }
      } else {
        Manager -> Admin: "❌ ปรับแก้ + เหตุผล"
      }
    }
  }
}
```

---

## สรุปบทบาทแต่ละเลน

| เลน | หน้าที่ | หน้าเว็บ |
|-----|---------|---------|
| 🏭 Admin คลัง | รับยาง · บันทึก Stock · ตรวจ Stock ต่ำ · สร้าง PR ขอซื้อ | `/stock-tire` |
| 🚛 คนขับ | ขอเปลี่ยนยาง · แนบรูป · รับผลอนุมัติ | `/change-tire-request` |
| 👔 ผู้จัดการ | อนุมัติเปลี่ยนยาง · อนุมัติ PR ขอซื้อยางใหม่ | `/requests` |
| ⚙️ ระบบ / ATMS | Sync อัตโนมัติ · อัปเดตประวัติ + สถานะ Stock | `/change-history` |
