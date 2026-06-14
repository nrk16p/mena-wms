# ระบบจัดการยาง — Swimlane Flow

```mermaid
flowchart TD

    subgraph ADMIN ["🏭  Admin คลัง  (/stock-tire)"]
        direction LR
        A1["รับยางเข้า\nบันทึก Stock\nPR Code + Serial No\nราคา / ระยะมาตรฐาน"]
        A2["ตรวจสอบ Stock\nคงเหลือ / Withdraw\nมูลค่ารวม"]
        A3["ดู PR Report\n฿/กม. จริง vs มาตรฐาน\nสาเหตุ / ประสิทธิภาพ\nใช้ประกอบสั่งซื้อรอบถัดไป"]
        A1 --> A2
    end

    subgraph DRIVER ["🚛  คนขับ  (/change-tire-request)"]
        direction LR
        D1["พบปัญหายาง"]
        D2["กรอกทะเบียน\n+ เลขไมล์ปัจจุบัน"]
        D3["ระบบแสดงยางบนรถ\nตำแหน่ง / Serial No\n% ประสิทธิภาพคงเหลือ\n⚠ แดง = ใกล้หมด"]
        D4["เลือกยางที่ต้องเปลี่ยน\nกรอกสาเหตุ\nแนบรูปถ่าย ≤ 2 รูป/เส้น"]
        D5(["ส่งคำขอ\n📱 Mobile / 💻 Web"])
        D9(["รับแจ้งผล\nอนุมัติ + วันนัดหมาย"])
        D1 --> D2 --> D3 --> D4 --> D5
    end

    subgraph MANAGER ["👔  ผู้จัดการ  (/requests)"]
        direction LR
        M1["รับคำขอ\n🟡 Pending"]
        M2["ตรวจสอบข้อมูล\nรูปถ่าย / ฿ต่อกม.\nประสิทธิภาพ\nประวัติยางเส้นนั้น"]
        M3{"อนุมัติ?"}
        M4["🔵 Approved\nกำหนดวันนัดหมาย\nเข้าเปลี่ยนยาง"]
        M5["🟢 Done\nปิดงาน"]
        M6["❌ Rejected\nระบุเหตุผล"]
        M1 --> M2 --> M3
        M3 -->|"✅ ใช่"| M4 --> M5
        M3 -->|"❌ ไม่"| M6
    end

    subgraph SYSTEM ["⚙️  ระบบ / ATMS  (/change-history)"]
        direction LR
        S1(["Sync อัตโนมัติ\nทุกวัน 02:00\nหรือกด Manual"])
        S2["อัปเดต\nChange History\nประวัติยางรายเส้น"]
        S3["อัปเดต\nStock Status\nIn Stock / Withdraw / Sold"]
        S1 --> S2 --> S3
    end

    %% Cross-lane connections
    A1                -->|"ยางพร้อมใช้ใน Stock"| D3
    D5                -->|"คำขอใหม่"| M1
    M4                -->|"แจ้งผล + วันนัดหมาย"| D9
    M6                -->|"แจ้งผลปฏิเสธ"| D9
    M5                -->|"บันทึกใน ATMS"| S1
    S3                -->|"สถานะอัปเดต"| A2
    S3                -->|"ข้อมูลครบล็อต"| A3
```

---

## สรุปบทบาทแต่ละเลน

| เลน | หน้าที่ | หน้าเว็บ |
|-----|---------|---------|
| 🏭 Admin คลัง | รับยาง บันทึก Stock วิเคราะห์ PR Report | `/stock-tire` |
| 🚛 คนขับ | ขอเปลี่ยนยาง แนบรูป รับผลอนุมัติ | `/change-tire-request` |
| 👔 ผู้จัดการ | อนุมัติ/ปฏิเสธ นัดหมาย ปิดงาน | `/requests` |
| ⚙️ ระบบ / ATMS | Sync ข้อมูลอัตโนมัติ อัปเดตประวัติ + สถานะ Stock | `/change-history` |
