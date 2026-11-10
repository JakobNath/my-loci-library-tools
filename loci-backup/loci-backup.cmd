@echo off
rem The daily backup of My Loci Library (see the tools README). Add --archive "E:\Loci archive" for the yearly archive.
cd /d "%~dp0" && node loci-backup.mjs %*
