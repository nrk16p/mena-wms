# Handoff: Mena WMS — รีดีไซน์ทั้งระบบ (แนวทาง A · "น้องกล่องนำทาง")

ส่งให้ Claude Code นำไปลงมือทำจริงในโค้ด Next.js เดิม (`mena-wms/`)

---

## 1. ภาพรวม (Overview)

รีดีไซน์ UI ของ **Mena WMS** (ระบบจัดการคลังอะไหล่ + ยาง ของ Mena Transport) ใหม่ทั้งระบบ
ตามทิศทาง **"แนวทาง A — น้องกล่องนำทาง"**: ขาวสะอาดเป็นหลัก · เขียว MENA เฉพาะปุ่ม/ไฮไลต์ ·
มาสคอต **"น้องกล่อง"** + ภาพประกอบ flat 2D น่ารัก · โทนเป็นมิตร มน อบอุ่น · **ไม่ปรับหน้า Login**

เป้าหมาย: ระบบที่ minimal, ใช้งานง่าย, ไม่ดูเหมือน template สำเร็จรูป/งาน AI

---

## 2. เกี่ยวกับไฟล์ดีไซน์ในชุดนี้ (About the design files)

ไฟล์ `.dc.html` ในชุดนี้เป็น **ภาพรีเฟอเรนซ์ที่สร้างด้วย HTML** — เป็นต้นแบบ (prototype) ที่แสดง
"หน้าตาและพฤติกรรมที่ต้องการ" **ไม่ใช่โค้ดโปรดักชันที่ก๊อปไปวางได้ตรงๆ**

งานของผู้พัฒนาคือ **นำดีไซน์เหล่านี้ไปทำใหม่ในโค้ดเดิม** (Next.js + React + Tailwind v4 + shadcn ที่มีอยู่แล้วใน `mena-wms/`)
โดยใช้ pattern/ไลบรารีที่โปรเจกต์ใช้อยู่ — โครงสร้างฟังก์ชัน/การดึงข้อมูลของแต่ละหน้ามีอยู่ครบแล้ว
**โจทย์คือ "เปลี่ยนสไตล์" (restyle) ไม่ใช่เขียนฟีเจอร์ใหม่**

> เปิดไฟล์ `.dc.html` ด้วยเบราว์เซอร์ได้ตรงๆ เพื่อดูภาพ/แอนิเมชันจริง

---

## 3. ระดับความละเอียด (Fidelity): **Hi-fi**

เป็น mockup ความละเอียดสูง — สี / ฟอนต์ / ระยะ / รัศมีมุม เป็นค่าจริงที่ต้องการให้ตรง
ให้ผู้พัฒนา **ทำตามให้ใกล้เคียงที่สุด** โดยใช้คอมโพเนนต์/utility เดิมของโปรเจกต์ (อย่าสร้าง CSS ระบบใหม่ทับ Tailwind)

ส่วนหน้าที่ยังไม่ได้ทำเป็น mockup เต็ม (SKU list, Add SKU, สต็อกยาง, คำขอ/อนุมัติเปลี่ยนยาง)
ให้ยึด **"ระบบดีไซน์" ในข้อ 6** + **pattern คอมโพเนนต์ในข้อ 7** ไปปรับใช้กับไฟล์เดิม (ดู mapping ข้อ 9)

---

## 4. ไฟล์ในชุดนี้ (Files)

| ไฟล์ | คืออะไร |
|---|---|
| `Mena WMS Direction A.dc.html` | **รีเฟอเรนซ์หลัก** — App shell (Sidebar + Navbar) + Dashboard เต็มจอ ขนาดจริง 1320×868 |
| `Mena WMS Directions.dc.html` | แคนวาสเทียบ 3 แนว (A/B/C) — เก็บไว้ดูที่มา; **เลือกใช้แนว A** เท่านั้น |
| `assets/nong-glong.svg` | มาสคอตน้องกล่อง (นิ่ง) |
| `assets/nong-glong-wave.svg` | มาสคอตน้องกล่อง (โบกมือ + แอนิเมชัน CSS ในตัว) |

---

## 5. ขอบเขตหน้าจอที่รีดีไซน์ (Screens in scope)

1. **โครงหลัก: Sidebar + Navbar** (ใช้ทุกหน้า ยกเว้น Login/Presentation)
2. **หน้าหลัก / Dashboard**
3. **รายการ SKU** (ตาราง + ค้นหา/กรอง)
4. **เพิ่ม SKU ใหม่** (ฟอร์ม)
5. **สต็อกยาง**
6. **คำขอเปลี่ยนยาง / อนุมัติเปลี่ยนยาง**

> หน้า 2 ทำเป็น mockup เต็มแล้ว · หน้า 1 อยู่ในรีเฟอเรนซ์เดียวกัน · หน้า 3–6 ให้สร้างตามระบบ+pattern

---

## 6. ระบบดีไซน์ / Design Tokens

### 6.1 สี (Colors)

| Token | Hex | ใช้กับ |
|---|---|---|
| `primary` (Mena green) | `#1B8C4B` | ปุ่มหลัก, เมนู active, ไอคอนเด่น, ไฮไลต์ |
| `primary-dark` | `#0F6A3C` | hover ของปุ่มหลัก, ตัวอักษรเขียวเข้ม |
| `ink` (ตัวอักษรหลัก) | `#14271C` | หัวข้อ/ข้อความหลัก (ดำอมเขียว) |
| `muted` | `#6B7C72` | ข้อความรอง |
| `muted-2` | `#9AA8A0` | caption, meta, placeholder |
| `mint` | `#EAF6EE` | พื้นไอคอนชิป, แถบ active อ่อน |
| `mint-2` | `#F0FDF4` | hover เมนู, พื้น group header |
| `canvas` | `#F6FAF7` | พื้นหลัง main content (มี dot grid) |
| `card` | `#FFFFFF` | การ์ด/แผง |
| `border` | `#EEF2F0` | เส้นขอบการ์ด/เส้นแบ่ง (อ่อนมาก) |
| `border-2` | `#F2F6F4` / `#F4F7F5` | เส้นแบ่งภายในตาราง |
| `warning` (รออนุมัติ) | `#E8A317` | badge/ตัวเลข "รออนุมัติ", สถานะ pending |
| `warning-bg` | `#FDF3DD` / `#FFFBEB` | พื้นชิป/เมนู pending |
| `kraft` (มาสคอต) | `#ECCA99` body · `#DAB686` flaps · `#D3A96F` เส้นพับ |
| `blush` | `#F3A98F` (opacity .55) | แก้มมาสคอต |

**สีประเภท SKU (badge):** PRT `#1D4ED8`/bg`#DBEAFE` · PM `#15803D`/bg`#DCFCE7` · LAB `#A16207`/bg`#FEF9C3` · SVC `#C2410C`/bg`#FFEDD5` · CLN `#7C3AED`/bg`#F3E8FF`
> โทนหลักคือ "ขาว + เขียวเป็น accent" — **อย่าใช้เขียวเป็นพื้นเต็มแผง** และ **เลี่ยง gradient พื้นหลัง**

**Dot grid พื้น main:** `radial-gradient(circle, rgba(27,140,75,.06) 1px, transparent 1px)` size `20px 20px` บนพื้น `#F6FAF7`

### 6.2 ฟอนต์ (Typography)

โหลดจาก Google Fonts:
```
Mitr: 400, 500, 600                — ฟอนต์หัวข้อ (เป็นมิตร มน อ่านง่าย)
IBM Plex Sans Thai: 300,400,500,600 — ฟอนต์เนื้อหา (คมชัดทุกขนาด, รองรับไทย-อังกฤษ-ตัวเลข)
```

| บทบาท | ฟอนต์ | ขนาด / น้ำหนัก |
|---|---|---|
| ชื่อแบรนด์/Logo | Mitr 600 | 16px |
| หัวข้อทักทาย (H1) | Mitr 500 | 22px |
| หัวการ์ด/section | Mitr 500 | 14px |
| ตัวเลขสถิติใหญ่ | Mitr 600 | 28px (line-height 1) |
| label เมนู/ปุ่ม | IBM Plex Sans Thai 500–600 | 13px |
| เนื้อหา/แถวตาราง | IBM Plex Sans Thai 400 | 13px |
| caption/meta | IBM Plex Sans Thai 400 | 10.5–12px, สี muted-2 |
| group header sidebar | IBM Plex Sans Thai 600 | 11px, สี primary |

> รหัส SKU/ตัวเลขใช้ IBM Plex Sans Thai (ไม่ต้องใช้ฟอนต์ mono แยก) — ปัจจุบันโปรเจกต์ใช้ Inter+Noto Sans Thai; **เปลี่ยนเป็น Mitr + IBM Plex Sans Thai**

### 6.3 รัศมีมุม / เงา / ระยะ

- **Radius:** การ์ดใหญ่ `20px` (hero) · การ์ด/แผง `16px` · ปุ่ม `13px` · ชิป/เมนู `11–12px` · ไอคอนชิป `10–11px` · badge `20px` (pill)
- **เงา:** การ์ดนิ่ง `0 2px 8px rgba(20,39,28,.04)` · ปุ่มหลัก `0 5px 12px -3px rgba(27,140,75,.5)` · hover การ์ดเมนู `0 6px 16px -10px rgba(20,39,28,.25)`
- **Border:** การ์ดทั้งหมดมีเส้นขอบ `1px solid #EEF2F0` (บางมาก) — โทน flat ไม่พึ่งเงาหนัก
- **ระยะ:** padding การ์ด `16–24px` · gap ระหว่างการ์ด `14px` · gap grid เมนู `11px` · main padding `24px 28px` · content max-width `1000px` จัดกึ่งกลาง

### 6.4 มาสคอต "น้องกล่อง" (Mascot)

กล่องกระดาษติดป้าย **MENA** สีเขียว — สร้างจากรูปทรงง่ายๆ (สื่อถึงคลังสินค้าตรงๆ)
- ใช้เป็น **องค์ประกอบนำทาง/ทักทาย** ไม่ใช่ของประดับรก — โผล่ที่ hero ของ Dashboard, empty state, หน้า success
- คู่กับ **speech bubble** เขียว (`border-radius:12px 12px 12px 3px`) ข้อความสั้นๆ เช่น "สวัสดีครับ!"
- แอนิเมชัน: ลอยขึ้นลงเบาๆ (`floaty` 3.4s) + โบกมือ (`wave` 1.7s) — ดูคีย์เฟรมในไฟล์รีเฟอเรนซ์
- ไฟล์พร้อมใช้: `assets/nong-glong.svg`, `assets/nong-glong-wave.svg` (วางใน `public/` ของโปรเจกต์)
- **ห้ามวาด SVG ซับซ้อนเพิ่มเอง** — ถ้าต้องการภาพประกอบใหม่ ใช้ชุดเส้น/ทรงเดียวกัน (กล่อง/ยาง=2 วงกลม/รถ=สี่เหลี่ยม+ล้อ)

---

## 7. Pattern คอมโพเนนต์ (นำไปใช้ซ้ำทุกหน้า)

### 7.1 Sidebar (256px, พื้นขาว)
- Logo + มาสคอตเล็ก 34px ด้านบน (สูง 64px, เส้นล่าง border)
- **Section label** ตัวพิมพ์เล็ก letterspacing กว้าง สี muted-2 (กลุ่มไม่ยุบ เช่น "— ภาพรวม —")
- **Group header** (กลุ่มยุบได้) = แถบพื้น `#F0FDF4` + แท่ง accent เขียว 3px ซ้าย + ข้อความ primary 11px + ปุ่ม chevron ในสี่เหลี่ยมเขียว
- **เมนู active** = พื้นเต็ม `#1B8C4B` ตัวอักษรขาว · **เมนูปกติ** = โปร่ง hover เป็น `#F0FDF4`
- **เมนู admin/pending** = โทนเหลือง (`#FFFBEB` พื้น, `#B07D12` อักษร, badge `#E8A317`)
- เมนูย่อย (สาขา ลาดกระบัง/สระบุรี) เยื้องซ้าย + subheader มีไอคอนหมุด
- Footer: การ์ดผู้ใช้ (อักษรย่อในวงกลมเขียว + ชื่อ/อีเมล + ปุ่ม logout)

### 7.2 Navbar (สูง 64px, พื้นขาว)
- ซ้าย: ไอคอนปฏิทิน + วันที่ไทย + เส้นคั่น + **เวลาเด่น (Mitr 600, tabular-nums)**
- ขวา: ปุ่มไอคอนกลม-มน (ตั้งค่า, กระดิ่งแจ้งเตือนมี badge เขียว) + avatar ผู้ใช้
- ปุ่มไอคอน = 34px, radius 10px, border `#EEF2F0`, hover พื้น `#F0FDF4`

### 7.3 การ์ดสถิติ (Stat card)
ไอคอนชิป (32px, radius 10, พื้น mint) + label muted → ตัวเลขใหญ่ Mitr 600 28px → caption
การ์ด "รออนุมัติ" ใช้ border `#FBE7C4` + ตัวเลขสี warning + ลิงก์ "ดูรายการ →"

### 7.4 การ์ดเมนู/quick link
ไอคอนชิป mint 36px → ชื่อ 13px medium → คำอธิบาย 10.5px muted; hover เปลี่ยน border + เงานุ่ม

### 7.5 ตาราง/รายการ (ใช้กับ SKU list, สต็อกยาง, คำขอ)
แถวสูง ~48px, เส้นแบ่ง `#F4F7F5`, hover พื้น `#F7FBF8` · เริ่มแถวด้วย **badge ประเภท** (ดูสี 6.1) +
รหัส (muted) + ชื่อ (ink) + meta ขวา · หัวตาราง section ใช้ Mitr 14px + ลิงก์ "ดูทั้งหมด →" สี primary

### 7.6 ปุ่ม (Buttons)
- **Primary:** พื้น `#1B8C4B`, อักษรขาว, radius 13, padding `12px 22px`, เงาเขียวนุ่ม, hover → `#0F6A3C`
- **Secondary:** พื้นขาว, border `#EEF2F0`, อักษร ink, hover พื้น `#F0FDF4`
- **Badge/pill:** radius เต็ม, ตัวเลขขาวบนพื้นเขียว/เหลือง

### 7.7 Empty state / Success (โอกาสใช้มาสคอต)
น้องกล่อง 88px + speech bubble + ข้อความ + ปุ่ม action — แทนหน้าว่างที่จืดชืด

---

## 8. Interaction & Behavior
- **Hover:** เมนู sidebar/ปุ่มไอคอน → พื้น `#F0FDF4`; การ์ดเมนู → border เข้ม + เงานุ่ม (transition .15s)
- **Active เมนู:** พื้นเขียวเต็ม (เทียบ path ปัจจุบันเหมือนเดิมใน `sidebar.tsx`)
- **มาสคอต:** ลอย (`floaty` 3.4s ease-in-out infinite) + แขนโบก (`wave` 1.7s) — เบา ไม่รบกวน
- **Badge แจ้งเตือน/รออนุมัติ:** ดึงจำนวนจริงจาก API เดิม (pending count) — สีเหลือง warning
- **โหลด/Empty/Error:** คงพฤติกรรมเดิม แต่จัดสไตล์ตามระบบ (skeleton เป็นบล็อกสี `#F0F4F1`)
- **Dark mode:** โปรเจกต์มี dark mode อยู่ — รักษาไว้ ปรับโทนเขียว/ขาวให้เข้าชุด (ใช้ตัวแปร CSS เดิมใน `globals.css`)

---

## 9. Mapping ไปไฟล์จริงในโค้ด (สำคัญสำหรับ Claude Code)

| ดีไซน์ | ไฟล์ในโปรเจกต์ที่ต้องแก้ |
|---|---|
| Design tokens (สี/ฟอนต์) | `app/globals.css` — อัปเดตตัวแปร `--primary` ฯลฯ ตามข้อ 6.1 และเปลี่ยน `--font-sans` เป็น Mitr/IBM Plex Sans Thai (โหลดฟอนต์ใน `app/layout.tsx`) |
| Sidebar | `components/sidebar.tsx` |
| Navbar | `components/navbar.tsx` |
| Dashboard | `app/page.tsx` |
| รายการ SKU | หน้า list ใน `app/sku/` |
| เพิ่ม SKU | `app/sku/new/` |
| สต็อกยาง | `components/tire-stock-page.tsx` (+ `tire-stock-add-page.tsx`) |
| คำขอเปลี่ยนยาง | `components/tire-change-request-page.tsx` |
| อนุมัติเปลี่ยนยาง | `components/tire-requests-admin-page.tsx` |
| มาสคอต | วาง SVG ใน `public/` แล้วทำ React component เล็กๆ (เช่น `components/mascot.tsx`) เรียกใช้ซ้ำ |

**หมายเหตุการทำงาน**
- โปรเจกต์ใช้ **Tailwind v4 + shadcn** — ทำสไตล์ผ่าน utility/ตัวแปร CSS เดิม ไม่ต้องสร้างระบบ CSS ใหม่
- ไฟล์ดีไซน์ใช้ inline-style เพื่อความเป๊ะของค่า — **ตอนทำจริงให้แปลงเป็น utility/token** ของโปรเจกต์
- ฟังก์ชัน/ดึงข้อมูล/สิทธิ์ (admin) ของแต่ละหน้ามีอยู่แล้ว — **เปลี่ยนแค่ presentation layer**
- `AGENTS.md` แจ้งว่า Next.js เวอร์ชันนี้มี breaking changes — อ่าน `node_modules/next/dist/docs/` ก่อนแก้
- **ไม่ต้องแตะหน้า Login**

---

## 10. สรุปสั้น (Quick reference)
ขาว + เขียว `#1B8C4B` เป็น accent · Mitr (หัวข้อ) + IBM Plex Sans Thai (เนื้อหา) · การ์ด radius 16–20 เส้นบาง เงานุ่ม ·
มาสคอตน้องกล่องทักทาย · โทนเป็นมิตร minimal ใช้งานง่าย · เลี่ยง gradient/SVG ซับซ้อน/ความรก
