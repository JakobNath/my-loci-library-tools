@echo off
rem Fills catalog heights in the data repository named in config.json.
cd /d "%~dp0" && node loci-sizes.mjs %*
pause
