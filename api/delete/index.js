// api/delete/index.js
// POST /api/delete
// Body: { workbook: "audit"|"growth"|"daily"|"push", isoWeek: "2026-W09" }
// Deletes a single workbook entry and decrements the meta totalEntries counter.

const {
  ensureTables,
  getUserId,
  deleteEntry,
  getMeta,
  upsertMeta,
} = require("../shared/tableClient");

const VALID_WORKBOOKS = ["audit", "growth", "push", "daily"];

module.exports = async function (context, req) {
  const userId = getUserId(req);
  if (!userId) {
    context.res = { status: 401, body: { error: "Not authenticated" } };
    return;
  }

  const body     = req.body || {};
  const workbook = body.workbook;
  const isoWeek  = body.isoWeek;

  if (!workbook || !VALID_WORKBOOKS.includes(workbook)) {
    context.res = { status: 400, body: { error: "workbook must be one of: " + VALID_WORKBOOKS.join(", ") } };
    return;
  }
  if (!isoWeek || !/^\d{4}-W\d{2}$/.test(isoWeek)) {
    context.res = { status: 400, body: { error: "isoWeek must match YYYY-Wnn format" } };
    return;
  }

  try {
    await ensureTables();
    await deleteEntry(userId, workbook, isoWeek);

    // Decrement totalEntries in meta (best-effort — don't fail the request if meta is missing)
    try {
      const meta = await getMeta(userId);
      if (meta && (meta.totalEntries || 0) > 0) {
        await upsertMeta(userId, { totalEntries: meta.totalEntries - 1 });
      }
    } catch { /* non-fatal */ }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { deleted: true, workbook, isoWeek },
    };
  } catch (err) {
    if (err.statusCode === 404) {
      context.res = { status: 404, body: { error: "Entry not found" } };
      return;
    }
    context.log.error("delete error", err.message);
    context.res = { status: 500, body: { error: "Storage error", detail: err.message } };
  }
};
