@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo 尚未构建界面，请先运行 npm run build。
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo 未找到桌面运行时，请先安装项目依赖。
  pause
  exit /b 1
)
start "超级IP智能体" "node_modules\electron\dist\electron.exe" .
