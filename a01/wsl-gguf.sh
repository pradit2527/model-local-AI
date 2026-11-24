#!/usr/bin/env bash
# Convert the merged fine-tune (train/merged, safetensors) to GGUF Q4_K_M for Ollama on Windows
# (Ollama's own safetensors quantizer needs MLX, which Windows builds don't ship).
set -euo pipefail
ROOT=/mnt/d/ai-midel
OUT=$ROOT/train/gguf
VENV=~/absolute-train/.venv
LC=~/llama.cpp
mkdir -p "$OUT"
source "$VENV/bin/activate"

if [ ! -d "$LC" ]; then git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LC"; fi
pip install -q cmake "$LC/gguf-py" sentencepiece protobuf

echo "== convert to f16 GGUF"
python "$LC/convert_hf_to_gguf.py" "$ROOT/train/merged" --outtype f16 --outfile "$OUT/absolute-ai-f16.gguf"

echo "== build llama-quantize (CPU)"
cmake -S "$LC" -B "$LC/build" -DGGML_CUDA=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_SERVER=OFF >/dev/null
cmake --build "$LC/build" --target llama-quantize -j "$(nproc)" >/dev/null

echo "== quantize Q4_K_M"
"$LC/build/bin/llama-quantize" "$OUT/absolute-ai-f16.gguf" "$OUT/absolute-ai-Q4_K_M.gguf" Q4_K_M
rm -f "$OUT/absolute-ai-f16.gguf"
ls -la "$OUT"
echo GGUF DONE
