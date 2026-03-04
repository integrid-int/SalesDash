// api/ping/index.js
// GET /api/ping  — unauthenticated health check
// Returns storage connectivity status and env var presence.
// Remove this endpoint once storage is confirmed working.

module.exports = async function (context, req) {
  const cs = process.env.STORAGE_CONNECTION_STRING;

  const result = {
    ok: false,
    envVarSet: !!cs,
    envVarPrefix: cs ? cs.substring(0, 50) + "..." : null,
    storageReachable: false,
    error: null,
    nodeVersion: process.version,
  };

  if (!cs) {
    result.error = "STORAGE_CONNECTION_STRING is not set in Application Settings.";
    context.res = { status: 200, headers: { "Content-Type": "application/json" }, body: result };
    return;
  }

  try {
    // Dynamic require so a missing module returns 200 with error info instead of crashing
    const { TableServiceClient } = require("@azure/data-tables");
    const svc = TableServiceClient.fromConnectionString(cs);
    const iter = svc.listTables();
    await iter.next();
    result.storageReachable = true;
    result.ok = true;
  } catch (err) {
    result.error = err.message;
  }

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: result,
  };
};
