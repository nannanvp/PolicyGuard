@echo off
setlocal
cd /d "%~dp0"
set "POLICYGUARD_NODE="
where node >nul 2>nul
if not errorlevel 1 (
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>nul
  if not errorlevel 1 set "POLICYGUARD_NODE=node"
)
if not defined POLICYGUARD_NODE (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "POLICYGUARD_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
if not defined POLICYGUARD_NODE (
  echo Node.js 24 or newer is required. Install it from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
if not exist node_modules\ethers (
  echo Dependencies are missing. Run npm install in this folder, then launch again.
  pause
  exit /b 1
)
if /i "%~1"=="--sample" (
  echo Preparing optional fictional sample accounts. Stop PolicyGuard before this step.
  "%POLICYGUARD_NODE%" scripts\sample-data.js
) else (
  echo Starting PolicyGuard. The first start compiles and deploys two contracts.
  echo Wait for the ready message, then open http://127.0.0.1:3000
  echo Keep this window open. Press Ctrl+C to stop safely.
  "%POLICYGUARD_NODE%" app-server.js
)
pause
