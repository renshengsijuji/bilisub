# 可选：仅在需要分发给他人时才运行；日常使用请直接加载 extension 目录
# 打包：生成可分发的 zip（不含 .venv / models / 测试产物）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $env:TEMP ('bilisub-stage-' + [guid]::NewGuid().ToString('N'))
$out = Join-Path (Split-Path -Parent $root) 'BiliSub-0.1.0.zip'

New-Item -ItemType Directory -Force -Path $stage | Out-Null

$top = @('install.cmd', 'install.ps1', 'uninstall.ps1', 'start-engine.cmd', 'README.md')
foreach ($item in $top) {
  Copy-Item (Join-Path $root $item) (Join-Path $stage $item)
}
foreach ($dir in @('extension', 'docs', 'tools')) {
  Copy-Item (Join-Path $root $dir) (Join-Path $stage $dir) -Recurse
}

# engine：排除虚拟环境、缓存与本机配置（安装时会重新生成）
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'engine') | Out-Null
Get-ChildItem (Join-Path $root 'engine') -File |
  Where-Object { $_.Name -ne 'config.json' } |
  Copy-Item -Destination (Join-Path $stage 'engine')
Get-ChildItem (Join-Path $root 'engine') -Directory |
  Where-Object { $_.Name -notin @('.venv', '__pycache__') } |
  Copy-Item -Destination (Join-Path $stage 'engine') -Recurse

# 清理测试产物
Get-ChildItem $stage -Recurse -Include *.png -ErrorAction SilentlyContinue |
  Where-Object { $_.DirectoryName -like '*tools*' } |
  Remove-Item -Force -ErrorAction SilentlyContinue

if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host "已生成: $out ($size MB)" -ForegroundColor Green
