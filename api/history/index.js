// api/history/index.js
// GET /api/history?workbook=audit&limit=12
// Returns: { entries: [ { isoWeek, savedAt, summary, data } ] }

const {
  ensureTables,
  getUserId,
  listEntries,
} = require("../shared/tableClient");

const CATS = ["rga", "admin", "ops", "learning", "busy", "personal"];
const GROWTH_FIELD_COUNT = 38;

module.exports = async function (context, req) {
  const userId = getUserId(req);
  if (!userId) {
    context.res = { status: 401, body: { error: "Not authenticated" } };
    return;
  }

  const workbook = req.query.workbook;
  const limit    = Math.min(52, parseInt(req.query.limit || "12", 10));

  if (workbook && !["audit", "growth", "push"].includes(workbook)) {
    context.res = { status: 400, body: { error: "workbook must be 'audit', 'growth', or 'push'" } };
    return;
  }

  try {
    await ensureTables();
    const all = await listEntries(userId, 100);
    const filtered = workbook ? all.filter(e => e.workbook === workbook) : all;
    const entries = filtered.slice(0, limit).map(e => ({
      workbook:  e.workbook,
      isoWeek:   e.isoWeek,
      savedAt:   e.savedAt,
      summary:   buildSummary(e),
      // Include lightweight metrics but not full data to keep payload small
      metrics:   buildMetrics(e),
    }));

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { entries },
    };
  } catch (err) {
    context.log.error("history error", err.message);
    context.res = { status: 500, body: { error: "Storage error", detail: err.message } };
  }
};

function calcRgaPct(h) {
  const total = CATS.reduce((s, k) => s + (parseFloat(h[k]) || 0), 0);
  if (total === 0) return 0;
  return Math.round(((parseFloat(h.rga) || 0) / total) * 100);
}

function countFilled(obj, depth = 0) {
  if (depth > 4 || !obj || typeof obj !== "object") return 0;
  let n = 0;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.trim()) n++;
    else if (typeof v === "object" && v !== null) n += countFilled(v, depth + 1);
  }
  return n;
}

function buildMetrics(entry) {
  if (entry.workbook === "audit") {
    const d = entry.data || {};
    return {
      lastRgaPct: calcRgaPct(d.lastH || {}),
      goalRgaPct: calcRgaPct(d.goalH || {}),
      lastRgaHrs: parseFloat((d.lastH || {}).rga) || 0,
      goalRgaHrs: parseFloat((d.goalH || {}).rga) || 0,
    };
  }
  if (entry.workbook === "growth") {
    return {
      completionPct: Math.min(100, Math.round((countFilled(entry.data || {}) / GROWTH_FIELD_COUNT) * 100)),
    };
  }
  return {};
}

function buildSummary(entry) {
  const m = buildMetrics(entry);
  if (entry.workbook === "audit") return `RGA ${m.lastRgaPct}% actual · ${m.goalRgaPct}% goal`;
  if (entry.workbook === "growth") return `${m.completionPct}% complete`;
  return "";
}
