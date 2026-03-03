// api/save/index.js
// POST /api/save
// Body: { workbook: "audit"|"growth", isoWeek: "2026-W09", data: { ...fields } }
// Returns: { ok: true, savedAt: "<iso>" }

const {
  ensureTables,
  getUserId,
  upsertEntry,
  upsertMeta,
  getMeta,
  listEntries,
  toISOWeek,
} = require("../shared/tableClient");

module.exports = async function (context, req) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const userId = getUserId(req);
  if (!userId) {
    context.res = { status: 401, body: { error: "Not authenticated" } };
    return;
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const body = req.body || {};
  const { workbook, isoWeek, data } = body;

  if (!workbook || !["audit", "growth"].includes(workbook)) {
    context.res = { status: 400, body: { error: "workbook must be 'audit' or 'growth'" } };
    return;
  }
  if (!data || typeof data !== "object") {
    context.res = { status: 400, body: { error: "data must be an object" } };
    return;
  }

  const week = isoWeek || toISOWeek();

  try {
    await ensureTables();

    // Save the entry
    const entity = await upsertEntry(userId, workbook, week, data);

    // Update rolling meta (streak, lastSeen, totalEntries)
    await refreshMeta(userId, week);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, savedAt: entity.savedAt, isoWeek: week },
    };
  } catch (err) {
    context.log.error("save error", err.message);
    context.res = { status: 500, body: { error: "Storage error", detail: err.message } };
  }
};

// ── Recalculate streak & meta ─────────────────────────────────────────────────
async function refreshMeta(userId, currentWeek) {
  const allEntries = await listEntries(userId, 100);
  const weeks = [...new Set(allEntries.map(e => e.isoWeek))].sort().reverse();

  let streak = 0;
  let expected = currentWeek;
  for (const w of weeks) {
    if (w === expected) {
      streak++;
      expected = prevWeek(expected);
    } else {
      break;
    }
  }

  await upsertMeta(userId, {
    lastSeen:     new Date().toISOString(),
    streakWeeks:  streak,
    totalEntries: allEntries.length,
    lastWeek:     currentWeek,
  });
}

// Return the ISO week string for the week before a given one
function prevWeek(isoWeek) {
  const [year, wNum] = isoWeek.split("-W").map(Number);
  // Convert ISO week → date → subtract 7 days → back to ISO week
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (wNum - 1) * 7);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  const d = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate()));
  const dn = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dn);
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wn = Math.ceil((((d - ys) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`;
}
