// npx tsx scripts/check-safety-live-sync.ts
import assert from "node:assert/strict"
import { LIVE_SYNC_COOLDOWN_MIN, lastBuildDoneAt, liveSyncWaitMin, type LiveSyncState } from "../lib/safety-stock-live-sync"

const now = Date.parse("2026-11-17T08:00:00Z")
assert.equal(liveSyncWaitMin(null, now), 0)
assert.equal(liveSyncWaitMin(new Date(now - 60_000), now), LIVE_SYNC_COOLDOWN_MIN - 1)
assert.equal(liveSyncWaitMin(new Date(now - 14.9 * 60_000), now), 1)
assert.equal(liveSyncWaitMin(new Date(now - 15 * 60_000), now), 0)
assert.equal(liveSyncWaitMin("bad", now), 0)

const step = (status: "pending" | "running" | "ok" | "error", finishedAt: string | null = null) =>
  ({ status, startedAt: null, finishedAt, note: null })
const s = (b1: ReturnType<typeof step>, b2: ReturnType<typeof step>): LiveSyncState => ({
  status: "running",
  steps: { sku: step("ok"), build1: b1, movement: step("running"), procurement: step("pending"), build2: b2 },
})
assert.equal(lastBuildDoneAt(null), null)
assert.equal(lastBuildDoneAt(s(step("running"), step("pending"))), null)
assert.equal(lastBuildDoneAt(s(step("ok", "T1"), step("pending"))), "T1")
assert.equal(lastBuildDoneAt(s(step("ok", "T1"), step("ok", "T2"))), "T2")
assert.equal(lastBuildDoneAt(s(step("ok", "T1"), step("error", "T2"))), "T1")
console.log("safety-stock live-sync helpers: OK")
