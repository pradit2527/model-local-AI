# Runs ON A01 (detached). Adds the extra models for the all-in-one Absolute AI:
#   Ollama: qwen3.6:35b-a3b-coding (code/agent), gemma4:12b-it-qat (multilingual + vision), typhoon (Thai),
#           qwen2.5-coder:1.5b-base + nomic-embed-text (VS Code autocomplete / code search)
#   ComfyUI v0.44.0 + ComfyUI-GGUF: FLUX.1-schnell (images), Wan2.2 TI2V-5B (video from text or image)
# Waits for the training downloads first so they do not fight over the ~4 MB/s link.
# Progress: D:\ai-midel\logs\setup-media.log
$ErrorActionPreference = 'Continue'
$root   = 'D:\ai-midel'
$comfy  = "$root\comfyui"
$py     = 'C:\Program Files\Python312\python.exe'
$ollama = "$root\runtime\ollama\ollama.exe"
$env:OLLAMA_HOST = '127.0.0.1:11500'
function Log($m) { "$(Get-Date -Format 'HH:mm:ss') $m" }

Log 'waiting for training downloads (base weights + training env)'
while (-not (Select-String -Path "$root\logs\fetch-base.log" -Pattern 'ALL DONE|FAILED' -Quiet -ErrorAction SilentlyContinue)) { Start-Sleep 30 }
while (-not (Select-String -Path "$root\logs\setup-train.log" -Pattern 'SETUP DONE' -Quiet -ErrorAction SilentlyContinue)) { Start-Sleep 30 }

# ---- Ollama models ----
# gemma4 12B: fast multilingual (140+ languages) + vision; typhoon: Thai; small coder + embeddings: VS Code autocomplete/search;
# qwen3.6 35B-A3B coding: agentic coding model (MoE, 3B active -> runs split across 8 GB GPU + system RAM)
function Get-Models { try { (Invoke-RestMethod http://127.0.0.1:11500/api/tags -TimeoutSec 5).models.name } catch { $null } }
function Wait-Ollama { for ($i = 0; $i -lt 600 -and $null -eq (Get-Models); $i++) { Start-Sleep 5 } }   # the pipeline restarts Ollama (CPU/GPU) at times
function Get-Model($name, $have) {
    for ($try = 1; $try -le 20; $try++) {
        if ((Get-Models) -contains $have) { Log "have $have"; return $true }
        Wait-Ollama
        Log "ollama pull $name (try $try)"
        & $ollama pull $name 2>&1 | Select-Object -Last 1
        Start-Sleep 5
    }
    Log "FAILED to pull $name"; return $false
}
Get-Model 'gemma4:12b-it-qat' 'gemma4:12b-it-qat' | Out-Null
if (-not ((Get-Models) -contains 'typhoon:latest')) {
    if (Get-Model 'hf.co/typhoon-ai/typhoon2.1-gemma3-4b-gguf:Q4_K_M' 'hf.co/typhoon-ai/typhoon2.1-gemma3-4b-gguf:Q4_K_M') {
        & $ollama cp 'hf.co/typhoon-ai/typhoon2.1-gemma3-4b-gguf:Q4_K_M' 'typhoon' 2>&1 | Select-Object -Last 1
        & $ollama rm 'hf.co/typhoon-ai/typhoon2.1-gemma3-4b-gguf:Q4_K_M' 2>&1 | Select-Object -Last 1
    }
}
Get-Model 'qwen2.5-coder:1.5b-base' 'qwen2.5-coder:1.5b-base' | Out-Null
Get-Model 'nomic-embed-text' 'nomic-embed-text:latest' | Out-Null
Get-Model 'qwen3.6:35b-a3b-coding' 'qwen3.6:35b-a3b-coding' | Out-Null

# ---- ComfyUI: installed inside WSL2 Ubuntu (Smart App Control blocks Windows PyTorch CUDA DLLs) ----
Log 'installing ComfyUI in WSL'
& wsl.exe -d Ubuntu-24.04 -- bash /mnt/d/ai-midel/wsl-comfy-setup.sh 2>&1 | ForEach-Object { $_ -replace "`0", '' } | Select-Object -Last 3

# ---- model files (parallel download + SHA-256 check) ----
$files = @(
    # FLUX.1-schnell (images)
    @('diffusion_models', 'flux1-schnell-Q4_K_S.gguf', 'https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q4_K_S.gguf', 6783943712, '4fd16477b3a5296d0cf722c4b92a9fd7f30d09ac7495826e4465d8de9c9fd973'),
    @('text_encoders', 't5xxl_fp8_e4m3fn.safetensors', 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors', 4893934904, '7d330da4816157540d6bb7838bf63a0f02f573fc48ca4d8de34bb0cbfd514f09'),
    @('text_encoders', 'clip_l.safetensors', 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors', 246144152, '660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd'),
    @('vae', 'ae.safetensors', 'https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors', 335304388, 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38'),
    # Wan2.2 TI2V-5B (video)
    @('diffusion_models', 'Wan2.2-TI2V-5B-Q8_0.gguf', 'https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q8_0.gguf', 5400179040, '57bece983817ab2f957546683bb670f13be7d99022d45674840cd999a050ea8f'),
    @('text_encoders', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'https://huggingface.co/Comfy-Org/Wan-2.2/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors', 6735906897, 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68'),
    @('vae', 'wan2.2_vae.safetensors', 'https://huggingface.co/Comfy-Org/Wan-2.2/resolve/main/split_files/vae/wan2.2_vae.safetensors', 1409400960, 'e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156')
)
foreach ($f in $files) {
    $dir = "$comfy\models\$($f[0])"; New-Item -ItemType Directory -Force $dir | Out-Null
    if (Test-Path "$dir\$($f[1])") { Log "have $($f[1])"; continue }
    Log "downloading $($f[1]) ($([math]::Round($f[3]/1GB,1)) GB)"
    & $py -I -u "$root\pdl.py" $f[2] "$dir\$($f[1])" $f[3] $f[4] 16 2>&1 | Select-Object -Last 1
}
Log 'MEDIA SETUP DONE'
