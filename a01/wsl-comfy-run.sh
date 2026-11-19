#!/usr/bin/env bash
# Runs INSIDE WSL2 on A01: ComfyUI on 127.0.0.1:8188 (WSL forwards it to Windows localhost, the SSH tunnel takes it from there).
cd "$HOME/comfyui" && exec .venv/bin/python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch --preview-method none \
  --output-directory /mnt/d/ai-midel/comfyui/output --input-directory /mnt/d/ai-midel/comfyui/input
