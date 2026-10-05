@echo off
cd /d "%~dp0.."
".venv\Scripts\python.exe" manage.py send_onboarding_reminders >> "%~dp0send_onboarding_reminders.log" 2>&1
