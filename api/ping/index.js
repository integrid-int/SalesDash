// api/ping/index.js
// GET /api/ping  — unauthenticated health check (zero dependencies)
// If this returns 500, the Functions host is not starting.
// Remove this endpoint once storage is confirmed working.

module.exports = async function (context, req) {
  const cs = process.env.STORAGE_CONNECTION_STRING;
  const aws = process.env.AzureWebJobsStorage;

  const result = {
    ok: true,
    hostStarted: true,
    nodeVersion: process.version,
    storageConnStringSet: !!cs,
    azureWebJobsStorageSet: !!aws,
    envVarPrefix: cs ? cs.substring(0, 40) + "..." : null,
  };

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: result,
  };
};
