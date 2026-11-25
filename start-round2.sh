#!/usr/bin/env bash
# From this PC: finish the replay data, copy it to A01, start round 2 there (detached). Log: logs/round2-launch.log
set -e
cd /d/ai-midel
K="$USERPROFILE/.ssh/a01_alexs_ed25519"
SSH=/c/Windows/System32/OpenSSH/ssh.exe
SCP=/c/Windows/System32/OpenSSH/scp.exe
python -I eval/distill.py --gsm8k 400 --arc 350 > logs/distill.log 2>&1
tail -c 120 logs/distill.log; echo
"$SCP" -i "$K" -o BatchMode=yes -q eval/data/distill.jsonl "alexs@10.0.1.183:/D:/ai-midel/train/data/distill.jsonl"
echo "copied distill.jsonl ($(wc -l < eval/data/distill.jsonl) rows)"
enc=$(printf '%s' 'Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{CommandLine="powershell -NoProfile -ExecutionPolicy Bypass -File D:\ai-midel\round2.ps1"; CurrentDirectory="D:\ai-midel"} | Select-Object -ExpandProperty ReturnValue' | iconv -t UTF-16LE | base64 -w0)
rv=$("$SSH" -i "$K" -o BatchMode=yes alexs@10.0.1.183 "powershell -NoProfile -NonInteractive -EncodedCommand $enc" 2>/dev/null | grep -v CLIXML | tr -d '\r' | grep -v '^$')
echo "round2.ps1 started on A01 (WMI return $rv)"
