@echo off
REM Daily drain wrapper (called by Task Scheduler). Pulls uploaded OCR samples
REM into the local corpus and clears the bucket. Needs SUPABASE_SECRET_KEY set as
REM a user environment variable (see README.md).
setlocal
cd /d "%~dp0..\..\.."
node "scripts\train\auto\orchestrate.mjs" drain
exit /b %errorlevel%
