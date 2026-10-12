# Runs the ASP.NET host on http://localhost:5267 (serves the built client at /app/).
# Usage:
#   powershell -File scripts/run-dev.ps1            # real database, data is persisted
#   powershell -File scripts/run-dev.ps1 -Sandbox   # real database, but nothing is ever committed (rolled back on exit)
param([switch]$Sandbox)

$ErrorActionPreference = 'Stop'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'http://localhost:5267'
if ($Sandbox) { $env:Db__Sandbox = 'true'; Write-Host 'SANDBOX: writes are rolled back when you stop the server.' -ForegroundColor Yellow }

dotnet run --project (Join-Path $PSScriptRoot '..\SRV_Demo\SRV_Demo.csproj') --no-launch-profile
