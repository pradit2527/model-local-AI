# Start the local Ollama server (portable, inside this folder), register the model once, then open a chat.
#   .\run.ps1            -> chat in the terminal
#   .\run.ps1 -Web       -> start the server and open the web chat at http://127.0.0.1:8765/chat.html
#   .\run.ps1 -ServeOnly -> only start the server (API at http://127.0.0.1:11434)
param([switch]$ServeOnly, [switch]$Web)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ollama = Join-Path $root 'runtime\ollama\ollama.exe'
$model  = 'dan-qwen3'

$env:OLLAMA_MODELS = Join-Path $root 'ollama-store'   # keep model blobs inside D:\ai-midel
$env:OLLAMA_HOST   = '127.0.0.1:11434'                 # local only

function Test-Server {
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Server)) {
    Write-Host 'Starting Ollama server...'
    $log = Join-Path $root 'logs\ollama-server.log'
    Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden `
        -RedirectStandardError $log -RedirectStandardOutput (Join-Path $root 'logs\ollama-server.out.log')
    # first start scans GPUs and can take ~1 minute
    for ($i = 0; $i -lt 120 -and -not (Test-Server); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Server)) { throw "Ollama server did not start. See $log" }
}

$names = (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags').models.name
if ($names -notcontains "${model}:latest") {
    Write-Host "Registering model $model ..."
    Push-Location $root
    try { & $ollama create $model -f (Join-Path $root 'Modelfile') } finally { Pop-Location }
}

Write-Host "Ready: model '$model' at http://127.0.0.1:11434"

if ($Web) {
    & (Join-Path $root 'bridge\start-bridge.ps1') -OllamaUrl 'http://127.0.0.1:11434'
    Start-Process 'http://127.0.0.1:8765/'
    Write-Host 'Web chat: http://127.0.0.1:8765/'
}
elseif (-not $ServeOnly) { & $ollama run $model }
