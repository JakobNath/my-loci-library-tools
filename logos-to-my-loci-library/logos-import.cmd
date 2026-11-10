@echo off
rem Imports a Logos Library export: logos-import.cmd "C:\path	o\Library.csv" [--full]
cd /d "%~dp0" && node logos-import.mjs %*
pause
