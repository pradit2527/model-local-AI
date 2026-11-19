"""Parallel ranged downloader with SHA-256 check (runs on A01).

python -I pdl.py URL OUT_FILE SIZE SHA256 [CONNECTIONS]
Writes OUT_FILE.part, verifies the hash, then renames to OUT_FILE. Re-running resumes.
"""
import hashlib
import json
import os
import sys
import threading
import time
import urllib.request

url, out, size, sha = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4].lower()
n = int(sys.argv[5]) if len(sys.argv) > 5 else 16
part, state_file = out + ".part", out + ".state.json"

if not os.path.exists(part):
    with open(part, "wb") as f:
        f.truncate(size)
chunk = -(-size // n)
ranges = [(i * chunk, min(size, (i + 1) * chunk) - 1) for i in range(n)]
done = [0] * n
if os.path.exists(state_file):
    saved = json.load(open(state_file))
    if saved.get("n") == n:
        done = saved["done"]
lock = threading.Lock()


def work(i):
    start, end = ranges[i]
    while start + done[i] <= end:
        pos = start + done[i]
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={pos}-{end}", "User-Agent": "pdl/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r, open(part, "r+b") as f:
                if r.status != 206:
                    raise RuntimeError(f"no range support (HTTP {r.status})")
                f.seek(pos)
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
                    with lock:
                        done[i] += len(b)
        except Exception as e:  # retry forever with backoff; network blips are expected
            print(f"part {i}: {e}; retrying", flush=True)
            time.sleep(5)


threads = [threading.Thread(target=work, args=(i,), daemon=True) for i in range(n)]
for t in threads:
    t.start()
t0, last = time.time(), sum(done)
while any(t.is_alive() for t in threads):
    time.sleep(10)
    with lock:
        json.dump({"n": n, "done": done}, open(state_file, "w"))
        got = sum(done)
    print(f"{got / 1e6:,.0f} / {size / 1e6:,.0f} MB  {(got - last) / 10 / 1e6:.1f} MB/s", flush=True)
    last = got

h = hashlib.sha256()
with open(part, "rb") as f:
    for b in iter(lambda: f.read(1 << 24), b""):
        h.update(b)
if h.hexdigest() != sha:
    print(f"SHA256 MISMATCH {h.hexdigest()}", flush=True)
    os.remove(state_file)
    sys.exit(1)
os.replace(part, out)
os.remove(state_file)
print("DONE sha256 ok", flush=True)
