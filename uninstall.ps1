# BiliSub 卸载脚本
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '正在停止引擎…'
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*main.py*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host '移除开机自启…'
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'BiliSubEngine' -ErrorAction SilentlyContinue

$models = Join-Path $root 'models'
$venv = Join-Path $root 'engine\.venv'
Write-Host ''
Write-Host "模型目录: $models"
if (Test-Path $models) {
  $answer = Read-Host '是否删除已下载的模型？(y/N)'
  if ($answer -eq 'y') { Remove-Item $models -Recurse -Force -ErrorAction SilentlyContinue }
}
if (Test-Path $venv) {
  $answer = Read-Host '是否删除 Python 环境（可重新安装）？(y/N)'
  if ($answer -eq 'y') { Remove-Item $venv -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host '请到 edge://extensions 手动移除「BiliSub 双语字幕」扩展。' -ForegroundColor Yellow
Read-Host '按回车退出'
