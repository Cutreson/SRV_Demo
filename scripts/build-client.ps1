# Builds the React client (SRV_Demo/ClientApp) into SRV_Demo/wwwroot/app so ASP.NET can serve it at /app/.
# Usage:  powershell -File scripts/build-client.ps1 [-Test]
param([switch]$Test)

$ErrorActionPreference = 'Stop'
$client = Join-Path $PSScriptRoot '..\SRV_Demo\ClientApp'
Push-Location $client
try {
    if (-not (Test-Path 'node_modules')) { npm install --no-audit --no-fund }
    npm run typecheck
    if ($Test) { npm test }
    npm run build
} finally {
    Pop-Location
}
Write-Host "Client built -> SRV_Demo/wwwroot/app" -ForegroundColor Green
