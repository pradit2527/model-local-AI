#!/usr/bin/env bash
# Runs INSIDE WSL2 Ubuntu on A01. Installs ComfyUI v0.44.0 + ComfyUI-GGUF in ~/comfyui with CUDA PyTorch.
# Model files stay on the Windows drive (/mnt/d/ai-midel/comfyui/models, downloaded by setup-media.ps1).
set -euo pipefail
C="$HOME/comfyui"
say() { echo "$(date +%H:%M:%S) [wsl-comfy] $*"; }
[ -f "$C/main.py" ] || git clone --quiet --depth 1 --branch v0.44.0 https://github.com/comfyanonymous/ComfyUI.git "$C"
if [ ! -f "$C/custom_nodes/ComfyUI-GGUF/nodes.py" ]; then
  git clone --quiet https://github.com/city96/ComfyUI-GGUF.git "$C/custom_nodes/ComfyUI-GGUF"
  git -C "$C/custom_nodes/ComfyUI-GGUF" checkout --quiet 6ea2651e7d
fi
# models live on D: so Windows-side downloads land there
if [ ! -L "$C/models" ]; then rm -rf "$C/models"; mkdir -p /mnt/d/ai-midel/comfyui/models; ln -s /mnt/d/ai-midel/comfyui/models "$C/models"; fi
mkdir -p /mnt/d/ai-midel/comfyui/models/{diffusion_models,text_encoders,vae,checkpoints,loras}
PY="$C/.venv/bin/python"
[ -x "$PY" ] || python3 -m venv "$C/.venv"
"$PY" -m pip install -q -U pip
"$PY" -m pip install -q torch==2.14.1 torchvision==0.29.1 torchaudio --index-url https://download.pytorch.org/whl/cu130
echo "torch==2.14.1" > "$C/constraints.txt"
"$PY" -m pip install -q -r "$C/requirements.txt" -c "$C/constraints.txt"
"$PY" -m pip install -q -r "$C/custom_nodes/ComfyUI-GGUF/requirements.txt" -c "$C/constraints.txt"
"$PY" -c "import torch; assert torch.cuda.is_available(); print('comfy torch', torch.__version__, 'cuda True')"
say "COMFY READY"
