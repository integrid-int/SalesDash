# Integrid Sales Workbook

Azure Static Web App with Entra ID auth, Azure Table Storage, and four Azure Functions.

---

## Architecture

```
Browser
  └─ Azure Static Web App  (public/)
       ├─ index.html          — lander + live dashboard
       ├─ integrid_time_audit.html
       ├─ integrid_weekly_growth.html
       └─ workbook-storage.js — client autosave module

  └─ Azure Functions  (api/)
       ├─ POST /api/save       — upsert workbook entry
       ├─ GET  /api/load       — load entry for a week
       ├─ GET  /api/dashboard  — aggregated dashboard stats
       └─ GET  /api/history    — last N entries (sparklines)

  └─ Azure Table Storage
       ├─ workbookEntries      — one row per user × workbook × week
       └─ workbookMeta         — streak, lastSeen, totalEntries
```

All `/api/*` routes and all pages require Entra ID (Microsoft) authentication,
enforced by Azure Static Web Apps before the request reaches your functions.

---

## One-time Setup (≈ 30 minutes)

### 1. Create Azure Resources

```bash
# Resource group
az group create --name rg-integrid-workbook --location eastus

# Storage account (LRS = cheapest, ~$0.07/GB/month)
az storage account create \
  --name stintegridwb \
  --resource-group rg-integrid-workbook \
  --sku Standard_LRS \
  --kind StorageV2

# Get the connection string — you'll need this in step 4
az storage account show-connection-string \
  --name stintegridwb \
  --resource-group rg-integrid-workbook \
  --query connectionString -o tsv
```

### 2. Register an Entra ID App

1. Go to **Azure Portal → Entra ID → App registrations → New registration**
2. Name: `Integrid Workbook`
3. Supported account types: **Accounts in this organizational directory only**
4. Redirect URI: leave blank for now (you'll add it after SWA is created)
5. Click **Register**
6. Note the **Application (client) ID**
7. Go to **Certificates & secrets → New client secret** — copy the value immediately

### 3. Create the Static Web App

**Option A — Azure Portal (easiest)**
1. Portal → Create a resource → Static Web App
2. Connect your GitHub repo
3. Build preset: **Custom**
4. App location: `public`
5. Api location: `api`
6. Output location: (leave blank)
7. Click **Review + create**

**Option B — CLI**
```bash
az staticwebapp create \
  --name swa-integrid-workbook \
  --resource-group rg-integrid-workbook \
  --source https://github.com/YOUR_ORG/YOUR_REPO \
  --branch main \
  --app-location public \
  --api-location api \
  --login-with-github
```

### 4. Add App Settings

In **Portal → Your SWA → Configuration → Application settings**, add:

| Name | Value |
|------|-------|
| `STORAGE_CONNECTION_STRING` | (connection string from step 1) |
| `AAD_CLIENT_ID` | (client ID from step 2) |
| `AAD_CLIENT_SECRET` | (client secret from step 2) |

### 5. Update Entra App Redirect URI

Once the SWA is deployed, go back to your Entra app registration:
- **Authentication → Add a platform → Web**
- Redirect URI: `https://YOUR-SWA-HOSTNAME.azurestaticapps.net/.auth/login/aad/callback`
- Also add your custom domain if you have one.

### 6. Add GitHub Secret

In your GitHub repo → **Settings → Secrets → Actions**, add:
- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- Value: get this from Portal → Your SWA → Manage deployment token

### 7. Push and Deploy

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

GitHub Actions runs automatically. Deployment takes ~2 minutes.

---

## Local Development

```bash
# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Install SWA CLI (proxies auth + API locally)
npm install -g @azure/static-web-apps-cli

# Copy and fill in local settings
cp api/local.settings.json.example api/local.settings.json
# Edit api/local.settings.json with your real Storage connection string

# Run everything together
swa start public --api-location api
```

The SWA CLI starts a proxy at `http://localhost:4280` that handles auth simulation
and routes `/api/*` calls to your local Functions runtime.

---

## Cost Estimate (your usage level)

| Resource | Tier | Cost |
|----------|------|------|
| Azure Static Web Apps | Free | $0/month |
| Azure Functions (API) | Included in SWA Free | $0/month |
| Azure Table Storage | LRS, < 1 GB | ~$0.05/month |
| **Total** | | **~$0.05/month** |

---

## Data Model

### workbookEntries table

| Column | Type | Example |
|--------|------|---------|
| PartitionKey | string | `"abc123-oid-from-entra"` |
| RowKey | string | `"audit_2026-W09"` |
| workbook | string | `"audit"` or `"growth"` |
| isoWeek | string | `"2026-W09"` |
| savedAt | ISO string | `"2026-03-02T14:30:00.000Z"` |
| data | JSON string | `{"lastH":{"rga":4,...},...}` |

### workbookMeta table

| Column | Type | Description |
|--------|------|-------------|
| PartitionKey | string | userId (Entra OID) |
| RowKey | string | `"meta"` |
| streakWeeks | number | Consecutive weeks with any entry |
| totalEntries | number | All-time entry count |
| lastSeen | ISO string | Last save timestamp |

---

## Adding a New Workbook

1. Create `public/your-workbook.html` — include `<script src="workbook-storage.js"></script>`
2. Call `WorkbookStorage.init("your-key", collectFn, populateFn)` at the bottom
3. Add `"your-key"` to the allowlist in `api/save/index.js` and `api/load/index.js`
4. Add a card to `public/index.html` and an entry in the `ROUTES` object
5. Push — deploys automatically

---

## Custom Domain

Portal → Your SWA → Custom domains → Add → follow the CNAME/TXT DNS instructions.
Takes ~5 minutes. TLS is provisioned automatically.
