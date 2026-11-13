@echo off
rem Sends the catalog one way into Zotero (see the tools README).
cd /d "%~dp0" && node loci-zotero.mjs %*
rem The window stays open to show the report, except on a schedule (Task Scheduler passes --no-pause).
if /i not "%~1"=="--no-pause" pause
