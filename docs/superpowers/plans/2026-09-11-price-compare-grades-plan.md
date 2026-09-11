# ใบเทียบราคา — เกรดแถวย่อย Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** รายการหนึ่งมีได้หลายเกรด (แถวย่อยที่ใช้ร่วมทุกเจ้า) เลือก 1 เกรด+1 เจ้าต่อรายการ ยอดรวมนับเฉพาะเกรดที่เลือก
**Spec:** `docs/superpowers/specs/2026-09-11-price-compare-grades-design.md`
**Branch:** `feat/price-compare-v2` ใน worktree `~/Documents/project/master-sku-web-pc` (ต่อจาก Task 6)

## Global Constraints
- ห้ามแตะ checkout `~/Documents/project/master-sku-web`; ห้าม push; ห้าม npm install; ห้ามแก้ `components/vendor-combobox.tsx`
- `lib/price-compare.ts` ห้าม import; ยอดทุกตัวมาจาก lib
- invariant `items.length === suppliers[*].prices.length === lineSupplier.length` ต้องคงไว้ทุก mutation
- เอกสารเดิม (ไม่มี group) ต้องทำงานเหมือนเดิมทุกอย่าง — ทดสอบย้อนหลังด้วย fixture uh03 เดิม (ตัวเลขเดิมต้องไม่เปลี่ยน) และ PDF เอกสารเลือกทั้งใบต้องเหมือนเดิม
- ทดสอบด้วย `npx tsx scripts/check-*.ts`; tsc/eslint สะอาด; swal แทน confirm

### Task 7: core เกรด (lib + tests)
Files: `lib/price-compare.ts`, `lib/price-compare-log.ts`, `scripts/check-price-compare-core.ts`
- ทำตาม spec §ฟังก์ชัน ทุกข้อ + log สรุปจำนวนเกรด
- Tests (fixture grades ตาม spec): groupsOf/countedRows/hasGrades; pickLowestPerLine → `[null,null,1,2,2,3]`; mixedTotals S1 22470 / S2 2996 / S3 5350 grand 30816; เลือก มือ2·S3 → grand 35096, mixedGap 4280, isComplete ต้องการ selectionReason; กลุ่มค้าง → mixedTotals null + isComplete missing "ยังไม่เลือกเกรด: Pump Rexroth"; validateDoc: 2 pick ในกลุ่มเดียว → error, กลุ่มไม่ติดกัน → error, ชื่อเกรดว่าง → error; normalizeDoc sync ชื่อ/จำนวน/หน่วย/sku ในกลุ่ม + selectedSupplier null เมื่อ hasGrades; completeSupplierCount = 3; เอกสาร uh03 เดิมตัวเลขเดิมทุกตัว
- Commit: `price-compare: เกรดแถวย่อย — core (groups, counted rows, group-aware lowest/mixed) + tests`

### Task 8: UI เกรด (matrix + form)
Files: `components/price-compare-matrix.tsx`, `components/price-compare-form.tsx`
- ทำตาม spec §UI: ปุ่ม +เกรด, แถวหัวรายการ + แถวเกรด, radio ต่อกลุ่ม, ลบเกรด/ลบทั้งรายการ/เลื่อนทั้งกลุ่ม, ลำดับเลขต่อรายการ, ลิงก์ราคากลางที่แถวหัว, §6 hasGrades → ซ่อนเลือกทั้งใบ + รายชื่อกลุ่มค้าง
- จำนวน cell ทุกแถว (หัว/เกรด/ธรรมดา/footer) ต้องเท่ากันทั้ง readOnly และแก้ไข
- ตรวจ: dev server + Playwright (หรือ Python Playwright) สร้างใบตาม fixture spec → เลือกถูกสุดทุกแถว → grand 30,816.00 → เปลี่ยนเป็น มือ2·S3 → ต้องกรอกเหตุผล → ส่งลงนาม → PDF 200; ลบเกรดจนเหลือ 1 → กลับเป็นรายการธรรมดา; ลบใบทดสอบ
- Commit: `price-compare: เกรดแถวย่อย — matrix/form UX`

### Task 9: PDF เกรด + QA
Files: `lib/price-compare-pdf.ts`, `scripts/check-price-compare-pdf.ts`, `scripts/seed-price-compare-uh03.mjs` (`--grades` → PC-2609-998)
- ทำตาม spec §PDF; tests: JSON มี "เกรด: มือ 1", ✓ ที่ ซ่อมเดิม·S1, "30,816.00"; หน้าเดียว; PDF เอกสารเลือกทั้งใบ (uh03) เหมือนเดิมทุกไบต์ของ docDefinition
- seed `--grades` + build + next start + ดึง PDF ของ PC-2609-998 ดูด้วย Read
- Commit: `price-compare: เกรดแถวย่อย — PDF + seed + QA`
