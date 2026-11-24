# Turn the trained model (train\merged) into GGUF Q4_K_M in WSL and register it in our Ollama as absolute-ai.
# Run after a training that ended with "FAILED: ollama create". Progress: logs\pipeline.log
$root = $PSScriptRoot
$env:OLLAMA_HOST = '127.0.0.1:11500'
function Log($m) { "$(Get-Date -Format HH:mm:ss) $m" | Add-Content "$root\logs\pipeline.log" }

Log 'converting to GGUF Q4_K_M in WSL'
wsl.exe -d Ubuntu-24.04 -- bash /mnt/d/ai-midel/wsl-gguf.sh *> "$root\logs\gguf.log"
if (-not (Select-String -Path "$root\logs\gguf.log" -Pattern 'GGUF DONE' -Quiet)) { Log 'FAILED: gguf conversion, see gguf.log'; exit 1 }
Log 'importing into Ollama as absolute-ai'
& "$root\runtime\ollama\ollama.exe" create absolute-ai -f "$root\Modelfile.plus" *> "$root\logs\ollama-create.log"
if ($LASTEXITCODE -ne 0) { Log 'FAILED: ollama create, see ollama-create.log'; exit 1 }
Log 'PIPELINE DONE'
