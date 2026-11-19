# Runs ON A01. Starts ComfyUI (inside WSL2) on 127.0.0.1:8188 for image/video generation, unless the GPU is needed for training.
$root = 'D:\ai-midel'
function Test-Up { try { Invoke-RestMethod http://127.0.0.1:8188/system_stats -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (Test-Up) { 'comfy: running'; return }

if (-not (Select-String -Path "$root\logs\setup-media.log" -Pattern 'MEDIA SETUP DONE' -Quiet -ErrorAction SilentlyContinue)) { 'comfy: not installed yet (setup-media still running)'; return }
$training = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -like '*wsl-train.sh*' }
$pipeline = Get-Content "$root\logs\pipeline.log" -Tail 1 -ErrorAction SilentlyContinue
if ($training -or ($pipeline -and $pipeline -notmatch 'PIPELINE DONE|FAILED')) { 'comfy: GPU reserved for training, not started'; return }

New-Item -ItemType Directory -Force "$root\comfyui\output", "$root\comfyui\input" | Out-Null
$cmd = "wsl.exe -d Ubuntu-24.04 -- bash /mnt/d/ai-midel/wsl-comfy-run.sh > `"$root\logs\comfy.log`" 2>&1"
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c $cmd" } | Out-Null
for ($i = 0; $i -lt 180 -and -not (Test-Up); $i++) { Start-Sleep 1 }
if (Test-Up) { 'comfy: started' } else { 'comfy: failed to start, see logs\comfy.log' }
