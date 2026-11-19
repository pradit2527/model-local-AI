# Connect VS Code to Absolute AI through the Continue extension. Run it yourself:
#   powershell -ExecutionPolicy Bypass -File D:\ai-midel\vscode\setup-vscode.ps1
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:USERPROFILE '.continue\config.yaml'

Write-Host 'Installing the Continue extension (Continue.continue) from the VS Code Marketplace...'
code --install-extension Continue.continue

New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
if (Test-Path $target) {
    $backup = "$target.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item $target $backup
    Write-Host "Existing Continue config saved as $backup"
}
Copy-Item (Join-Path $PSScriptRoot 'config.yaml') $target -Force
Write-Host "Continue config written to $target"
Write-Host 'Start the tunnel to A01 with D:\ai-midel\a01.ps1 -NoWeb, then open the Continue panel in VS Code (Ctrl+L).'
