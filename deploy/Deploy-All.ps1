<#
.SYNOPSIS
    One-shot deployment of Integrid SalesDash to Azure.

.DESCRIPTION
    Creates the resource group, deploys azuredeploy.json (storage account +
    Azure Tables + Static Web App), retrieves the SWA deployment token, and
    optionally sets the AZURE_STATIC_WEB_APPS_API_TOKEN GitHub Actions secret.

    After this script completes, the only manual step remaining is enabling
    Entra ID (Microsoft) authentication in the Azure Portal.

.PARAMETER ResourceGroup
    Azure resource group name. Created if it doesn't exist.

.PARAMETER Location
    Azure region. Default: eastus2

.PARAMETER AppName
    Base name used to derive all resource names (storage account, SWA).
    Lowercase letters and hyphens only, max 14 chars before suffix.

.PARAMETER GithubRepo
    Full GitHub repo URL, e.g. https://github.com/integrid-int/SalesDash

.PARAMETER GithubBranch
    Branch to deploy from. Default: main

.PARAMETER GithubPat
    GitHub Personal Access Token with repo scope. Used by SWA to pull
    source and by this script to set the Actions secret.
    If omitted, you will be prompted.

.PARAMETER SetGithubSecret
    Switch. When set, automatically writes AZURE_STATIC_WEB_APPS_API_TOKEN
    to GitHub Actions secrets using the gh CLI. Requires gh to be installed
    and authenticated.

.EXAMPLE
    # Full automated deploy
    pwsh deploy/Deploy-All.ps1 `
        -ResourceGroup rg-integrid-salesdash `
        -AppName integrid-workbook `
        -GithubRepo https://github.com/integrid-int/SalesDash `
        -GithubPat ghp_xxxx `
        -SetGithubSecret

.EXAMPLE
    # Deploy without setting GitHub secret (copy-paste manually)
    pwsh deploy/Deploy-All.ps1 `
        -ResourceGroup rg-integrid-salesdash `
        -GithubPat ghp_xxxx
#>

[CmdletBinding()]
param (
    [string] $ResourceGroup  = "rg-integrid-salesdash",
    [string] $Location       = "eastus2",
    [string] $AppName        = "integrid-workbook",
    [string] $GithubRepo     = "https://github.com/integrid-int/SalesDash",
    [string] $GithubBranch   = "main",
    [string] $GithubPat      = "",
    [switch] $SetGithubSecret
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Step([string]$msg) {
    Write-Host "`n▶  $msg" -ForegroundColor Cyan
}
function Write-OK([string]$msg) {
    Write-Host "   ✓  $msg" -ForegroundColor Green
}
function Write-Warn([string]$msg) {
    Write-Host "   ⚠  $msg" -ForegroundColor Yellow
}

# ── Prerequisites ─────────────────────────────────────────────────────────────

Write-Step "Checking prerequisites"

if (-not (Get-Module -ListAvailable -Name Az.Accounts)) {
    Write-Error "Az PowerShell module not found. Install with: Install-Module Az -Scope CurrentUser"
}

$ctx = Get-AzContext -ErrorAction SilentlyContinue
if (-not $ctx) {
    Write-Warn "Not logged in to Azure. Running Connect-AzAccount..."
    Connect-AzAccount | Out-Null
    $ctx = Get-AzContext
}
Write-OK "Azure: $($ctx.Account.Id) / $($ctx.Subscription.Name)"

if ($GithubPat -eq "") {
    $secPat = Read-Host "GitHub PAT (repo scope)" -AsSecureString
    $GithubPat = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPat)
    )
}

# ── Resource Group ────────────────────────────────────────────────────────────

Write-Step "Resource group: $ResourceGroup"

$rg = Get-AzResourceGroup -Name $ResourceGroup -ErrorAction SilentlyContinue
if ($rg) {
    Write-OK "Already exists in $($rg.Location)"
} else {
    New-AzResourceGroup -Name $ResourceGroup -Location $Location | Out-Null
    Write-OK "Created in $Location"
}

# ── ARM Deployment ────────────────────────────────────────────────────────────

Write-Step "Deploying ARM template (storage + tables + SWA)..."

$templateFile = Join-Path $PSScriptRoot ".." "azuredeploy.json"
$deployName   = "integrid-deploy-$(Get-Date -Format 'yyyyMMddHHmm')"

$params = @{
    appName       = $AppName
    location      = $Location
    githubRepoUrl = $GithubRepo
    githubBranch  = $GithubBranch
    githubToken   = $GithubPat
}

$deploy = New-AzResourceGroupDeployment `
    -ResourceGroupName  $ResourceGroup `
    -Name               $deployName `
    -TemplateFile       $templateFile `
    -TemplateParameterObject $params `
    -Mode Incremental

if ($deploy.ProvisioningState -ne "Succeeded") {
    Write-Error "ARM deployment failed. State: $($deploy.ProvisioningState)"
}

$swaUrl      = $deploy.Outputs["swaUrl"].Value
$swaName     = $deploy.Outputs["swaName"].Value
$storageName = $deploy.Outputs["storageAccountName"].Value

Write-OK "Storage account : $storageName"
Write-OK "Static Web App  : $swaName"
Write-OK "App URL         : $swaUrl"

# ── SWA Deployment Token ──────────────────────────────────────────────────────

Write-Step "Retrieving SWA deployment token"

# The Az.Websites module exposes Get-AzStaticWebAppSecret
$tokenObj = $null
try {
    $tokenObj = Get-AzStaticWebAppSecret -ResourceGroupName $ResourceGroup -Name $swaName
    $deployToken = $tokenObj.Properties.ApiKey
    Write-OK "Token retrieved"
} catch {
    Write-Warn "Could not retrieve token via Az module. Trying REST API..."
    $token  = (Get-AzAccessToken).Token
    $subId  = (Get-AzContext).Subscription.Id
    $uri    = "https://management.azure.com/subscriptions/$subId/resourceGroups/$ResourceGroup" +
              "/providers/Microsoft.Web/staticSites/$swaName/listSecrets?api-version=2023-01-01"
    $resp   = Invoke-RestMethod -Uri $uri -Method Post -Headers @{ Authorization = "Bearer $token" }
    $deployToken = $resp.properties.apiKey
    Write-OK "Token retrieved via REST"
}

# ── GitHub Secret ─────────────────────────────────────────────────────────────

if ($SetGithubSecret) {
    Write-Step "Setting GitHub Actions secret AZURE_STATIC_WEB_APPS_API_TOKEN"

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Warn "gh CLI not found. Skipping automatic secret set."
        Write-Warn "Manually add the secret shown below."
    } else {
        # Extract org/repo from URL
        $repoSlug = ($GithubRepo -replace "https://github.com/","").TrimEnd("/")
        $env:AZURE_STATIC_WEB_APPS_API_TOKEN = $deployToken
        gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN `
            --repo $repoSlug `
            --body $deployToken
        Write-OK "Secret set on $repoSlug"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Deployment complete!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  App URL    : $swaUrl"
Write-Host "  SWA Name   : $swaName"
Write-Host "  Storage    : $storageName"
Write-Host ""
Write-Host "  SWA Deployment Token (add as GitHub secret):" -ForegroundColor Yellow
Write-Host "  Secret name  : AZURE_STATIC_WEB_APPS_API_TOKEN"
Write-Host "  Secret value : $deployToken"
Write-Host ""
Write-Host "  ── Next Steps ─────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  1. Add GitHub secret if not done above."
Write-Host "     Repo → Settings → Secrets → Actions → New secret"
Write-Host ""
Write-Host "  2. Enable Entra ID (Microsoft) authentication:"
Write-Host "     Portal → $swaName → Authentication → Add provider"
Write-Host "     Choose 'Microsoft' → let Azure create the app registration"
Write-Host "     Restrict access: 'Require authentication'"
Write-Host ""
Write-Host "  3. Push to $GithubBranch to trigger first deploy:"
Write-Host "     git push origin $GithubBranch"
Write-Host ""
Write-Host "  4. After deploy (~2 min), visit:"
Write-Host "     $swaUrl"
Write-Host ""
