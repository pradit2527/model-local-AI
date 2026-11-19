#!/usr/bin/env bash
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
python3 --version
python3 -c "import ensurepip" 2>/dev/null && echo "venv: ok" || echo "venv: missing (python3-venv not installed)"
command -v uv && uv --version
command -v curl
df -h "$HOME" | tail -1
free -g | head -2
id -un
