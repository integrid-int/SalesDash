/**
 * workbook-storage.js
 * ───────────────────
 * Drop this script into any workbook page. It provides:
 *   Update
 *   WorkbookStorage.init(workbookKey, collectFn, populateFn)
 *     workbookKey  : "audit" | "growth"
 *     collectFn()  : returns a plain JS object with all current field values
 *     populateFn(data) : receives saved data object and repopulates the UI
 *
 * The module will:
 *   1. On init  — call GET /api/load for the current ISO week and run populateFn
 *   2. On every DOM "input" event — debounce 1.5s then POST /api/save
 *   3. Expose WorkbookStorage.saveNow() for explicit saves (e.g. before print)
 *   4. Show a subtle save-status indicator (injected into #saveStatus if present)
 */

const WorkbookStorage = (() => {
  let _workbook   = null;
  let _collectFn  = null;
  let _populateFn = null;
  let _debounce   = null;
  let _isoWeek    = null;
  let _saving     = false;

  // ── ISO week ──────────────────────────────────────────────────────────────
  function currentISOWeek() {
    const now = new Date();
    const d   = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yr  = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const wk  = Math.ceil((((d - yr) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
  }

  // ── Status indicator ──────────────────────────────────────────────────────
  function setStatus(state, text) {
    const el = document.getElementById("saveStatus");
    if (!el) return;
    const colors = { saving: "#F59E0B", saved: "#10B981", error: "#EF4444", idle: "#94A3B8" };
    el.style.color = colors[state] || colors.idle;
    el.textContent = text;
  }

  // ── Load on init ──────────────────────────────────────────────────────────
  async function loadCurrentWeek() {
    setStatus("saving", "Loading…");
    try {
      const res  = await fetch(`/api/load?workbook=${_workbook}&week=${_isoWeek}`);
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.found && json.data && _populateFn) {
        _populateFn(json.data);
        const ago = json.savedAt ? timeSince(json.savedAt) : "";
        setStatus("saved", ago ? `Last saved ${ago}` : "Loaded");
      } else {
        setStatus("idle", "New entry");
      }
    } catch (err) {
      console.warn("WorkbookStorage load failed:", err.message);
      setStatus("idle", "Could not load — working offline");
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function doSave() {
    if (_saving || !_collectFn) return;
    _saving = true;
    setStatus("saving", "Saving…");
    try {
      const data = _collectFn();
      const res  = await fetch("/api/save", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ workbook: _workbook, isoWeek: _isoWeek, data }),
      });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("saved", `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } catch (err) {
      console.warn("WorkbookStorage save failed:", err.message);
      setStatus("error", "Save failed — check connection");
    } finally {
      _saving = false;
    }
  }

  // ── Debounced input handler ───────────────────────────────────────────────
  function onInput() {
    setStatus("saving", "Unsaved changes…");
    clearTimeout(_debounce);
    _debounce = setTimeout(doSave, 1500);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function init(workbookKey, collectFn, populateFn) {
    _workbook   = workbookKey;
    _collectFn  = collectFn;
    _populateFn = populateFn;
    _isoWeek    = currentISOWeek();

    // Attach global listener — catches all inputs/textareas/selects
    document.addEventListener("input", onInput);

    // Load existing data for current week
    loadCurrentWeek();

    // Save before print (PDF export)
    window.addEventListener("beforeprint", () => {
      clearTimeout(_debounce);
      doSave();
    });

    console.log(`[WorkbookStorage] init — workbook=${_workbook} week=${_isoWeek}`);
  }

  function saveNow() {
    clearTimeout(_debounce);
    return doSave();
  }

  function getWeek() { return _isoWeek; }

  // ── Utility: human-readable time ago ─────────────────────────────────────
  function timeSince(isoString) {
    const ms   = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return { init, saveNow, getWeek };
})();
