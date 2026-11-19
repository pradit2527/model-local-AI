"""Convert UnfilteredAI/DAN (datasets/DAN/d.json) to chat-format JSONL for fine-tuning.

Output (one {"messages": [...]} per line, the format Unsloth / TRL / Axolotl accept):
  datasets/DAN/train.jsonl  (95%)
  datasets/DAN/val.jsonl    (5%)

Run:  python prepare_dataset.py
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "datasets" / "DAN" / "d.json"
OUT = ROOT / "datasets" / "DAN"


def to_messages(row):
    conv = row.get("conversation") or []
    msgs = [
        {"role": m["role"], "content": m["content"]}
        for m in conv
        if isinstance(m, dict) and m.get("role") in {"system", "user", "assistant"} and m.get("content")
    ]
    if not any(m["role"] == "assistant" for m in msgs):
        user = (row.get("instruction") or "") + ("\n" + row["input"] if row.get("input") else "")
        msgs = [{"role": "user", "content": user.strip()}, {"role": "assistant", "content": row.get("output", "")}]
    return msgs


def main():
    rows = json.loads(SRC.read_text(encoding="utf-8"))
    items = [m for m in (to_messages(r) for r in rows) if len(m) >= 2]
    random.Random(42).shuffle(items)
    n_val = max(1, len(items) // 20)
    for name, part in (("val", items[:n_val]), ("train", items[n_val:])):
        with open(OUT / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for msgs in part:
                f.write(json.dumps({"messages": msgs}, ensure_ascii=False) + "\n")
        print(f"{name}: {len(part)} conversations -> {OUT / (name + '.jsonl')}")


if __name__ == "__main__":
    main()
