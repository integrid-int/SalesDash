// api/load/index.js
// GET /api/load?workbook=audit&week=2026-W09
// Returns: { found: true|false, data: {...}, savedAt: "..." }

const { ensureTables, getUserId, loadEntry, toISOWeek } = require("../shared/tableClient");

module.exports = async function (context, req) {
  const userId = getUserId(req);
  if (!userId) {
    context.res = { status: 401, body: { error: "Not authenticated" } };
    return;
  }

  const workbook = req.query.workbook;
  const week     = req.query.week || toISOWeek();

  if (!workbook || !["audit", "growth", "push"].includes(workbook)) {
    context.res = { status: 400, body: { error: "workbook must be 'audit', 'growth', or 'push'" } };
    return;
  }

  try {
    await ensureTables();
    const entry = await loadEntry(userId, workbook, week);

    if (!entry) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { found: false, data: {}, isoWeek: week },
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        found:   true,
        data:    entry.data,
        savedAt: entry.savedAt,
        isoWeek: week,
      },
    };
  } catch (err) {
    context.log.error("load error", err.message);
    context.res = { status: 500, body: { error: "Storage error", detail: err.message } };
  }
};
