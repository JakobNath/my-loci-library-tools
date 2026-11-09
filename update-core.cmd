@echo off
rem Copies core\ from the app repository (expected next to this one).
cd /d "%~dp0" && node update-core.mjs
