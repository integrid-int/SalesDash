// api/dashboard/index.js
// GET /api/dashboard
// Returns aggregated stats for the lander dashboard card:
// {
//   streak: number,
//   totalEntries: number,
//   lastSeen: iso string | null,
//   audit: {
//     lastWeek: "2026-W09",
//     lastRgaPct: number,
//     goalRgaPct: number,
//     trend: "up"|"down"|"flat"|null,
//     weekLabel: "Mar 2 – Mar 8, 2026"
//   } | null,
//   growth: {
//     lastWeek: "2026-W09",
//     completionPct: number,   // 0-100, fields filled / total fields
//     lastSavedAt: iso string
//   } | null,
//   recentActivity: [
//     { workbook, isoWeek, savedAt, summary }   // last 5 saves
//   ]
// }

const {
  ensureTables,
  getUserId,
  listEntries,
  getMeta,
  toISOWeek,
} = require("../shared/tableClient");

// Total fillable fields per workbook (used for completion %)
const GROWTH_FIELD_COUNT = 38; // counted from the 3-page workbook

module.exports = async function (context, req) {
  const userId = getUserId(req);
  if (!userId) {
    context.res = { status: 401, body: { error: "Not authenticated" } };
    return;
  }

  try {
    await ensureTables();

    const [entries, meta] = await Promise.all([
      listEntries(userId, 52),   // up to a year of entries
      getMeta(userId),
    ]);

    const auditEntries  = entries.filter(e => e.workbook === "audit").slice(0, 8);
    const growthEntries = entries.filter(e => e.workbook === "growth").slice(0, 8);

    // ── Audit stats ───────────────────────────────────────────────────────
    let auditStats = null;
    if (auditEntries.length > 0) {
      const latest = auditEntries[0];
      const d = latest.data || {};
      const lastH = d.lastH || {};
      const goalH = d.goalH || {};

      const lastRga = calcRgaPct(lastH);
      const goalRga = calcRgaPct(goalH);

      let trend = "flat";
      if (auditEntries.length >= 2) {
        const prev = auditEntries[1].data || {};
        const prevRga = calcRgaPct(prev.lastH || {});
        if (lastRga > prevRga + 1) trend = "up";
        else if (lastRga < prevRga - 1) trend = "down";
      }

      auditStats = {
        lastWeek:   latest.isoWeek,
        lastRgaPct: lastRga,
        goalRgaPct: goalRga,
        trend,
        weekLabel:  weekLabel(latest.isoWeek),
        savedAt:    latest.savedAt,
      };
    }

    // ── Growth stats ──────────────────────────────────────────────────────
    let growthStats = null;
    if (growthEntries.length > 0) {
      const latest = growthEntries[0];
      const d = latest.data || {};
      const filled = countFilled(d);
      const pct = Math.round((filled / GROWTH_FIELD_COUNT) * 100);

      growthStats = {
        lastWeek:      latest.isoWeek,
        completionPct: Math.min(100, pct),
        weekLabel:     weekLabel(latest.isoWeek),
        savedAt:       latest.savedAt,
      };
    }

    // ── Recent activity ───────────────────────────────────────────────────
    const recentActivity = entries.slice(0, 5).map(e => ({
      workbook: e.workbook,
      isoWeek:  e.isoWeek,
      savedAt:  e.savedAt,
      summary:  buildSummary(e),
    }));

    // ── Sparkline data (last 8 audit entries, RGA pct by week) ────────────
    const auditSparkline = auditEntries.slice(0, 8).reverse().map(e => ({
      week: e.isoWeek,
      rga:  calcRgaPct((e.data || {}).lastH || {}),
    }));

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        currentWeek:    toISOWeek(),
        streak:         meta ? (meta.streakWeeks || 0) : 0,
        totalEntries:   meta ? (meta.totalEntries || 0) : 0,
        lastSeen:       meta ? (meta.lastSeen || null) : null,
        audit:          auditStats,
        growth:         growthStats,
        auditSparkline,
        recentActivity,
      },
    };
  } catch (err) {
    context.log.error("dashboard error", err.message);
    context.res = { status: 500, body: { error: "Storage error", detail: err.message } };
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const CATS = ["rga", "admin", "ops", "learning", "busy", "personal"];

function calcRgaPct(h) {
  const total = CATS.reduce((s, k) => s + (parseFloat(h[k]) || 0), 0);
  if (total === 0) return 0;
  return Math.round(((parseFloat(h.rga) || 0) / total) * 100);
}

function countFilled(obj, depth = 0) {
  if (depth > 4) return 0;
  if (!obj || typeof obj !== "object") return 0;
  let count = 0;
  for (const val of Object.values(obj)) {
    if (typeof val === "string" && val.trim().length > 0) count++;
    else if (typeof val === "object" && val !== null) count += countFilled(val, depth + 1);
  }
  return count;
}

function buildSummary(entry) {
  if (entry.workbook === "audit") {
    const rga = calcRgaPct((entry.data || {}).lastH || {});
    return `RGA ${rga}% · ${weekLabel(entry.isoWeek)}`;
  }
  if (entry.workbook === "growth") {
    const filled = countFilled(entry.data || {});
    const pct = Math.min(100, Math.round((filled / GROWTH_FIELD_COUNT) * 100));
    return `${pct}% complete · ${weekLabel(entry.isoWeek)}`;
  }
  return entry.isoWeek;
}

function weekLabel(isoWeek) {
  if (!isoWeek) return "";
  try {
    const [year, wStr] = isoWeek.split("-W");
    const wNum = parseInt(wStr, 10);
    const jan4 = new Date(Date.UTC(parseInt(year, 10), 0, 4));
    const dow  = jan4.getUTCDay() || 7;
    const mon  = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (wNum - 1) * 7);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(mon)} – ${fmt(sun)}`;
  } catch {
    return isoWeek;
  }
}
