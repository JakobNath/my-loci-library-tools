@echo off
rem Checks that the book sources still answer as recorded (SOURCES.md).
cd /d "%~dp0" && node check-sources.mjs %*
pause
