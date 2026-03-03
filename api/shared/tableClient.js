// shared/tableClient.js
// Single place to initialise the Azure Table Storage client and
// define the two tables used across all functions.
//
// Tables
// ──────
// "workbookEntries"
//   PartitionKey : userId   (OID from the Entra ID token, stable across sessions)
//   RowKey       : <workbook>_<isoWeek>   e.g. "audit_2026-W09"
//   Columns      : workbook, isoWeek, savedAt (ISO string), data (JSON string)
//
// "workbookMeta"
//   PartitionKey : userId
//   RowKey       : "meta"
//   Columns      : lastSeen (ISO string), streakWeeks (number), totalEntries (number)

const { TableClient, TableServiceClient, odata } = require("@azure/data-tables");

const CONNECTION_STRING = process.env.STORAGE_CONNECTION_STRING;
const ENTRIES_TABLE = "workbookEntries";
const META_TABLE    = "workbookMeta";

// ── Client factory ────────────────────────────────────────────────────────────
function getClient(tableName) {
  if (!CONNECTION_STRING) {
    throw new Error("STORAGE_CONNECTION_STRING app setting is not configured.");
  }
  return TableClient.fromConnectionString(CONNECTION_STRING, tableName);
}

// ── Ensure tables exist (called once per cold start) ─────────────────────────
let _tablesReady = false;
async function ensureTables() {
  if (_tablesReady) return;
  const svc = TableServiceClient.fromConnectionString(CONNECTION_STRING);
  await Promise.all([
    svc.createTable(ENTRIES_TABLE).catch(() => {}),
    svc.createTable(META_TABLE).catch(() => {}),
  ]);
  _tablesReady = true;
}

// ── ISO week helper  (e.g. "2026-W09") ───────────────────────────────────────
function toISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// ── Extract userId from the Static Web Apps injected header ──────────────────
function getUserId(req) {
  // Azure SWA injects X-MS-CLIENT-PRINCIPAL as base64-encoded JSON
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const principal = JSON.parse(decoded);
    // userId = the stable OID claim
    const oidClaim = (principal.claims || []).find(
      c => c.typ === "oid" || c.typ === "http://schemas.microsoft.com/identity/claims/objectidentifier"
    );
    return oidClaim ? oidClaim.val : principal.userId || null;
  } catch {
    return null;
  }
}

// ── Upsert a workbook entry ───────────────────────────────────────────────────
async function upsertEntry(userId, workbook, isoWeek, data) {
  const client = getClient(ENTRIES_TABLE);
  const entity = {
    partitionKey: userId,
    rowKey:       `${workbook}_${isoWeek}`,
    workbook,
    isoWeek,
    savedAt:      new Date().toISOString(),
    data:         JSON.stringify(data),
  };
  await client.upsertEntity(entity, "Replace");
  return entity;
}

// ── Load a single entry ───────────────────────────────────────────────────────
async function loadEntry(userId, workbook, isoWeek) {
  const client = getClient(ENTRIES_TABLE);
  try {
    const entity = await client.getEntity(userId, `${workbook}_${isoWeek}`);
    return { ...entity, data: JSON.parse(entity.data || "{}") };
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

// ── List recent entries for a user ───────────────────────────────────────────
async function listEntries(userId, limit = 20) {
  const client = getClient(ENTRIES_TABLE);
  const results = [];
  const iter = client.listEntities({
    queryOptions: { filter: odata`PartitionKey eq ${userId}` },
  });
  for await (const entity of iter) {
    results.push({ ...entity, data: JSON.parse(entity.data || "{}") });
    if (results.length >= limit) break;
  }
  // Sort newest first by savedAt
  results.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  return results;
}

// ── Get / upsert user meta ────────────────────────────────────────────────────
async function getMeta(userId) {
  const client = getClient(META_TABLE);
  try {
    return await client.getEntity(userId, "meta");
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function upsertMeta(userId, fields) {
  const client = getClient(META_TABLE);
  const existing = await getMeta(userId) || { partitionKey: userId, rowKey: "meta" };
  const entity = { ...existing, ...fields, partitionKey: userId, rowKey: "meta" };
  await client.upsertEntity(entity, "Replace");
  return entity;
}

module.exports = {
  ensureTables,
  toISOWeek,
  getUserId,
  upsertEntry,
  loadEntry,
  listEntries,
  getMeta,
  upsertMeta,
  ENTRIES_TABLE,
  META_TABLE,
};
