@echo off
chcp 65001 >nul
cd /d "%~dp0engine"
if not exist ".venv\Scripts\python.exe" (
  echo 尚未安装，请先运行 install.cmd
  pause
  exit /b 1
)
echo BiliSub 引擎启动中…… 按 Ctrl+C 退出
".venv\Scripts\python.exe" main.py
pause
