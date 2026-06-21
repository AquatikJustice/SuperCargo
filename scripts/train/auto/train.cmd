@echo off
REM Training wrapper (called by Task Scheduler, or run by hand). Activates the
REM Python venv if present, then merges + trains + exports. Extra args pass through
REM (e.g. --min-new 200 --epochs 30).
setlocal
cd /d "%~dp0..\..\.."
if exist "scripts\train\.venv\Scripts\activate.bat" call "scripts\train\.venv\Scripts\activate.bat"
node "scripts\train\auto\orchestrate.mjs" train %*
exit /b %errorlevel%
