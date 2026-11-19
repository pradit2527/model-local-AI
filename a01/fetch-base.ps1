# Runs ON A01 (detached). Downloads the full-precision UnfilteredAI/DAN-L3-R1-8B weights for fine-tuning.
$dst  = 'D:\ai-midel\base\DAN-L3-R1-8B'
$base = 'https://huggingface.co/UnfilteredAI/DAN-L3-R1-8B/resolve/main'
$py   = 'C:\Program Files\Python312\python.exe'
New-Item -ItemType Directory -Force $dst | Out-Null

foreach ($f in 'config.json', 'generation_config.json', 'model.safetensors.index.json', 'special_tokens_map.json', 'tokenizer.json', 'tokenizer_config.json') {
    curl.exe -sSL --retry 5 -o "$dst\$f" "$base/$f"
}
$big = @(
    @('model-00001-of-00004.safetensors', 4976698672, '65bc656006ec47515e6ab1c4b4054ebe61c7416b310248c73941c3865fbe51f9'),
    @('model-00002-of-00004.safetensors', 4999802720, 'a83a0fd19a314dfecfbd22143b0e07a42f323298163813eae85ceb6a3cda5bde'),
    @('model-00003-of-00004.safetensors', 4915916176, '5bcd190bd0d900b1d9a452ef333485c64e56a2c02b4d37df3a7eb76e22fa4f58'),
    @('model-00004-of-00004.safetensors', 1168138808, 'cc51bdcd9d75e865b1079b77a982190ad146a5a500c563b93ef7b0804ad8ef97')
)
foreach ($b in $big) {
    if (Test-Path "$dst\$($b[0])") { "have $($b[0])"; continue }
    "== $($b[0])"
    & $py -I -u D:\ai-midel\pdl.py "$base/$($b[0])" "$dst\$($b[0])" $b[1] $b[2] 16
    if ($LASTEXITCODE -ne 0) { "FAILED $($b[0])"; exit 1 }
}
'ALL DONE'
