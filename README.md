# Integrid Sales Workbook

Azure Static Web App — weekly sales workbooks with a live dashboard, autosave, history, and admin tools. Secured with Microsoft Entra ID (Azure AD). Installable as a PWA on iOS.

---

## Architecture

```
Browser (PWA-capable)
  └─ Azure Static Web App  (public/)
       ├─ index.html                  — dashboard, workbook launcher, history
       ├─ integrid_time_audit.html    — Time Audit & RGA workbook
       ├─ integrid_weekly_growth.html — Weekly Growth workbook (3-page)
       ├─ integrid_daily_plan.html    — Daily Plan workbook (Mon–Fri)
       ├─ integrid_12week_push.html   — 12-Week Push workbook
       ├─ admin.html                  — entry manager (view + delete)
       ├─ login.html                  — sign-in landing page
       ├─ workbook-storage.js         — autosave module (debounced, ?week= support)
       ├─ manifest.json               — PWA manifest
       └─ sw.js                       — service worker (app shell cache)

  └─ Azure Functions  (api/)   — Node 20, managed by SWA
       ├─ POST /api/save       — upsert workbook entry + recalculate streak
       ├─ GET  /api/load       — load entry for a specific week
       ├─ GET  /api/dashboard  — aggregated stats for all workbooks
       ├─ GET  /api/history    — last N entries across all workbooks
       ├─ POST /api/delete     — delete a specific entry (admin)
       └─ GET  /api/ping       — health check (anonymous)

  └─ Azure Table Storage
       ├─ workbookEntries      — one row per user × workbook × ISO week
       └─ workbookMeta         — streak, lastSeen, totalEntries per user
```

**Auth:** Microsoft Entra ID via SWA's built-in managed identity provider.
`/api/*` routes require authentication at the routing level. Pages use a JS guard
(`/.auth/me`) that redirects unauthenticated users to `/login.html`.

---

## Quick Start — Automated (≈ 15 min)

### Prerequisites

| Tool | Install |
|------|---------|
| PowerShell 7+ | `winget install Microsoft.PowerShell` |
| Az PowerShell module | `Install-Module Az -Scope CurrentUser` |
| GitHub CLI *(optional, for auto-setting secret)* | `winget install GitHub.cli` |
| Git | `winget install Git.Git` |

### 1. Clone the repo

```powershell
git clone https://github.com/integrid-int/SalesDash.git
cd SalesDash
```

### 2. Run the deployment script

```powershell
pwsh deploy/Deploy-All.ps1 `
    -ResourceGroup  rg-integrid-salesdash `
    -AppName        integrid-workbook `
    -GithubRepo     https://github.com/integrid-int/SalesDash `
    -GithubPat      ghp_xxxx `
    -SetGithubSecret
```

The script will:
- Create the resource group (if needed)
- Deploy [azuredeploy.json](azuredeploy.json) — storage account, both Azure Tables, and the Static Web App
- Wire `STORAGE_CONNECTION_STRING` into SWA app settings automatically
- Retrieve the SWA deployment token
- Set `AZURE_STATIC_WEB_APPS_API_TOKEN` in GitHub Actions secrets (if `gh` CLI is present)

> **GitHub PAT scopes required:** `repo` (to link SWA to GitHub and set secrets)

### 3. Enable Entra ID authentication

This is a one-time manual step in the Azure Portal:

1. Portal → **your SWA** → **Authentication**
2. Click **Add identity provider**
3. Choose **Microsoft**
4. Leave defaults — Azure creates and registers the Entra app automatically
5. Set **Restrict access** → **Require authentication**
6. Click **Add**

### 4. Deploy the app

```bash
git push origin main
```

GitHub Actions deploys in ~2 minutes. Visit the URL printed by the script.

---

## Manual Setup (alternative to the script)

<details>
<summary>Expand manual steps</summary>

### 1. Create a resource group and storage account

```powershell
Connect-AzAccount
New-AzResourceGroup -Name rg-integrid-salesdash -Location eastus2

New-AzStorageAccount `
    -ResourceGroupName rg-integrid-salesdash `
    -Name              integridworkbookstor `
    -Location          eastus2 `
    -SkuName           Standard_LRS `
    -Kind              StorageV2

# Get the connection string
(Get-AzStorageAccountKey -ResourceGroupName rg-integrid-salesdash `
    -Name integridworkbookstor)[0].Value
```

### 2. Create the Static Web App (Portal)

1. Portal → **Create a resource** → **Static Web App**
2. Connect your GitHub repo
3. Build preset: **Custom**
4. App location: `public` · API location: `api` · Output location: *(blank)*
5. Click **Review + create**

### 3. Add the app setting

Portal → SWA → **Configuration** → **Application settings**:

| Name | Value |
|------|-------|
| `STORAGE_CONNECTION_STRING` | *(connection string from step 1)* |

### 4. Enable Entra ID authentication

Same as step 3 in the automated path above.

### 5. Add the GitHub Actions secret

Portal → SWA → **Manage deployment token** → copy value.
GitHub repo → **Settings → Secrets → Actions** → New secret:
- Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`
- Value: *(token from above)*

</details>

---

## Local Development

```powershell
# Install tooling (once)
npm install -g azure-functions-core-tools@4
npm install -g @azure/static-web-apps-cli

# Configure local settings
cp api/local.settings.json.example api/local.settings.json
# Edit api/local.settings.json — fill in your real STORAGE_CONNECTION_STRING

# Start everything
swa start public --api-location api
# → http://localhost:4280  (auth is simulated by SWA CLI)
```

---

## Maintenance Scripts

### Rotate storage account key

```powershell
pwsh deploy/Set-AppSettings.ps1 `
    -ResourceGroup      rg-integrid-salesdash `
    -SwaName            integrid-workbook-swa `
    -StorageAccountName integridworkbookstor
```

### Add or update an app setting

```powershell
pwsh deploy/Set-AppSettings.ps1 `
    -ResourceGroup  rg-integrid-salesdash `
    -SwaName        integrid-workbook-swa `
    -ExtraSettings  @{ MY_SETTING = "value" }
```

---

## App Settings Reference

| Setting | Where set | Description |
|---------|-----------|-------------|
| `STORAGE_CONNECTION_STRING` | ARM template / script | Azure Table Storage connection string |

> `FUNCTIONS_WORKER_RUNTIME` and `AzureWebJobsStorage` are reserved by SWA and cannot be set manually.

---

## Routing & Auth

`public/staticwebapp.config.json` controls routing:

| Route | Rule |
|-------|------|
| `/api/ping` | Anonymous (health check) |
| `/api/*` | Requires `authenticated` role |
| `/.auth/logout` | Redirects to `/` |
| All pages | JS guard — redirects unauthenticated users to `/login.html` |

After Entra login, users land on `/` (the dashboard). The sign-in page is `/login.html`.

---

## Data Model

### `workbookEntries` table

| Column | Type | Example |
|--------|------|---------|
| PartitionKey | string | `"abc123-oid-from-entra"` |
| RowKey | string | `"audit_2026-W09"` |
| workbook | string | `"audit"` · `"growth"` · `"daily"` · `"push"` |
| isoWeek | string | `"2026-W09"` |
| savedAt | ISO string | `"2026-03-02T14:30:00.000Z"` |
| data | JSON string | workbook-specific fields object |
| summary | string | human-readable summary (filled by API) |

### `workbookMeta` table

| Column | Type | Description |
|--------|------|-------------|
| PartitionKey | string | userId (Entra OID) |
| RowKey | string | `"meta"` |
| streakWeeks | number | Consecutive weeks with any save |
| totalEntries | number | All-time entry count |
| lastSeen | ISO string | Last save timestamp |
| lastWeek | string | ISO week of last save |

---

## API Reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/save` | Required | Upsert a workbook entry. Body: `{ workbook, isoWeek?, data }` |
| `GET` | `/api/load` | Required | Load entry. Query: `?workbook=&week=` |
| `GET` | `/api/dashboard` | Required | Aggregated stats for all workbooks |
| `GET` | `/api/history` | Required | Recent entries. Query: `?workbook=&limit=` |
| `POST` | `/api/delete` | Required | Delete entry. Body: `{ workbook, isoWeek }` |
| `GET` | `/api/ping` | None | Health check. Returns `{ ok: true }` |

**Valid workbook keys:** `audit` · `growth` · `daily` · `push`

---

## Adding a New Workbook

1. Create `public/your-workbook.html`
   - Include `<script src="workbook-storage.js"></script>`
   - Call `WorkbookStorage.init("your-key", collectFn, populateFn)` at the bottom
2. Add `"your-key"` to the `VALID_WORKBOOKS` array in:
   - `api/save/index.js`
   - `api/load/index.js`
   - `api/delete/index.js`
3. Add a card to `public/index.html` in the workbook library section
4. Add the HTML file to the `SHELL` array in `public/sw.js`
5. Push — GitHub Actions deploys automatically

---

## iOS / PWA Installation

The app is a Progressive Web App. To install on iOS:

1. Open the site in **Safari** (must be Safari)
2. Tap **Share** → **Add to Home Screen**
3. The app launches full-screen with no browser chrome

The service worker (`sw.js`) pre-caches the app shell so workbooks open
instantly even on slow connections.

---

## Admin

Navigate to `/admin.html` (link in the dashboard nav). Requires authentication.

- View all saved entries across all users/workbooks
- Filter by workbook type
- Delete entries with inline confirmation

---

## Cost Estimate

| Resource | Tier | Monthly cost |
|----------|------|-------------|
| Azure Static Web Apps | Free | $0 |
| Azure Functions (bundled with SWA Free) | Included | $0 |
| Azure Table Storage (< 1 GB, LRS) | Pay-as-you-go | ~$0.05 |
| **Total** | | **~$0.05** |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| All API calls return 500 | `platform.apiRuntime` missing | Ensure `"apiRuntime": "node:20"` in `staticwebapp.config.json` |
| Auth redirect loops | Post-login redirect URL issue | Check JS guard in `index.html` — redirect should go to `/login.html` |
| `/.auth/login/aad` returns 401 | SWA managed auth not configured | Portal → SWA → Authentication → Add Microsoft provider |
| Storage errors | Connection string not set | Run `deploy/Set-AppSettings.ps1` or check Portal → Configuration |
| `host.json` syntax error | Trailing comma in JSON | Validate `api/host.json` with a JSON linter |
