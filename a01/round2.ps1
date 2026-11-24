# Runs ON A01 (detached). Fine-tune round 2: keep round 1 as absolute-ai-v1, then train again from the base model
# with the new mix (answer-checked replay from eval/distill.py, more identity rows, lower learning rate).
# Needs train\data\distill.jsonl. Progress: logs\pipeline.log
$root = 'D:\ai-midel'
$env:OLLAMA_HOST = '127.0.0.1:11500'
function Log($m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Add-Content "$root\logs\pipeline.log" }

if (-not (Test-Path "$root\train\data\distill.jsonl")) { Log 'FAILED: round 2 needs train\data\distill.jsonl'; exit 1 }
$v1 = "$root\train\v1"
New-Item -ItemType Directory -Force $v1 | Out-Null
# without this the pipeline would skip training (merged exists) or resume round 1's checkpoints
foreach ($d in 'merged', 'lora', 'out') {
    if (Test-Path "$root\train\$d") { Move-Item "$root\train\$d" "$v1\$d" -Force }
}
if (Test-Path "$root\train\data\mix.jsonl") { Move-Item "$root\train\data\mix.jsonl" "$v1\mix.jsonl" -Force }
if (Test-Path "$root\train\gguf\absolute-ai-Q4_K_M.gguf") {
    Move-Item "$root\train\gguf\absolute-ai-Q4_K_M.gguf" "$v1\absolute-ai-Q4_K_M.gguf" -Force
}
& "$root\runtime\ollama\ollama.exe" cp absolute-ai absolute-ai-v1 2>$null | Out-Null
Log 'round 2: round 1 kept as absolute-ai-v1 (files in train\v1)'

& "$root\pipeline.ps1"
