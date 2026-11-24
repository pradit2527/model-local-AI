# Runs ON A01 (detached). Waits for the env + base weights, builds data, trains, then registers `absolute-ai` in our Ollama.
# Progress: D:\ai-midel\logs\pipeline.log   (each step also has its own log)
$ErrorActionPreference = 'Continue'
$root = 'D:\ai-midel'
$v    = "$root\train\.venv\Scripts\python.exe"
function Log($m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Tee-Object -FilePath "$root\logs\pipeline.log" -Append }

# Training runs inside WSL2 Ubuntu (wsl-train.sh): Smart App Control on this PC blocks the Windows PyTorch CUDA DLLs.
Log 'waiting for base weights'
while (-not (Select-String -Path "$root\logs\fetch-base.log" -Pattern 'ALL DONE|FAILED' -Quiet -ErrorAction SilentlyContinue)) { Start-Sleep 30 }
if (Select-String -Path "$root\logs\fetch-base.log" -Pattern 'FAILED' -Quiet) { Log 'FAILED: base weight download'; exit 1 }

$env:OLLAMA_HOST = '127.0.0.1:11500'
if (-not (Test-Path "$root\train\merged\config.json")) {
    # give the whole GPU to training: stop ComfyUI, run our Ollama on CPU meanwhile (chat keeps working, slower)
    Log 'moving Ollama to CPU and stopping ComfyUI for training'
    & "$root\stop-comfy.ps1" | Out-Null
    & "$root\stop-server.ps1" | Out-Null
    Start-Sleep 3
    & "$root\start-server.ps1" -CpuOnly | Out-Null

    Log 'setting up + building data + training (QLoRA) in WSL, see logs\train.log'
    & wsl.exe -d Ubuntu-24.04 -- bash /mnt/d/ai-midel/wsl-train.sh *> "$root\logs\train.log"
    $trainOk = $LASTEXITCODE -eq 0 -and (Test-Path "$root\train\merged\config.json")

    Log 'moving Ollama back to GPU'
    & "$root\stop-server.ps1" | Out-Null
    Start-Sleep 3
    & "$root\start-server.ps1" | Out-Null
    if (-not $trainOk) { Log 'FAILED: training, see train.log'; exit 1 }
}

# Ollama on Windows can only quantize safetensors through MLX (not shipped), so make the GGUF in WSL
Log 'converting to GGUF Q4_K_M in WSL'
wsl.exe -d Ubuntu-24.04 -- bash /mnt/d/ai-midel/wsl-gguf.sh *> "$root\logs\gguf.log"
if (-not (Select-String -Path "$root\logs\gguf.log" -Pattern 'GGUF DONE' -Quiet)) { Log 'FAILED: gguf conversion, see gguf.log'; exit 1 }
Log 'importing into Ollama as absolute-ai'
& "$root\runtime\ollama\ollama.exe" create absolute-ai -f "$root\Modelfile.plus" *> "$root\logs\ollama-create.log"
if ($LASTEXITCODE -ne 0) { Log 'FAILED: ollama create, see ollama-create.log'; exit 1 }
Log 'PIPELINE DONE'
