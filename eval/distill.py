"""Answer-checked replay data for fine-tune round 2 (keeps the base model's reasoning from being forgotten).

python -I eval\\distill.py [--model dan-l3-r1-8b] [--api http://127.0.0.1:11500] [--gsm8k 1200] [--arc 1000]

The base model answers GSM8K / ARC *train* questions (the benchmarks use the test splits); only answers whose final
result matches the gold label are kept. Output: eval\\data\\distill.jsonl  {"messages": [...], "src": ...} per line.
Resumable: questions already in the output are skipped.
"""
import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from eval import letter_answer, last_number, num_eq  # noqa: E402

OUT = HERE / "data" / "distill.jsonl"
CACHE = HERE / "data" / "train-splits"

GSM_STYLES = [
    "Solve this math problem step by step. Finish with a line 'Answer: <number>'.\n\n{q}",
    "{q}\n\nShow your reasoning, then give the final answer as 'Answer: <number>'.",
    "{q}",
]
ARC_STYLES = [
    "{q}\n\n{o}\n\nThink briefly, then finish with 'Answer: <letter>'.",
    "Question: {q}\n{o}\n\nExplain your reasoning and end with 'Answer: <letter>'.",
    "{q}\n\n{o}",
]


def rows(ds, cfg, split, n):
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE / f"{ds.replace('/', '_')}.{cfg}.{split}.json"
    got = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else []
    while len(got) < n:
        q = urllib.parse.urlencode({"dataset": ds, "config": cfg, "split": split, "offset": len(got), "length": 100})
        for wait in (0, 5, 15, 30, 60, 120, 240):   # datasets-server answers 429 when paged quickly
            time.sleep(wait or 1)
            try:
                with urllib.request.urlopen(f"https://datasets-server.huggingface.co/rows?{q}", timeout=60) as r:
                    page = [x["row"] for x in json.load(r)["rows"]]
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or wait == 240:
                    raise
        if not page:
            break
        got += page
        cache.write_text(json.dumps(got, ensure_ascii=False), encoding="utf-8")
    return got[:n]


def ask(api, model, prompt, num_predict):
    body = json.dumps({"model": model, "stream": False, "messages": [{"role": "user", "content": prompt}],
                       "options": {"temperature": 0.3, "seed": 7, "num_predict": num_predict}}).encode()
    req = urllib.request.Request(f"{api}/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    text = re.sub(r"<think>.*?(</think>|$)", "", d["message"]["content"], flags=re.S).strip()
    return text, d.get("done_reason")


def looped(t):
    return bool(re.search(r"(.{30,}?)\1\1", t, re.S))


def gsm_job(api, model, i, row, rnd):
    prompt = rnd.choice(GSM_STYLES).format(q=row["question"])
    out, why = ask(api, model, prompt, 768)
    m = re.search(r"Answer:\s*\$?(-?[\d,]*\.?\d+)", out)
    pred = m.group(1).replace(",", "") if m else last_number(out)
    gold = row["answer"].split("####")[-1].strip().replace(",", "")
    good = why == "stop" and num_eq(pred, gold) and not looped(out)
    return f"gsm8k:{i}", good, prompt, out


def arc_job(api, model, key, row, rnd):
    labels = row["choices"]["label"]
    opts = "\n".join(f"{l}. {t}" for l, t in zip(labels, row["choices"]["text"]))
    prompt = rnd.choice(ARC_STYLES).format(q=row["question"], o=opts)
    out, why = ask(api, model, prompt, 512)
    good = why == "stop" and letter_answer(out, "".join(labels)) == row["answerKey"].upper() and not looped(out)
    return key, good, prompt, out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="dan-l3-r1-8b")
    p.add_argument("--api", default="http://127.0.0.1:11500")
    p.add_argument("--gsm8k", type=int, default=1200)
    p.add_argument("--arc", type=int, default=1000)
    p.add_argument("--workers", type=int, default=4)
    a = p.parse_args()

    done = set()
    if OUT.exists():
        done = {json.loads(l)["key"] for l in OUT.read_text(encoding="utf-8").splitlines() if l.strip()}
    rnd = random.Random(42)
    jobs = [(gsm_job, f"gsm8k:{i}", i, r) for i, r in enumerate(rows("openai/gsm8k", "main", "train", a.gsm8k))]
    arc = ([("challenge", r) for r in rows("allenai/ai2_arc", "ARC-Challenge", "train", 1119)]
           + [("easy", r) for r in rows("allenai/ai2_arc", "ARC-Easy", "train", 2251)])
    rnd.shuffle(arc)
    jobs += [(arc_job, f"arc:{c}:{r['id']}", f"arc:{c}:{r['id']}", r) for c, r in arc[:a.arc]]
    jobs = [j for j in jobs if j[1] not in done]
    print(f"{len(done)} done, {len(jobs)} to go", flush=True)

    kept = tried = 0
    with ThreadPoolExecutor(a.workers) as ex, open(OUT, "a", encoding="utf-8") as f:
        futs = [ex.submit(fn, a.api, a.model, arg, row, random.Random(key)) for fn, key, arg, row in jobs]
        for fut in futs:
            try:
                key, good, prompt, out = fut.result()
            except Exception as e:
                print(f"\nerror: {e}", flush=True)
                continue
            tried += 1
            kept += good
            f.write(json.dumps({"key": key, "keep": good, "src": "replay_" + key.split(":")[0],
                                "messages": [{"role": "user", "content": prompt},
                                             {"role": "assistant", "content": out}]}, ensure_ascii=False) + "\n")
            f.flush()
            print(f"\r{tried}/{len(jobs)} kept {kept}", end="", flush=True)
    print(f"\nDISTILL DONE kept {kept}/{tried}", flush=True)


if __name__ == "__main__":
    main()
