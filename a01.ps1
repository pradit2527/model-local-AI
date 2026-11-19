# Use the models on A01 (10.0.1.183, RTX 4060 Ti 8GB) from this PC through an SSH tunnel.
# Nothing is opened on A01's firewall: our Ollama there listens on 127.0.0.1:11500 only
# (11434/11435 on A01 belong to the NVIDIA Personal AI Router).
#   .\a01.ps1          -> start the A01 server, open the tunnel, open the web chat
#   .\a01.ps1 -NoWeb   -> same without the web chat (API at http://127.0.0.1:11500)
#   .\a01.ps1 -Deploy  -> copy a01\* scripts/Modelfiles to A01 first
#   .\a01.ps1 -Stop    -> close the tunnel and stop the A01 server
param([switch]$Stop, [switch]$Deploy, [switch]$NoWeb)

$ErrorActionPreference = 'Stop'
$root  = $PSScriptRoot
$key   = "$env:USERPROFILE\.ssh\a01_alexs_ed25519"
$target = 'alexs@10.0.1.183'
$ssh   = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp   = 'C:\Windows\System32\OpenSSH\scp.exe'
$port  = 11500

function Invoke-A01([string]$file) {
    & $ssh -i $key -o BatchMode=yes -o ConnectTimeout=10 $target "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File D:\ai-midel\$file" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "A01: $file failed (exit $LASTEXITCODE)" }
}
function Get-Tunnel {   # the reconnecting wrapper (tunnel.ps1) and any ssh it started
    Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*tunnel.ps1*') -or
        ($_.Name -eq 'ssh.exe' -and $_.CommandLine -like "*-L ${port}:127.0.0.1:${port}*") }
}

if ($Stop) {
    Get-Tunnel | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bridge\server.js*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Invoke-A01 'stop-server.ps1'
    Invoke-A01 'stop-comfy.ps1'
    return
}

if ($Deploy) {
    & $scp -i $key -o BatchMode=yes -q (Get-ChildItem "$root\a01\*").FullName "${target}:/D:/ai-midel/"
    Write-Host 'Deployed a01\* to A01:D:\ai-midel'
}

Invoke-A01 'start-server.ps1'
# image/video engine (ComfyUI); it refuses to start while the GPU is reserved for training
try { Invoke-A01 'start-comfy.ps1' } catch { Write-Host "comfy: $_" }

$t = Get-Tunnel
if (-not ($t | Where-Object { $_.CommandLine -like '*tunnel.ps1*' })) {
    $t | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }   # old one-shot tunnel
    Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$root\tunnel.ps1`"")
    for ($i = 0; $i -lt 15; $i++) { Start-Sleep 1; try { Invoke-RestMethod "http://127.0.0.1:$port/api/version" -TimeoutSec 2 | Out-Null; break } catch {} }
}
$names = (Invoke-RestMethod "http://127.0.0.1:$port/api/tags" -TimeoutSec 10).models.name
Write-Host "Tunnel up: http://127.0.0.1:$port -> A01  models: $($names -join ', ')"

if (-not $NoWeb) {
    & "$root\bridge\start-bridge.ps1" -OllamaUrl "http://127.0.0.1:$port"
    Start-Process 'http://127.0.0.1:8765/'
}
