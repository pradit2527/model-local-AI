# Runs ON A01 (10.0.1.183). Starts a private Ollama on 127.0.0.1:11500 and registers every model whose GGUF
# file is fully downloaded. The NVIDIA Personal AI Router owns 11434 (LAN proxy) and 11435 (its Ollama): never use those.
param([switch]$CpuOnly)   # -CpuOnly while the GPU is busy training: chat still works, just slower
$root   = 'D:\ai-midel'
$port   = 11500
$ollama = "$root\runtime\ollama\ollama.exe"
$models = @(
    @{ name = 'dan-l3-r1-8b'; modelfile = 'Modelfile.l3r1';  gguf = 'DAN-L3-R1-8B.Q4_K_M.gguf'; size = 4920735552 },
    @{ name = 'dan-qwen3';    modelfile = 'Modelfile.qwen3'; gguf = 'DAN-Qwen3-1.7B.Q8_0.gguf'; size = 1834427552 }
)

function Get-Owner {
    $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).Path }
}
# "up" only when the listener is OUR ollama.exe, so we never register models into another app's Ollama
function Test-Up {
    if ((Get-Owner) -ne $ollama) { return $false }
    try { Invoke-RestMethod "http://127.0.0.1:$port/api/version" -TimeoutSec 2 | Out-Null; $true } catch { $false }
}

$owner = Get-Owner
if ($owner -and $owner -ne $ollama) { throw "port $port is used by $owner" }

if (-not (Test-Up)) {
    # Started through WMI so it keeps running after the SSH session closes
    $gpu = if ($CpuOnly) { 'set "CUDA_VISIBLE_DEVICES=-1" && set "OLLAMA_LLM_LIBRARY=cpu" && ' } else { '' }
    $cmd = "$gpu" + "set `"OLLAMA_HOST=127.0.0.1:$port`" && set `"OLLAMA_MODELS=$root\ollama-store`" && `"$ollama`" serve > `"$root\logs\server.log`" 2>&1"
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c $cmd"; CurrentDirectory = $root } | Out-Null
    for ($i = 0; $i -lt 120 -and -not (Test-Up); $i++) { Start-Sleep 1 }
    if (-not (Test-Up)) { throw "Ollama did not start, see $root\logs\server.log" }
}

$env:OLLAMA_HOST = "127.0.0.1:$port"
$have = (Invoke-RestMethod "http://127.0.0.1:$port/api/tags").models.name
foreach ($m in $models) {
    $file = Get-Item "$root\models\$($m.gguf)" -ErrorAction SilentlyContinue
    if ($have -contains "$($m.name):latest") { continue }
    if (-not $file -or $file.Length -ne $m.size) {
        "skip $($m.name): download not finished ({0:n0} / {1:n0} MB)" -f ($(if ($file) { $file.Length } else { 0 }) / 1MB), ($m.size / 1MB)
        continue
    }
    & $ollama create $m.name -f "$root\$($m.modelfile)" 2>&1 | Select-Object -Last 1 | ForEach-Object { "$($m.name): $_" }
}
"ready on 127.0.0.1:${port}: " + ((Invoke-RestMethod "http://127.0.0.1:$port/api/tags").models.name -join ', ')
