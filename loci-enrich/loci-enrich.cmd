@echo off
rem Fills empty book fields in the data repository named in config.json.
cd /d "%~dp0" && node loci-enrich.mjs %*
pause
