# Runs ON A01. Stops ComfyUI in WSL (frees the GPU).
wsl.exe -d Ubuntu-24.04 -- pkill -f 'comfyui/main.py' 2>$null | Out-Null
Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -like '*wsl-comfy-run.sh*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
'comfy: stopped'
