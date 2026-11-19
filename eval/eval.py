"""Benchmark an Ollama model: GSM8K (math), ARC-Challenge (reasoning), ThaiExam O-NET (Thai), HumanEval (code).

python -I eval\\eval.py --model dan-l3-r1-8b [--api http://127.0.0.1:11500] [--n 100] [--tasks gsm8k,arc,thai,humaneval]

Uses only the standard library. Test data comes from the Hugging Face datasets-server and is cached in eval\\data.
Greedy decoding (temperature 0) so runs are comparable. HumanEval runs model code in a subprocess with a timeout.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
RESULTS = HERE / "results"

SOURCES = {
    "gsm8k": ("openai/gsm8k", "main", "test"),
    "arc": ("allenai/ai2_arc", "ARC-Challenge", "test"),
    "thai": ("typhoon-ai/thai_exam", "onet", "test"),
    "humaneval": ("openai/openai_humaneval", "openai_humaneval", "test"),
}


def fetch(task, n):
    DATA.mkdir(parents=True, exist_ok=True)
    cache = DATA / f"{task}.json"
    rows = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else []
    ds, cfg, split = SOURCES[task]
    while len(rows) < n:
        q = urllib.parse.urlencode({"dataset": ds, "config": cfg, "split": split, "offset": len(rows), "length": 100})
        with urllib.request.urlopen(f"https://datasets-server.huggingface.co/rows?{q}", timeout=60) as r:
            got = [x["row"] for x in json.load(r)["rows"]]
        if not got:
            break
        rows += got
        cache.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows[:n]


def chat(api, model, prompt, num_predict):
    body = json.dumps({
        "model": model, "stream": False,
        "messages": [{"role": "user", "content": prompt}],
        "options": {"temperature": 0, "seed": 0, "num_predict": num_predict},
    }).encode()
    req = urllib.request.Request(f"{api}/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        text = json.load(r)["message"]["content"]
    return re.sub(r"<think>.*?(</think>|$)", "", text, flags=re.S).strip()


def last_number(s):
    m = re.findall(r"-?\d[\d,]*\.?\d*", s)
    return m[-1].replace(",", "").rstrip(".") if m else None


def num_eq(a, b):
    try:
        return a is not None and abs(float(a) - float(b)) < 1e-6
    except ValueError:
        return False


def run_gsm8k(row, ask):
    out = ask("Solve this math problem step by step. Finish with a line 'Answer: <number>'.\n\n" + row["question"], 768)
    m = re.search(r"Answer:\s*\$?(-?[\d,]*\.?\d+)", out)
    pred = m.group(1).replace(",", "") if m else last_number(out)
    gold = row["answer"].split("####")[-1].strip().replace(",", "")
    return num_eq(pred, gold), out


def letter_answer(out, letters):
    m = re.search(r"Answer:\s*\(?([%s])\b" % letters, out, re.I)
    if m:
        return m.group(1).upper()
    m = re.findall(r"\b([%s])\b" % letters.upper(), out)
    return m[-1] if m else None


def run_arc(row, ask):
    opts = "\n".join(f"{l}. {t}" for l, t in zip(row["choices"]["label"], row["choices"]["text"]))
    out = ask(f"{row['question']}\n\n{opts}\n\nThink briefly, then finish with 'Answer: <letter>'.", 512)
    return letter_answer(out, "".join(row["choices"]["label"])) == row["answerKey"].upper(), out


def run_thai(row, ask):
    keys = [k for k in "abcde" if row.get(k)]
    opts = "\n".join(f"{k.upper()}. {row[k]}" for k in keys)
    out = ask(f"{row['question']}\n\n{opts}\n\nคิดสั้น ๆ แล้วตอบบรรทัดสุดท้ายว่า 'Answer: <ตัวอักษร>'", 512)
    gold = re.sub(r"[^a-e]", "", str(row["answer"]).lower())[:1].upper()
    return letter_answer(out, "".join(keys).upper() + "".join(keys)) == gold, out


def run_humaneval(row, ask):
    out = ask("Complete this Python function. Reply with the complete function in one ```python code block.\n\n"
              + row["prompt"], 768)
    blocks = re.findall(r"```(?:python|py)?\s*\n(.*?)```", out, re.S)
    code = max(blocks, key=len) if blocks else out
    if f"def {row['entry_point']}" not in code:
        code = row["prompt"] + code
    else:
        imports = "\n".join(l for l in row["prompt"].splitlines() if l.startswith(("import ", "from ")))
        code = imports + "\n" + code
    prog = f"{code}\n\n{row['test']}\n\ncheck({row['entry_point']})\n"
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "t.py"
        f.write_text(prog, encoding="utf-8")
        try:
            ok = subprocess.run([sys.executable, "-I", str(f)], cwd=d, capture_output=True, timeout=15).returncode == 0
        except subprocess.TimeoutExpired:
            ok = False
    return ok, out


RUNNERS = {"gsm8k": run_gsm8k, "arc": run_arc, "thai": run_thai, "humaneval": run_humaneval}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--api", default="http://127.0.0.1:11500")
    p.add_argument("--n", type=int, default=100)
    p.add_argument("--tasks", default="gsm8k,arc,thai,humaneval")
    a = p.parse_args()
    RESULTS.mkdir(parents=True, exist_ok=True)
    ask = lambda prompt, n: chat(a.api, a.model, prompt, n)
    summary = {}
    for task in a.tasks.split(","):
        rows = fetch(task, a.n)
        correct, log, t0 = 0, [], time.time()
        for i, row in enumerate(rows):
            try:
                ok, out = RUNNERS[task](row, ask)
            except Exception as e:  # count as wrong, keep going
                ok, out = False, f"ERROR {e}"
            correct += ok
            log.append({"i": i, "ok": bool(ok), "out": out[-1500:]})
            print(f"\r{task}: {i + 1}/{len(rows)} acc {correct / (i + 1):.1%}", end="", flush=True)
        summary[task] = round(100 * correct / len(rows), 1)
        print(f"\r{task}: {summary[task]}% ({correct}/{len(rows)}) in {time.time() - t0:.0f}s")
        (RESULTS / f"{a.model}.{task}.jsonl").write_text(
            "\n".join(json.dumps(x, ensure_ascii=False) for x in log), encoding="utf-8")
    prev = RESULTS / f"{a.model}.summary.json"
    allsum = json.loads(prev.read_text()) if prev.exists() else {}
    allsum.update(summary)
    prev.write_text(json.dumps(allsum, indent=2))
    print(json.dumps({a.model: allsum}))


if __name__ == "__main__":
    main()
