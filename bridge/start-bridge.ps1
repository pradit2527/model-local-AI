# Start (or restart) the Absolute AI bridge on http://127.0.0.1:8765 pointing at the given Ollama.
param([string]$OllamaUrl = 'http://127.0.0.1:11434')
$here = $PSScriptRoot

function Get-Bridge { Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bridge\server.js*' } }
function Test-Page { try { Invoke-WebRequest 'http://127.0.0.1:8765/logo.svg' -UseBasicParsing -TimeoutSec 3 | Out-Null; $true } catch { $false } }

# already running against the same Ollama? keep it (/api/info also probes Ollama and ComfyUI, so allow it time)
if (Test-Page) {
    try { if ((Invoke-RestMethod 'http://127.0.0.1:8765/api/info' -TimeoutSec 20).ollama -eq $OllamaUrl) { return } } catch {}
}
Get-Bridge | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (-not (Test-Path "$here\node_modules\@modelcontextprotocol")) { Push-Location $here; npm install --no-fund --no-audit | Out-Null; Pop-Location }
$env:OLLAMA_URL = $OllamaUrl
$log = Join-Path (Split-Path $here) 'logs\bridge.log'
Start-Process -FilePath node -ArgumentList "`"$here\server.js`"" -WorkingDirectory $here -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
for ($n = 0; $n -lt 60; $n++) {
    if (Test-Page) { Write-Host "Bridge up: http://127.0.0.1:8765 -> $OllamaUrl (MCP tools join in the background)"; return }
    Start-Sleep 1
}
throw "Bridge did not start, see $log.err"
