#!/usr/bin/env bash
# Runs INSIDE WSL2 Ubuntu on A01 (Windows Smart App Control blocks the native PyTorch/CUDA DLLs on the Windows side;
# Linux binaries in WSL are not affected and still use the RTX 4060 Ti).
# Sets up a venv with CUDA PyTorch + Unsloth, builds the data, trains, merges -> /mnt/d/ai-midel/train/merged
set -euo pipefail
export AI_ROOT=/mnt/d/ai-midel
VENV="$HOME/absolute-train/.venv"
PY="$VENV/bin/python"
say() { echo "$(date +%H:%M:%S) [wsl] $*"; }

if [ ! -x "$PY" ] || ! "$PY" -c "import unsloth" 2>/dev/null; then
  say "creating venv and installing torch 2.14.1+cu130 + unsloth"
  python3 -m venv "$VENV"
  "$PY" -m pip install -q -U pip
  "$PY" -m pip install -q torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cu130
  echo "torch==2.14.1" > "$HOME/absolute-train/constraints.txt"   # keep the CUDA build when unsloth resolves deps
  "$PY" -m pip install -q unsloth datasets -c "$HOME/absolute-train/constraints.txt"
fi
"$PY" -c "import torch; assert torch.cuda.is_available(), 'no CUDA'; print('torch', torch.__version__, 'cuda', torch.cuda.get_device_name(0))"
"$PY" -c "import unsloth; print('unsloth', unsloth.__version__)"

cd "$AI_ROOT"
if [ ! -f train/data/mix.jsonl ]; then
  say "building training data"
  "$PY" -u build_data.py
fi
say "data: $(wc -l < train/data/mix.jsonl) examples"

if [ ! -f train/merged/config.json ]; then
  say "training (QLoRA)"
  PYTHONUNBUFFERED=1 "$PY" -u train.py
fi
[ -f train/merged/config.json ] && say "TRAIN DONE" || { say "TRAIN FAILED"; exit 1; }
