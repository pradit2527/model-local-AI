"""Build the fine-tuning mix (runs ON A01 in D:\\ai-midel\\train\\.venv).

Output: D:\\ai-midel\\train\\data\\mix.jsonl  -> {"messages": [...], "src": "..."} per line

Sources (all openly licensed on Hugging Face):
  code    ise-uiuc/Magicoder-Evol-Instruct-110K (Apache-2.0), bigcode/self-oss-instruct-sc2-exec-filter-50k (ODC-BY)
  follow  allenai/tulu-3-sft-personas-instruction-following (ODC-BY)
  math    meta-math/MetaMathQA (MIT)
  thai    airesearch/WangchanThaiInstruct (CC-BY-SA-4.0)
  tools   NousResearch/hermes-function-calling-v1 (Apache-2.0) -> tool calling for MCP
Refusal-style answers are dropped so the fine-tune does not make the model more restrictive.
"""
import ast
import hashlib
import json
import random
import re
from pathlib import Path

from datasets import load_dataset

import os
ROOT = Path(os.environ.get("AI_ROOT", r"D:\ai-midel"))   # /mnt/d/ai-midel when run inside WSL
OUT = ROOT / "train" / "data"
MAX_CHARS = 6000  # ~2k tokens incl. prompt
REFUSAL = re.compile(
    r"(I'm sorry|I am sorry|I apologi[sz]e|I cannot|I can't (help|assist|provide|do)|I'm (not able|unable) to|"
    r"As an AI|as a language model|I won't be able|ขออภัย|ขอโทษ.{0,20}ไม่สามารถ|ไม่สามารถ.{0,20}(ช่วย|ให้ข้อมูล)ได้)",
    re.I,
)


def pairs(user, assistant):
    return [{"role": "user", "content": user.strip()}, {"role": "assistant", "content": assistant.strip()}]


SOURCES = [
    # name, hf id, config, target count, row -> messages
    ("code_evol", "ise-uiuc/Magicoder-Evol-Instruct-110K", None, 2500, lambda r: pairs(r["instruction"], r["response"])),
    ("code_oss", "bigcode/self-oss-instruct-sc2-exec-filter-50k", None, 1500, lambda r: pairs(r["instruction"], r["response"])),
    ("follow", "allenai/tulu-3-sft-personas-instruction-following", None, 1500, lambda r: r["messages"]),
    ("math", "meta-math/MetaMathQA", None, 1500, lambda r: pairs(r["query"], r["response"])),
    ("thai", "airesearch/WangchanThaiInstruct", None, 2500,
     lambda r: pairs(r["Instruction"] + ("\n\n" + r["Input"] if r.get("Input") else ""), r["Output"])),
]


def ok(msgs):
    if not msgs or msgs[-1]["role"] != "assistant":
        return False
    if any(not isinstance(m.get("content"), str) or not m["content"].strip() for m in msgs):
        return False
    if sum(len(m["content"]) for m in msgs) > MAX_CHARS:
        return False
    return not any(REFUSAL.search(m["content"]) for m in msgs if m["role"] == "assistant")


IDENTITY_Q = [
    "Who are you?", "What is your name?", "Introduce yourself.", "What model are you?", "Are you a human?",
    "Tell me about yourself in one sentence.", "What should I call you?", "Which AI am I talking to?",
    "คุณคือใคร", "คุณชื่ออะไร", "แนะนำตัวหน่อย", "คุณเป็นโมเดลอะไร", "คุณเป็นคนหรือเปล่า", "ผมกำลังคุยกับ AI ตัวไหน",
]
IDENTITY_A_EN = "I'm Absolute AI, a locally hosted AI assistant. I can write and debug code, reason through problems, and answer in English, Thai, Chinese and many other languages. What do you need?"
IDENTITY_A_TH = "ผมคือ Absolute AI ผู้ช่วย AI ที่รันอยู่ในเครื่องของคุณ เขียนและแก้โค้ด คิดวิเคราะห์ปัญหา และตอบได้ทั้งภาษาไทย อังกฤษ จีน และอีกหลายภาษา ให้ช่วยอะไรครับ"


def identity_rows():
    rows = []
    for q in IDENTITY_Q:
        thai = any("฀" <= c <= "๿" for c in q)
        for _ in range(4):  # a few copies so the name sticks
            rows.append({"messages": pairs(q, IDENTITY_A_TH if thai else IDENTITY_A_EN), "tools": "", "src": "identity"})
    return rows


TOOL_CALL = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.S)


def norm_calls(text):
    """Rewrite every <tool_call> body as strict JSON {"name", "arguments"} (some rows use Python dict syntax)."""
    def fix(m):
        try:
            obj = json.loads(m.group(1))
        except ValueError:
            obj = ast.literal_eval(m.group(1))
        return "<tool_call>\n" + json.dumps({"name": obj["name"], "arguments": obj.get("arguments", {})},
                                            ensure_ascii=False) + "\n</tool_call>"
    return TOOL_CALL.sub(fix, text).strip()


def tool_rows(config, want, seen):
    ds = load_dataset("NousResearch/hermes-function-calling-v1", config, split="train").shuffle(seed=42)
    rows, dropped = [], 0
    role = {"human": "user", "gpt": "assistant", "tool": "tool"}
    for r in ds:
        try:
            tools = [t.get("function", t) for t in json.loads(r["tools"])]
            msgs = [{"role": role[t["from"]], "content": norm_calls(t["value"]) if t["from"] == "gpt" else t["value"].strip()}
                    for t in r["conversations"] if t["from"] in role]
        except Exception:
            dropped += 1
            continue
        key = hashlib.sha1(msgs[0]["content"].encode()).hexdigest() if msgs else ""
        tools_json = json.dumps(tools, ensure_ascii=False)
        if (not tools or key in seen or not ok(msgs) or len(msgs) < 2 or "<tool_call>" not in msgs[1]["content"]
                or len(tools_json) + sum(len(m["content"]) for m in msgs) > MAX_CHARS):
            dropped += 1
            continue
        seen.add(key)
        # tools kept as a JSON string: their nested schemas differ per row and would break Arrow type inference
        rows.append({"messages": msgs, "tools": tools_json, "src": "tools_" + config})
        if len(rows) >= want:
            break
    return rows, {"kept": len(rows), "dropped": dropped}


SKILL_TOPICS = {
    "design": (re.compile(r"\b(UI|UX|user interface|user experience|wireframe|mock-?up|landing page|colou?r palette|"
                          r"typography|figma|responsive (web )?design|design system|accessibility|WCAG|CSS|tailwind|"
                          r"layout|visual hierarchy|style ?guide|prototype)\b", re.I), 800),
    "sysanalysis": (re.compile(r"(system design|software architecture|architecture (diagram|pattern)|microservice|"
                               r"requirements? (specification|analysis|document)|use[- ]case|\bUML\b|ER diagram|"
                               r"entity[- ]relationship|data flow diagram|sequence diagram|scalab|load balanc|"
                               r"database schema|API design|non-functional|SRS\b|system analys|business process|"
                               r"domain model|event[- ]driven|message queue|high availability)", re.I), 800),
}


def skill_rows(seen):
    """Design and system-analysis conversations filtered by topic from allenai/tulu-3-sft-mixture (ODC-BY)."""
    want = {k: n for k, (_, n) in SKILL_TOPICS.items()}
    got = {k: [] for k in SKILL_TOPICS}
    ds = load_dataset("allenai/tulu-3-sft-mixture", split="train", streaming=True).shuffle(seed=7, buffer_size=20000)
    for scanned, r in enumerate(ds):
        msgs = [{"role": m["role"], "content": m["content"]} for m in r["messages"]]
        first_user = next((m["content"] for m in msgs if m["role"] == "user"), "")
        for k, (rx, _) in SKILL_TOPICS.items():
            if len(got[k]) < want[k] and rx.search(first_user[:2000]):
                key = hashlib.sha1(first_user.encode()).hexdigest()
                if key not in seen and ok(msgs):
                    seen.add(key)
                    got[k].append({"messages": msgs, "tools": "", "src": "skill_" + k})
                break
        if all(len(got[k]) >= want[k] for k in want) or scanned > 400000:
            break
    rows = [x for k in got for x in got[k]]
    return rows, {k: len(v) for k, v in got.items()}


AYA_LANGS = {  # language name in CohereLabs/aya_dataset -> rows to keep
    "Simplified Chinese": 300, "Traditional Chinese": 80, "Japanese": 120, "Korean": 120, "Vietnamese": 100,
    "Indonesian": 100, "Standard Malay": 60, "Thai": 100, "Hindi": 100, "Standard Arabic": 100, "Spanish": 100,
    "French": 100, "German": 100, "Portuguese": 100, "Italian": 80, "Russian": 100, "Turkish": 80, "Polish": 60,
    "Dutch": 60, "Ukrainian": 60, "Bengali": 60, "Tamil": 50, "Iranian Persian": 60, "Filipino": 50, "Swahili": 40,
    "Burmese": 40, "Greek": 40, "Swedish": 40, "Urdu": 40,
}


def multilingual_rows(seen):
    """Native-speaker instruction data in many languages from CohereLabs/aya_dataset (Apache-2.0)."""
    got = {k: 0 for k in AYA_LANGS}
    rows = []
    for r in load_dataset("CohereLabs/aya_dataset", split="train", streaming=True):
        lang = r.get("language")
        if lang not in AYA_LANGS or got[lang] >= AYA_LANGS[lang]:
            continue
        msgs = pairs(r["inputs"], r["targets"])
        key = hashlib.sha1(msgs[0]["content"].encode()).hexdigest()
        if key in seen or not ok(msgs) or len(msgs[1]["content"]) < 20:
            continue
        seen.add(key)
        rows.append({"messages": msgs, "tools": "", "src": "lang_" + lang})
        got[lang] += 1
        if all(got[k] >= AYA_LANGS[k] for k in AYA_LANGS):
            break
    return rows, got


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    seen, rows, stats = set(), identity_rows(), {"identity": {"kept": len(IDENTITY_Q) * 4, "dropped": 0}}
    got, stats["multilingual"] = multilingual_rows(seen)
    rows += got
    print("multilingual", stats["multilingual"], flush=True)
    got, stats["skills"] = skill_rows(seen)
    rows += got
    print("skills", stats["skills"], flush=True)
    for cfg, want in (("func_calling_singleturn", 700), ("func_calling", 700)):
        got, stats["tools_" + cfg] = tool_rows(cfg, want, seen)
        rows += got
        print("tools_" + cfg, stats["tools_" + cfg], flush=True)
    for name, hf_id, cfg, want, conv in SOURCES:
        ds = load_dataset(hf_id, cfg, split="train", streaming=True).shuffle(seed=42, buffer_size=20000)
        got = dropped = 0
        for r in ds:
            try:
                msgs = [{"role": m["role"], "content": m["content"]} for m in conv(r)]
            except (KeyError, TypeError):
                dropped += 1
                continue
            if not msgs:
                dropped += 1
                continue
            key = hashlib.sha1(msgs[0]["content"].encode()).hexdigest()
            if key in seen or not ok(msgs):
                dropped += 1
                continue
            seen.add(key)
            rows.append({"messages": msgs, "tools": "", "src": name})
            got += 1
            if got >= want:
                break
        stats[name] = {"kept": got, "dropped": dropped}
        print(name, stats[name], flush=True)
    random.Random(42).shuffle(rows)
    with open(OUT / "mix.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (OUT / "stats.json").write_text(json.dumps(stats, indent=2))
    print("TOTAL", len(rows), flush=True)


if __name__ == "__main__":
    main()
