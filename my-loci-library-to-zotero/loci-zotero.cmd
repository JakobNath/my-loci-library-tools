@echo off
rem Sends the catalog one way into Zotero (see the tools README).
cd /d "%~dp0" && node loci-zotero.mjs %*
pause
