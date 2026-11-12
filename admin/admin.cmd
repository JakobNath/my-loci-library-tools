@echo off
rem The admin page of My Loci Library (see the tools README): opens it in the browser. Close this window to stop it.
cd /d "%~dp0" && node admin.mjs %*
