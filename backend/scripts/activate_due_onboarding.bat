@echo off
cd /d "%~dp0.."
".venv\Scripts\python.exe" manage.py activate_due_onboarding >> "%~dp0activate_due_onboarding.log" 2>&1
".venv\Scripts\python.exe" manage.py process_exits >> "%~dp0process_exits.log" 2>&1
