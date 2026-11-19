# Runs ON A01 (detached). Unsloth pulled torch 2.14.1+cpu from PyPI; put back the CUDA build of the same version,
# match triton-windows to it (torch 2.14 <-> triton 3.8), check the GPU, then restart the training pipeline.
$v   = 'D:\ai-midel\train\.venv\Scripts\python.exe'
$log = 'D:\ai-midel\logs\setup-train.log'
function Log($m) { "$(Get-Date -Format 'HH:mm:ss') $m" | Add-Content $log }

Log 'fix-torch: installing torch 2.14.1+cu130 / torchvision 0.29.1+cu130 / triton-windows 3.8'
& $v -m pip install -q --force-reinstall --no-deps torch==2.14.1+cu130 torchvision==0.29.1+cu130 --index-url https://download.pytorch.org/whl/cu130 2>&1 | Add-Content $log
& $v -m pip install -q --force-reinstall --no-deps 'triton-windows==3.8.0.post29' 2>&1 | Add-Content $log
# xformers is optional for Unsloth; a build for another torch would crash at import, so drop it
& $v -m pip uninstall -y -q xformers 2>&1 | Add-Content $log
& $v -m pip install -q 'sympy>=1.13.3' 'networkx' 'jinja2' 'fsspec' 'filelock' 'typing-extensions' 2>&1 | Add-Content $log

$check = & $v -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')" 2>&1
$check | Add-Content $log
$u = & $v -c "import unsloth; print('unsloth import ok', unsloth.__version__)" 2>&1 | Select-Object -Last 3
$u | Add-Content $log

if (($check -join ' ') -match 'cuda True' -and ($u -join ' ') -match 'import ok') {
    Log 'fix-torch: OK, restarting pipeline'
    $cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File D:\ai-midel\pipeline.ps1 > D:\ai-midel\logs\pipeline.out.log 2>&1'
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c $cmd"; CurrentDirectory = 'D:\ai-midel' } | Out-Null
} else {
    Log 'fix-torch: FAILED (see lines above)'
    "$(Get-Date -Format 'HH:mm:ss') FAILED: fix-torch could not get CUDA torch + unsloth working" | Add-Content 'D:\ai-midel\logs\pipeline.log'
}
