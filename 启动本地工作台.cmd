@echo off
chcp 65001 >nul
pushd "%~dp0"
node "%~dp0scripts\launch-local-workspace.cjs"
set "taskExit=%errorlevel%"
popd
if not "%taskExit%"=="0" pause
exit /b %taskExit%
