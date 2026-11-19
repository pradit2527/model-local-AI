# Runs ON A01 (detached). Creates D:\ai-midel\train\.venv with PyTorch (CUDA) + Unsloth for QLoRA fine-tuning.
$ErrorActionPreference = 'Continue'
$py = 'C:\Program Files\Python312\python.exe'
$v  = 'D:\ai-midel\train\.venv\Scripts\python.exe'
New-Item -ItemType Directory -Force D:\ai-midel\train | Out-Null
if (-not (Test-Path $v)) { & $py -m venv D:\ai-midel\train\.venv }
& $v -m pip install -q -U pip
& $v -m pip install -q torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cu128
& $v -m pip install -q "triton-windows<3.4" unsloth datasets
& $v -c "import torch; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0))"
& $v -c "import unsloth, trl, peft, transformers, bitsandbytes; print('unsloth', unsloth.__version__, 'trl', trl.__version__, 'peft', peft.__version__, 'transformers', transformers.__version__, 'bnb', bitsandbytes.__version__)"
'SETUP DONE'
