# BiliSub 安装脚本（Windows 10 / 11）
# 用法：右键「使用 PowerShell 运行「，或双击 install.cmd
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$engine = Join-Path $root 'engine'
$venv = Join-Path $engine '.venv'
$pyExe = Join-Path $venv 'Scripts\python.exe'
$pywExe = Join-Path $venv 'Scripts\pythonw.exe'

Write-Host ''
Write-Host '==============================' -ForegroundColor Cyan
Write-Host '  BiliSub 双语字幕 · 安装程序' -ForegroundColor Cyan
Write-Host '==============================' -ForegroundColor Cyan
Write-Host "安装目录: $root"
Write-Host ''

# ---------- 1. 检查 Python ----------
$launcher = $null
if (Get-Command py -ErrorAction SilentlyContinue) { $launcher = 'py' }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $launcher = 'python' }

if (-not $launcher) {
  Write-Host '未找到 Python。请先安装 Python 3.10 及以上版本：https://www.python.org/downloads/' -ForegroundColor Red
  Write-Host '安装时记得勾选 「Add python.exe to PATH「。'
  Read-Host '按回车退出'
  exit 1
}

# ---------- 2. 创建虚拟环境 ----------
if (-not (Test-Path $pyExe)) {
  Write-Host '[1/4] 创建独立 Python 环境（不污染系统 Python）…'
  if ($launcher -eq 'py') { & py -3 -m venv $venv } else { & python -m venv $venv }
  if ($LASTEXITCODE -ne 0) { Write-Host '创建虚拟环境失败' -ForegroundColor Red; Read-Host; exit 1 }
} else {
  Write-Host '[1/4] 已存在 Python 环境，跳过'
}

# ---------- 3. 安装依赖（失败自动换源） ----------
Write-Host '[2/4] 安装引擎依赖（首次约 200MB，请耐心等待）…'
$req = Join-Path $engine 'requirements.txt'
& $pyExe -m pip install --upgrade pip --quiet
& $pyExe -m pip install -r $req --quiet
if ($LASTEXITCODE -ne 0) {
  Write-Host '默认源失败，改用清华镜像重试…' -ForegroundColor Yellow
  & $pyExe -m pip install -r $req --quiet -i https://pypi.tuna.tsinghua.edu.cn/simple
}
if ($LASTEXITCODE -ne 0) {
  Write-Host '依赖安装失败，请检查网络后重试。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

# ---------- 4. 生成配置 ----------
$cfgPath = Join-Path $engine 'config.json'
if (-not (Test-Path $cfgPath)) {
  $cfg = @{
    port       = 8765
    models_dir = Join-Path $root 'models'
    mt         = @{ provider = 'local'; model = 'mt-opus-en-zh' }
    asr        = @{ model = 'asr-whisper-small'; enabled = $true }
  } | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($cfgPath, $cfg, [System.Text.Encoding]::UTF8)
}
New-Item -ItemType Directory -Force -Path (Join-Path $root 'models') | Out-Null
Write-Host '[3/4] 配置已生成'

# ---------- 5. 开机自启 ----------
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$cmd = '"{0}" "{1}"' -f $pywExe, (Join-Path $engine 'main.py')
Set-ItemProperty -Path $runKey -Name 'BiliSubEngine' -Value $cmd
Write-Host '[4/4] 已设置开机自启'

# ---------- 6. 启动引擎并打开扩展页 ----------
try {
  Start-Process -FilePath $pywExe -ArgumentList (Join-Path $engine 'main.py') -WorkingDirectory $engine -WindowStyle Hidden
} catch {
  Write-Host '引擎启动失败（可稍后手动运行 start-engine.cmd）' -ForegroundColor Yellow
}

Start-Sleep -Seconds 1
$extDir = Join-Path $root 'extension'
Set-Clipboard -Value $extDir

Write-Host ''
Write-Host '================ 下一步 ================' -ForegroundColor Green
Write-Host '1) 在打开的 edge://extensions 页面，开启「开发人员模式」'
Write-Host '2) 点击「加载解压缩的扩展」'
Write-Host "3) 选择目录（已复制到剪贴板）：$extDir"
Write-Host '4) 回到任意视频页面，点右下角「译」开始'
Write-Host '========================================' -ForegroundColor Green
Write-Host ''
Write-Host '模型会在扩展的「引擎与模型设置」里按需下载。'
Write-Host ''

Start-Process 'msedge.exe' 'edge://extensions'
Read-Host '按回车关闭本窗口'
