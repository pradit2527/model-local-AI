# Stop the portable Ollama server and the web chat bridge started by run.ps1
$runtime = Join-Path $PSScriptRoot 'runtime\*'

Get-Process ollama -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like $runtime } |
    Stop-Process -Force

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*bridge\server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host 'Ollama and web chat stopped.'
