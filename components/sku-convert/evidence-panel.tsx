"use client"

import { AlertTriangle, History, PackageSearch, Store, TrendingUp } from "lucide-react"
import { Chip, SectionTitle, fmtDate, fmtInt, fmtMoney, fmtQty } from "@/components/sku-convert/ui"
import type { ConvertDetailResponse, ConvertItem } from "@/lib/sku-convert-types"

export interface EvidencePanelProps {
  item: ConvertItem
  liveStock: ConvertDetailResponse["liveStock"]
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-[#f3f9ff] px-3 py-2.5">
      <p className="text-[11px] font-medium text-[#5b6f8f]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-[#0f2748]">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-[#5b6f8f]">{sub}</p>}
    </div>
  )
}

/** Left column of the work page: everything the person needs to decide how to split / name the new code(s). */
export function EvidencePanel({ item, liveStock }: EvidencePanelProps) {
  const lotQty = item.lots.reduce((s, l) => s + l.qtyLeft, 0)
  const lotValue = item.lots.reduce((s, l) => s + l.value, 0)
  const diff = liveStock && Math.abs(liveStock.qty - item.atmsQty) > 1e-6

  return (
    <div className="space-y-4">
      {item.splitHint && (
        <div role="note" className="flex gap-3 rounded-[22px] border border-[#ffd9ae] bg-[#fff6ea] p-4 text-sm text-[#7a3b08]">
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-[#ff8a3d]" />
          <div>
            <p className="font-semibold">ควรพิจารณาแยกรหัส</p>
            <p className="mt-0.5">{item.splitHint}</p>
          </div>
        </div>
      )}
      {item.haveSku && (
        <div role="note" className="flex gap-3 rounded-[22px] border border-[#f7c4be] bg-[#fff1ef] p-4 text-sm text-[#8a1c12]">
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-[#e5484d]" />
          <div>
            <p className="font-semibold">มี SKU ที่ใช้รหัส ATMS นี้อยู่แล้ว</p>
            <p className="mt-0.5 font-mono">{item.haveSku}</p>
          </div>
        </div>
      )}

      <section className="v2-card rounded-[22px] p-4" aria-label="ตัวเลขการเคลื่อนไหว">
        <SectionTitle icon={<TrendingUp className="h-4 w-4 text-[#1c6ef2]" />}>ตัวเลขการเคลื่อนไหว (เม.ย.–ก.ย. 69)</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {item.kind === "parts" && (
            <>
              <Stat label={`คงเหลือ ATMS ${fmtDate(item.asOf)}`} value={`${fmtQty(item.atmsQty)}${item.unit ? ` ${item.unit}` : ""}`} sub={`มูลค่า ${fmtMoney(item.atmsValue)}`} />
              <Stat label="รับเข้า" value={fmtQty(item.recv)} />
              <Stat label="เบิกออก" value={fmtQty(item.issue)} sub={`${fmtInt(item.issueDocs)} ใบเบิก`} />
              <Stat label="มูลค่าเบิก" value={fmtMoney(item.issueAmt)} />
            </>
          )}
          {item.kind === "svc" && item.use && (
            <>
              <Stat label="จำนวนรายการใช้" value={fmtInt(item.use.lines)} />
              <Stat label="จำนวน" value={fmtQty(item.use.qty)} />
              <Stat label="มูลค่า" value={fmtMoney(item.use.amt)} />
            </>
          )}
          <Stat label="ครั้งเคลื่อนไหว" value={fmtInt(item.moves)} sub={item.lastMove ? `ล่าสุด ${fmtDate(item.lastMove)}` : undefined} />
          <Stat label="ราคารับล่าสุด" value={fmtMoney(item.lastPrice)} sub={item.lastSupplier} />
          <Stat label="จำนวนผู้ขาย" value={fmtInt(item.nSup)} sub={item.priceRatio ? `ราคาห่างกัน ${fmtQty(Math.round(item.priceRatio * 10) / 10)} เท่า` : undefined} />
        </div>
        {item.kind === "parts" && liveStock && (
          <p className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${diff ? "text-[#c2570c]" : "text-[#5b6f8f]"}`}>
            {diff && <Chip tone="sun"><AlertTriangle className="h-3 w-3" />ยอดวันนี้ต่างจากยอดตัด</Chip>}
            ยอด ATMS ล่าสุด {fmtQty(liveStock.qty)} (ซิงก์ {fmtDate(liveStock.syncedAt)}) · การแบ่งจำนวนอ้างอิงยอดตัด {fmtDate(item.asOf)} = {fmtQty(item.atmsQty)}
          </p>
        )}
      </section>

      {item.kind === "parts" && (
        <section className="v2-card rounded-[22px] p-4" aria-label="ล็อตคงเหลือ">
          <SectionTitle icon={<PackageSearch className="h-4 w-4 text-[#1c6ef2]" />} right={<span className="text-xs text-[#5b6f8f]">{fmtInt(item.lots.length)} ล็อต</span>}>
            ล็อตคงเหลือ (FIFO)
          </SectionTitle>
          {item.lots.length === 0 ? (
            <p className="rounded-2xl bg-[#f3f9ff] px-3 py-4 text-center text-sm text-[#5b6f8f]">ไม่มีล็อตคงเหลือ</p>
          ) : (
            <div className="max-h-80 overflow-auto rounded-2xl border border-[#e3effd]">
              <table className="v2-table min-w-[34rem]">
                <thead>
                  <tr>
                    <th scope="col">วันที่รับ</th><th scope="col">DD / PO</th><th scope="col">ผู้ขาย</th>
                    <th scope="col" className="!text-right">ต้นทุน/หน่วย</th><th scope="col" className="!text-right">คงเหลือ</th><th scope="col" className="!text-right">อายุ (วัน)</th>
                  </tr>
                </thead>
                <tbody>
                  {item.lots.map((l) => (
                    <tr key={l.seq} title={l.note}>
                      <td className="whitespace-nowrap">{l.date ? fmtDate(l.date) : <span className="text-[#5b6f8f]">ก่อนมีบัญชี</span>}</td>
                      <td className="font-mono text-xs">{[l.dd, l.po].filter(Boolean).join(" / ") || "-"}</td>
                      <td className="max-w-[10rem] truncate">{l.supplier || "-"}</td>
                      <td className="num">{fmtMoney(l.unitCost)}</td>
                      <td className="num">{fmtQty(l.qtyLeft)}</td>
                      <td className="num">{l.ageDays == null ? "-" : fmtInt(l.ageDays)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="!border-b-0 text-right text-xs font-semibold text-[#33476b]">รวม (มูลค่า {fmtMoney(lotValue)})</td>
                    <td className="num !border-b-0 font-semibold">{fmtQty(lotQty)}</td>
                    <td className="!border-b-0" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="v2-card rounded-[22px] p-4" aria-label="ประวัติผู้ขาย">
        <SectionTitle icon={<Store className="h-4 w-4 text-[#1c6ef2]" />} right={<span className="text-xs text-[#5b6f8f]">รับเข้าตั้งแต่ ม.ค. 68</span>}>
          ประวัติผู้ขาย
        </SectionTitle>
        {item.suppliers.length === 0 ? (
          <p className="rounded-2xl bg-[#f3f9ff] px-3 py-4 text-center text-sm text-[#5b6f8f]">ยังไม่มีประวัติรับเข้า</p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-2xl border border-[#e3effd]">
            <table className="v2-table min-w-[34rem]">
              <thead>
                <tr>
                  <th scope="col">ผู้ขาย</th><th scope="col" className="!text-right">ครั้ง</th><th scope="col" className="!text-right">จำนวน</th>
                  <th scope="col" className="!text-right">ต่ำสุด</th><th scope="col" className="!text-right">กลาง</th><th scope="col" className="!text-right">สูงสุด</th><th scope="col">ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {item.suppliers.map((s) => (
                  <tr key={s.supplier}>
                    <td className="max-w-[12rem] truncate" title={s.supplier}>{s.supplier}</td>
                    <td className="num">{fmtInt(s.n)}</td><td className="num">{fmtQty(s.qty)}</td>
                    <td className="num">{fmtMoney(s.pMin)}</td><td className="num">{fmtMoney(s.pMed)}</td><td className="num">{fmtMoney(s.pMax)}</td>
                    <td className="whitespace-nowrap">{fmtDate(s.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {item.updatedAt && (
        <p className="flex items-center gap-1.5 px-1 text-xs text-[#5b6f8f]">
          <History aria-hidden className="h-3.5 w-3.5" />
          แก้ไขล่าสุด {fmtDate(item.updatedAt)} โดย {item.updatedBy?.name || item.updatedBy?.email || "-"}
        </p>
      )}
    </div>
  )
}
