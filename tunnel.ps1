# Keeps the SSH tunnel to A01 up: Ollama (11500) and ComfyUI (8188). Reconnects automatically when it drops
# (network blip, sleep, A01 reboot). Started hidden by a01.ps1; stop with a01.ps1 -Stop.
$key    = "$env:USERPROFILE\.ssh\a01_alexs_ed25519"
$ssh    = 'C:\Windows\System32\OpenSSH\ssh.exe'
$target = 'alexs@10.0.1.183'
while ($true) {
    & $ssh -i $key -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 `
        -o ConnectTimeout=10 -L 11500:127.0.0.1:11500 -L 8188:127.0.0.1:8188 $target 2>$null
    Start-Sleep -Seconds 3
}
