// GET /api/store-withdraw/hub/moves?vendorCode=&skuId=&skuCode=&from=&to=&format=xlsx — ประวัติเคลื่อนไหว ≤ 2000 แถว
import { NextResponse, type NextRequest } from "next/server"
import { guard, isResponse } from "@/lib/store-withdraw/http"
import { getHubActor, hubMovesRows, hubMovesXlsx } from "@/lib/store-withdraw/hub-api"

export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  return guard(async () => {
    const actor = await getHubActor(req, "view")
    if (isResponse(actor)) return actor
    const p = req.nextUrl.searchParams
    const rows = await hubMovesRows(p)
    if (p.get("format") === "xlsx") {
      const buffer = await hubMovesXlsx(rows)
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="hub-moves.xlsx"`,
        },
      })
    }
    return NextResponse.json({ rows })
  })
}
