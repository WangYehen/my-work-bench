$ErrorActionPreference = 'Stop'

$workbenchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = 'C:\Program Files\nodejs\node.exe'
$ports = @(5174, 8787)

Set-Location $workbenchRoot

Write-Host 'Stopping Workbench services...' -ForegroundColor Yellow
$owners = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

foreach ($owner in $owners) {
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

if (-not (Test-Path $nodePath)) {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
}

Write-Host 'Starting Vite and team server...' -ForegroundColor Cyan
Start-Process -WindowStyle Hidden `
    -FilePath $nodePath `
    -ArgumentList @('.\node_modules\vite\bin\vite.js', '--host', '127.0.0.1') `
    -WorkingDirectory $workbenchRoot

Start-Process -WindowStyle Hidden `
    -FilePath $nodePath `
    -ArgumentList @('--env-file=.env', 'team-server/server.mjs') `
    -WorkingDirectory $workbenchRoot

$ready = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $ui = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5174' -TimeoutSec 2
        $api = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8787/healthz' -TimeoutSec 2
        if ($ui.StatusCode -eq 200 -and $api.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        # Services are still starting.
    }
}

if (-not $ready) {
    Write-Error 'Workbench failed to become healthy. Check the service processes and .env configuration.'
    exit 1
}

Write-Host 'Workbench restarted successfully.' -ForegroundColor Green
Write-Host 'UI:  http://127.0.0.1:5174'
Write-Host 'API: http://127.0.0.1:8787/healthz'
