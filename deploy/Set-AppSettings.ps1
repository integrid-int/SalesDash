<#
.SYNOPSIS
    Updates Azure Static Web App application settings.

.DESCRIPTION
    Use after a storage account key rotation, or to add/update any
    SWA app setting without redeploying infrastructure.

.PARAMETER ResourceGroup
    Resource group containing the SWA.

.PARAMETER SwaName
    Name of the Azure Static Web App resource.

.PARAMETER StorageAccountName
    Storage account name. If provided, STORAGE_CONNECTION_STRING is
    automatically rebuilt from the account's primary key.

.PARAMETER ExtraSettings
    Hashtable of additional settings to set, e.g.
    @{ MY_SETTING = "value" }

.EXAMPLE
    # Rotate storage key
    pwsh deploy/Set-AppSettings.ps1 `
        -ResourceGroup rg-integrid-salesdash `
        -SwaName integrid-workbook-swa `
        -StorageAccountName integridworkbookstor

.EXAMPLE
    # Add a custom setting
    pwsh deploy/Set-AppSettings.ps1 `
        -ResourceGroup rg-integrid-salesdash `
        -SwaName integrid-workbook-swa `
        -ExtraSettings @{ FEATURE_FLAG = "true" }
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory)] [string]   $ResourceGroup,
    [Parameter(Mandatory)] [string]   $SwaName,
    [string]    $StorageAccountName = "",
    [hashtable] $ExtraSettings      = @{}
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "`n▶  $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   ✓  $msg" -ForegroundColor Green }

# ── Auth check ────────────────────────────────────────────────────────────────

Write-Step "Checking Azure login"
$ctx = Get-AzContext -ErrorAction SilentlyContinue
if (-not $ctx) { Connect-AzAccount | Out-Null }
Write-OK (Get-AzContext).Account.Id

# ── Get existing settings ─────────────────────────────────────────────────────

Write-Step "Reading current app settings from $SwaName"

$subId   = (Get-AzContext).Subscription.Id
$token   = (Get-AzAccessToken).Token
$baseUri = "https://management.azure.com/subscriptions/$subId/resourceGroups/$ResourceGroup" +
           "/providers/Microsoft.Web/staticSites/$SwaName"
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

$existing = Invoke-RestMethod -Uri "$baseUri/config/appsettings?api-version=2023-01-01" `
    -Method Get -Headers $headers
$settings = @{}
if ($existing.properties) {
    $existing.properties.PSObject.Properties | ForEach-Object { $settings[$_.Name] = $_.Value }
}
Write-OK "Loaded $($settings.Count) existing setting(s)"

# ── Rebuild storage connection string ─────────────────────────────────────────

if ($StorageAccountName -ne "") {
    Write-Step "Rotating storage connection string for $StorageAccountName"
    $keys = Get-AzStorageAccountKey -ResourceGroupName $ResourceGroup -Name $StorageAccountName
    $key  = $keys[0].Value
    $settings["STORAGE_CONNECTION_STRING"] =
        "DefaultEndpointsProtocol=https;AccountName=$StorageAccountName;" +
        "AccountKey=$key;EndpointSuffix=core.windows.net"
    Write-OK "STORAGE_CONNECTION_STRING updated"
}

# ── Apply extra settings ──────────────────────────────────────────────────────

foreach ($kv in $ExtraSettings.GetEnumerator()) {
    $settings[$kv.Key] = $kv.Value
    Write-OK "$($kv.Key) = $($kv.Value)"
}

# ── Push settings ─────────────────────────────────────────────────────────────

Write-Step "Writing $($settings.Count) setting(s) to $SwaName"

$body = @{ properties = $settings } | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "$baseUri/config/appsettings?api-version=2023-01-01" `
    -Method Put -Headers $headers -Body $body | Out-Null

Write-OK "Done. Changes take effect on next request (no redeploy needed)."
