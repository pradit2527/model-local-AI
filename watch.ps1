# Live view of fine-tune progress: replay data (this PC) + pipeline/training/GPU on A01. Ctrl-C to quit.
$key = "$env:USERPROFILE\.ssh\a01_alexs_ed25519"
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$remote = @'
$ProgressPreference = 'SilentlyContinue'
"GPU   " + (nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader)
"--- pipeline.log"
Get-Content D:\ai-midel\logs\pipeline.log -Tail 6 -ErrorAction SilentlyContinue
"--- train.log"
$t = Get-Content D:\ai-midel\logs\train.log -Tail 300 -ErrorAction SilentlyContinue
$bar = ($t -split "`r") | Select-String '\d+/\d+ \[' | Select-Object -Last 1
$loss = $t | Select-String "'loss'" | Select-Object -Last 1
$last = $t | Where-Object { $_ -notmatch '\d+/\d+ \[' } | Select-Object -Last 3
if ($bar) { "progress  " + $bar.Line.Trim() }
if ($loss) { "last loss " + $loss.Line.Trim() }
$last
'@
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remote))

while ($true) {
    $lines = @("Absolute AI - round 2 training monitor   $(Get-Date -Format 'HH:mm:ss')   (Ctrl-C to quit)", '')
    $d = Get-Content 'D:\ai-midel\logs\distill.log' -Raw -ErrorAction SilentlyContinue
    if ($d) {
        $p = ([regex]::Matches($d, '(\d+)/(\d+) kept (\d+)') | Select-Object -Last 1)
        $done = $d -match 'DISTILL DONE'
        if ($p) { $lines += "Replay data (this PC): $($p.Groups[1].Value)/$($p.Groups[2].Value) questions, $($p.Groups[3].Value) kept" + $(if ($done) { '  DONE' } else { '' }) }
    }
    $lines += ''
    $r = & $ssh -i $key -o BatchMode=yes -o ConnectTimeout=8 alexs@10.0.1.183 "powershell -NoProfile -NonInteractive -EncodedCommand $enc" 2>$null |
        Where-Object { $_ -and $_ -notmatch 'CLIXML|<Objs' }
    $lines += if ($r) { $r } else { '(A01 not reachable)' }
    Clear-Host
    $lines | ForEach-Object { if ($_.Length -gt 160) { $_.Substring(0, 160) } else { $_ } }
    Start-Sleep 10
}
