export const metadata = { title: "PRD — Mena WMS Tire System", robots: "noindex" }

const TOC = [
  { id: "overview",      label: "System Overview" },
  { id: "roles",         label: "Roles" },
  { id: "flow",          label: "Full System Flow" },
  { id: "user-stories",  label: "User Stories" },
  { id: "pages",         label: "Page Reference" },
  { id: "mr-api",        label: "External MR API" },
  { id: "database",      label: "Database Collections" },
  { id: "rules",         label: "Business Rules" },
]

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-2xl font-bold text-gray-900 mt-14 mb-4 pb-2 border-b border-gray-200 scroll-mt-8">
      {children}
    </h2>
  )
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-semibold text-gray-800 mt-8 mb-3">{children}</h3>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-700 leading-relaxed mb-3">{children}</p>
}
function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {children}
    </span>
  )
}
function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto mb-6">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 border border-gray-200 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 border border-gray-200 text-gray-700 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-gray-900 text-gray-100 rounded-xl p-5 text-sm overflow-x-auto mb-6 leading-relaxed font-mono">
      {children}
    </pre>
  )
}
function Callout({ type, children }: { type: "warn" | "info"; children: React.ReactNode }) {
  const styles = type === "warn"
    ? "bg-amber-50 border-amber-300 text-amber-900"
    : "bg-blue-50 border-blue-300 text-blue-900"
  return (
    <div className={`border-l-4 rounded-r-lg px-4 py-3 mb-4 text-sm ${styles}`}>
      {children}
    </div>
  )
}
function Check({ done = false, children }: { done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-gray-700 mb-1">
      <span className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold ${done ? "bg-green-500 text-white" : "border-2 border-gray-300"}`}>
        {done ? "✓" : ""}
      </span>
      {children}
    </li>
  )
}

export default function PrdPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <div className="bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-8 py-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-mono text-white/70 tracking-wider uppercase">Internal · No Index</span>
            <span className="rounded-full bg-amber-400/20 text-amber-300 px-3 py-1 text-xs font-semibold">Draft</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Product Requirements Document</h1>
          <p className="text-gray-400 text-lg">Mena WMS — Tire Management System</p>
          <div className="mt-4 flex flex-wrap gap-6 text-sm text-gray-400">
            <span>Last updated: <strong className="text-white">2026-06-29</strong></span>
            <span>Branches: <strong className="text-white">ลาดกระบัง · สระบุรี</strong></span>
            <span>Stack: <strong className="text-white">Next.js 16 · MongoDB · Tailwind</strong></span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-10 flex gap-12">
        {/* TOC sidebar */}
        <aside className="hidden lg:block w-52 flex-shrink-0">
          <div className="sticky top-8">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Contents</p>
            <nav className="space-y-1">
              {TOC.map((t) => (
                <a key={t.id} href={`#${t.id}`}
                  className="block text-sm text-gray-500 hover:text-gray-900 py-0.5 transition-colors">
                  {t.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">

          {/* System Overview */}
          <H2 id="overview">System Overview</H2>
          <P>
            Mena WMS Tire Management is a web-based system for tracking tire inventory, driver change requests,
            manager approvals, and integration with ATMS and an external Maintenance Request (MR) API.
            It covers two branches — ลาดกระบัง and สระบุรี — with identical feature sets per branch.
          </P>
          <Code>{`/tire
 ├── /latkrabang
 │    ├── /stock-tire          Stock list + PR Report
 │    ├── /stock-tire/new      Bulk add tires
 │    ├── /change-history      ATMS sync + tire history
 │    ├── /change-tire-request Driver request form
 │    └── /requests            Admin approval queue
 ├── /saraburi                 (same structure)
 └── /master                   Tire Spec Master (global)`}</Code>

          {/* Roles */}
          <H2 id="roles">Roles</H2>
          <Table
            headers={["Role", "Thai", "Access"]}
            rows={[
              [<Badge color="bg-blue-100 text-blue-700">Driver</Badge>, "คนขับ", "Submit change requests only"],
              [<Badge color="bg-purple-100 text-purple-700">Admin / Staff</Badge>, "เจ้าหน้าที่", "All tire pages except Requests approval"],
              [<Badge color="bg-green-100 text-green-700">Manager</Badge>, "ผู้จัดการ", "All pages including Requests approval"],
              [<Badge color="bg-gray-100 text-gray-600">Cron</Badge>, "ระบบอัตโนมัติ", "Nightly ATMS sync at 02:00"],
            ]}
          />

          {/* Full System Flow */}
          <H2 id="flow">Full System Flow</H2>
          <div className="space-y-3 mb-8">
            {[
              { n: "1", label: "SETUP", desc: "Admin adds tire specs to /tire/master — brand / size / model / rated distance", color: "bg-gray-900 text-white" },
              { n: "2", label: "RECEIVING", desc: "Admin pastes Excel rows into /stock-tire/new — distance auto-fills from Tire Spec Master", color: "bg-gray-700 text-white" },
              { n: "3", label: "REQUEST", desc: "Driver fills /change-tire-request — odometer photo + tire photos + reason. If reason = รถกินยาง → MR auto-created.", color: "bg-blue-700 text-white" },
              { n: "4", label: "APPROVAL", desc: "Manager reviews /requests — approve / reject per item → set appointment date", color: "bg-amber-600 text-white" },
              { n: "5", label: "EXECUTION", desc: "Technician physically replaces tire + records in ATMS", color: "bg-orange-600 text-white" },
              { n: "6", label: "SYNC", desc: "System pulls data from ATMS — manual or auto at 02:00. Stock status auto-updates.", color: "bg-green-700 text-white" },
              { n: "7", label: "ANALYSIS", desc: "Manager reviews /stock-tire → PR Report — ฿/km, efficiency, MR status per truck → informs next purchase", color: "bg-teal-700 text-white" },
            ].map((s) => (
              <div key={s.n} className="flex items-start gap-4">
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${s.color}`}>{s.n}</div>
                <div className="flex-1 border border-gray-200 rounded-lg px-4 py-3">
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-400 mr-2">{s.label}</span>
                  <span className="text-sm text-gray-700">{s.desc}</span>
                </div>
              </div>
            ))}
          </div>

          {/* User Stories */}
          <H2 id="user-stories">User Stories</H2>

          {/* US-01 */}
          <div className="border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge color="bg-blue-100 text-blue-700">Driver</Badge>
              <span className="font-mono text-xs text-gray-400">US-01</span>
              <span className="font-semibold text-gray-900">ขอเปลี่ยนยาง</span>
            </div>
            <P><em>&ldquo;As a driver, I want to submit a tire change request from my phone so the manager can arrange a replacement.&rdquo;</em></P>
            <H3>Flow</H3>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1 mb-4 ml-2">
              <li>Open <code className="bg-gray-100 px-1 rounded">/change-tire-request</code></li>
              <li>Fill: ชื่อคนขับ · ทะเบียนรถ · เบอร์รถ · เลขไมล์ · รูปเลขไมล์รถ (camera)</li>
              <li>Tap &ldquo;บันทึกคำขอ &amp; ดูประวัติยาง&rdquo;</li>
              <li>Vehicle card appears — shows truck type, brand/model, and <strong>current MR status</strong></li>
              <li>Tire table shows all tires on the truck with health metrics</li>
              <li>Tap &ldquo;ขอเปลี่ยนยาง&rdquo; on the problem tire</li>
              <li>Fill modal: up to 3 tire photos · มิลยาง · สาเหตุ (required) · หมายเหตุ</li>
              <li>Odometer photo auto-shows in modal as read-only confirmation</li>
              <li>Tap &ldquo;ส่งคำขอ&rdquo;</li>
            </ol>
            <Callout type="info">
              <strong>Special case — รถกินยาง:</strong> System auto-creates an MR in the external repair API.
              MR failure is non-blocking — tire request saves regardless, warning toast tells staff to create MR manually.
            </Callout>
            <H3>Acceptance Criteria</H3>
            <ul className="space-y-1">
              <Check>Form requires: ชื่อคนขับ, ทะเบียน, เบอร์รถ, เลขไมล์, สาเหตุ</Check>
              <Check>Up to 3 tire condition photos per tire item</Check>
              <Check>1 odometer photo per request (shared across all tire items)</Check>
              <Check>MR auto-created only when reason = &ldquo;รถกินยาง&rdquo;</Check>
              <Check>MR failure does not block the tire request from saving</Check>
              <Check>Current MR status shown in vehicle info card after plate lookup</Check>
            </ul>
          </div>

          {/* US-02 */}
          <div className="border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge color="bg-purple-100 text-purple-700">Admin</Badge>
              <span className="font-mono text-xs text-gray-400">US-02</span>
              <span className="font-semibold text-gray-900">รับยางเข้าสต็อก</span>
            </div>
            <P><em>&ldquo;As a staff member, I want to record new tires into the warehouse so the manager can track inventory.&rdquo;</em></P>
            <H3>Flow</H3>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1 mb-4 ml-2">
              <li>Open <code className="bg-gray-100 px-1 rounded">/stock-tire/new</code></li>
              <li>Paste rows from Excel (14 columns: PR Code → วันหมดประกัน)</li>
              <li>Auto-fill fires: brand + size + model → distance, productCode, productName from Tire Spec Master</li>
              <li>Review table, edit any cell, remove bad rows</li>
              <li>Tap &ldquo;บันทึกทั้งหมด&rdquo; — duplicate serials skipped and reported, failed rows kept</li>
            </ol>
            <H3>Acceptance Criteria</H3>
            <ul className="space-y-1">
              <Check>Paste from Excel supported; multiple paste sessions stack rows</Check>
              <Check>Auto-fill fires 300ms after last keystroke on brand/size/model</Check>
              <Check>Auto-fill also fires after paste (staggered 50ms per row)</Check>
              <Check>Only fills empty cells — never overwrites manual entries</Check>
              <Check>Duplicate serial no in same branch rejected with error</Check>
            </ul>
          </div>

          {/* US-03 */}
          <div className="border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge color="bg-purple-100 text-purple-700">Admin</Badge>
              <span className="font-mono text-xs text-gray-400">US-03</span>
              <span className="font-semibold text-gray-900">จัดการสเปคยาง</span>
            </div>
            <P><em>&ldquo;As a staff member, I want a master list of tire specs so staff never need to manually look up rated distance.&rdquo;</em></P>
            <H3>Flow</H3>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1 mb-4 ml-2">
              <li>Open <code className="bg-gray-100 px-1 rounded">/tire/master</code></li>
              <li>View existing specs sorted brand → size → model</li>
              <li>Add / Edit / Delete with inline form</li>
            </ol>
            <H3>Acceptance Criteria</H3>
            <ul className="space-y-1">
              <Check>Duplicate brand+size+model combination rejected</Check>
              <Check>Distance must be &gt; 0</Check>
              <Check>No sidebar link — accessible by URL only (same as this page)</Check>
            </ul>
          </div>

          {/* US-04 */}
          <div className="border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge color="bg-purple-100 text-purple-700">Admin</Badge>
              <span className="font-mono text-xs text-gray-400">US-04</span>
              <span className="font-semibold text-gray-900">Sync ข้อมูลจาก ATMS</span>
            </div>
            <P><em>&ldquo;As a staff member, I want to pull the latest tire data from ATMS so change history and stock status are always current.&rdquo;</em></P>
            <H3>Acceptance Criteria</H3>
            <ul className="space-y-1">
              <Check>Manual sync button in /change-history</Check>
              <Check>Auto sync runs daily at 02:00 via cron</Check>
              <Check>Stock status updates automatically after sync</Check>
            </ul>
          </div>

          {/* US-05 */}
          <div className="border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge color="bg-green-100 text-green-700">Manager</Badge>
              <span className="font-mono text-xs text-gray-400">US-05</span>
              <span className="font-semibold text-gray-900">อนุมัติคำขอเปลี่ยนยาง</span>
            </div>
            <P><em>&ldquo;As a manager, I want to review all tire change requests with full context so I can approve, reject, or schedule replacements.&rdquo;</em></P>
            <H3>Status Workflow</H3>
            <Code>{`pending → approved → appointment → done
       ↘ rejected`}</Code>
            <H3>Acceptance Criteria</H3>
            <ul className="space-y-1">
              <Check>Each request shows: ทะเบียน / เบอร์รถ / คนขับ / ฟลีท / Plant / เลขไมล์</Check>
              <Check>Each tire item shows: ตำแหน่ง / Serial / สาเหตุ / มม. / photos / ระยะ / % efficiency / ฿/กม.</Check>
              <Check>฿/กม. shows red when actual exceeds standard (over budget)</Check>
              <Check>Approve / reject per item or whole request</Check>
              <Check>Set appointment date on approval</Check>
            </ul>
          </div>

          {/* US-06 */}
          <div className="border border-gray-200 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Badge color="bg-green-100 text-green-700">Manager</Badge>
              <span className="font-mono text-xs text-gray-400">US-06</span>
              <span className="font-semibold text-gray-900">วิเคราะห์ประสิทธิภาพยางต่อ PR</span>
            </div>
            <P><em>&ldquo;As a manager, I want to see how efficiently each PR batch was used so I can decide which brand/model to buy next.&rdquo;</em></P>
            <H3>Flow</H3>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1 mb-4 ml-2">
              <li>Open <code className="bg-gray-100 px-1 rounded">/stock-tire → รายงาน PR</code></li>
              <li>Pick PR code from searchable dropdown</li>
              <li>See per-tire row: stock info + request info + performance metrics + evidence photos</li>
              <li>MR status badge appears in plate column (loads after rows appear)</li>
              <li>Click badge → log history modal with all status changes</li>
              <li>Summary cards + reason chart</li>
              <li>Copy share link → URL preserves PR selection</li>
            </ol>
            <H3>Acceptance Criteria</H3>
            <ul className="space-y-1">
              <Check>MR status loaded non-blocking (report renders first)</Check>
              <Check>Badge colors: green = ซ่อมเสร็จ, amber = รอประเมิน, red = กำลังซ่อม</Check>
              <Check>Click badge → log history modal (all status changes, newest first)</Check>
              <Check>Tire photos + odometer photo thumbnails — click to open full size</Check>
              <Check>Share link encodes PR in URL</Check>
            </ul>
          </div>

          {/* Page Reference */}
          <H2 id="pages">Page Reference</H2>

          <H3>/tire/master — Tire Spec Master</H3>
          <P>Global catalog. Not branch-scoped. No sidebar link — URL access only.</P>
          <Table
            headers={["Field", "Required", "Description"]}
            rows={[
              ["ยี่ห้อ", "Yes", "Brand e.g. Bridgestone"],
              ["ขนาดยาง", "Yes", "Size e.g. 295/80R22.5"],
              ["รุ่นยาง", "Yes", "Model e.g. R249"],
              ["ระยะทาง (กม.)", "Yes", "Rated distance in km"],
              ["รหัสสินค้า", "No", "Internal product code"],
              ["ชื่อสินค้า", "No", "Full product name"],
            ]}
          />

          <H3>/stock-tire — Stock + PR Report</H3>
          <Table
            headers={["Tab", "Feature", "Detail"]}
            rows={[
              ["Stock", "Filter", "PR Code, Status, Deposit Date range, search text"],
              ["Stock", "Summary cards", "Total, In Stock %, total value, in-stock value"],
              ["Stock", "Edit / Delete", "Inline edit + confirm delete"],
              ["Stock", "Export", "Downloads filtered list as .xlsx"],
              ["PR Report", "MR badge", "Latest MR status in plate column; click → log modal"],
              ["PR Report", "Evidence", "Tire photos + odometer photo; click to enlarge"],
              ["PR Report", "Summary", "Value / avg distance / avg efficiency / avg ฿/กม. / reason chart"],
              ["PR Report", "Share", "Copy URL with PR param encoded"],
            ]}
          />

          <H3>/change-tire-request — Driver Form</H3>
          <Table
            headers={["Field", "Required", "Notes"]}
            rows={[
              ["ชื่อคนขับ", "Yes", ""],
              ["ทะเบียนรถ", "Yes", "Triggers tire history lookup"],
              ["เบอร์รถ", "Yes", ""],
              ["เลขไมล์ปัจจุบัน", "Yes", "Numeric"],
              ["ฟลีท", "No", "Auto-filled from vehicle master"],
              ["Plant", "No", "Auto-filled from vehicle master"],
              ["รูปเลขไมล์รถ", "No", "Single photo; shown read-only in every tire modal"],
              ["— modal — สาเหตุ", "Yes", "หมดดอก / ยางระเบิด / ยางฉีก / ยางบวม / รถกินยาง"],
              ["— modal — รูปถ่ายยาง", "No", "Up to 3 photos per tire"],
              ["— modal — มิลยาง", "No", "Decimal mm"],
              ["— modal — หมายเหตุ", "No", "Free text"],
            ]}
          />

          {/* External MR API */}
          <H2 id="mr-api">External MR API</H2>
          <P>
            Base URL: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">
              https://fastapinextjs-548129382487.asia-southeast3.run.app
            </code>
          </P>
          <P>All calls proxied through Next.js API routes — external URL never exposed to browser.</P>

          <Table
            headers={["Internal Route", "Method", "External Endpoint", "When"]}
            rows={[
              ["/api/maintenance-request", "POST", "/maintenancerequest/pending-status", "Auto on รถกินยาง submit"],
              ["/api/maintenance-request/latest", "POST", "/pending-status/latest", "After plate lookup + PR report load"],
              ["/api/maintenance-request/logs", "GET ?plate=", "/pending-status/{plate}/logs", "MR log modal open"],
            ]}
          />

          <H3>Status Values</H3>
          <Table
            headers={["Value", "Display (TH)", "Chip"]}
            rows={[
              ["estimate_pending", "รอประเมิน", <Badge color="bg-amber-100 text-amber-700">Amber</Badge>],
              ["completed", "ซ่อมเสร็จ", <Badge color="bg-green-100 text-green-700">Green</Badge>],
              ["In Maintenance", "กำลังซ่อม", <Badge color="bg-red-100 text-red-700">Red</Badge>],
            ]}
          />

          <H3>Auto-create MR Payload</H3>
          <Code>{`{
  "truckplate":    "<plate>",
  "status":        "In Maintenance",
  "useradd":       "<session user name>",
  "remark":        "รถกินยาง — ตำแหน่ง <positionCode> (<serialNo>)",
  "date_log":      "<YYYY-MM-DD today>"
}`}</Code>
          <Callout type="warn">
            <strong>⚠️ Open question:</strong> Confirmed live status values are <code>estimate_pending</code> and <code>completed</code>.
            {" "}<code>&quot;In Maintenance&quot;</code> has not been verified as valid — consider switching to <code>estimate_pending</code> if the MR auto-create fails silently.
          </Callout>

          {/* Database */}
          <H2 id="database">Database Collections</H2>
          <P>MongoDB on DigitalOcean. DB name: <code className="bg-gray-100 px-1 rounded">master_data</code></P>
          <Table
            headers={["Collection", "Purpose", "Key Fields"]}
            rows={[
              ["tire_stock", "One doc per tire serial per branch", "branch, serialNo, prCode, status, unitPrice, distance"],
              ["tire_change", "Synced from ATMS — tire position history", "branch, serialNo, vehicle, isLatest, changeIn, changeOut"],
              ["tire_change_request", "Driver requests + embedded items", "branch, plate, driverName, odometerPhoto, items[], status"],
              ["tire_spec_master", "Global tire spec catalog", "brand, tireSize, tireModel, distance, productCode, productName"],
            ]}
          />

          {/* Business Rules */}
          <H2 id="rules">Business Rules</H2>
          <div className="space-y-3">
            {[
              { n: "BR-01", rule: "Serial No is unique per branch", detail: "Duplicate rejected at insert. Applies to both single-add and bulk-add." },
              { n: "BR-02", rule: "Distance comes from Tire Spec Master", detail: "Staff should never type it manually. Auto-fill handles it. If no spec exists, field stays blank — admin must fill manually or add the spec first." },
              { n: "BR-03", rule: "Odometer photo is per-request", detail: "One photo is shared across all tire items in the same submission. Uploaded in the main form, displayed read-only in each tire modal." },
              { n: "BR-04", rule: "MR is only auto-created for รถกินยาง", detail: "All other reasons are tire-only. No MR is sent for หมดดอก, ยางระเบิด, ยางฉีก, ยางบวม." },
              { n: "BR-05", rule: "MR failure is non-blocking", detail: "Tire change request saves regardless of MR API result. Warning toast instructs staff to create MR manually if auto-create failed." },
              { n: "BR-06", rule: "ATMS is the source of truth for tire history", detail: "Web system only stores stock and requests. Actual change records come from ATMS sync — never entered manually." },
              { n: "BR-07", rule: "฿/กม. red = over budget", detail: "Actual baht-per-km exceeded the tire's rated cost per km. Indicates the tire was replaced before it reached rated distance." },
            ].map((r) => (
              <div key={r.n} className="flex gap-4 border border-gray-200 rounded-lg px-4 py-3">
                <span className="flex-shrink-0 font-mono text-xs font-bold text-gray-400 mt-0.5">{r.n}</span>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{r.rule}</p>
                  <p className="text-sm text-gray-600 mt-0.5">{r.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-16 pt-6 border-t border-gray-200 text-center text-xs text-gray-400">
            Internal document · Not indexed · Mena Transport · {new Date().getFullYear()}
          </div>

        </main>
      </div>
    </div>
  )
}
