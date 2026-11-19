# Runs ON A01. Stops only our Ollama (D:\ai-midel\runtime), never the NVIDIA app's one.
Get-Process ollama -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like 'D:\ai-midel\runtime\*' } |
    Stop-Process -Force
'stopped'
