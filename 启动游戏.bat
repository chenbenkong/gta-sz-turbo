@echo off
title 深城纪 TURBO
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0启动游戏.ps1"
if errorlevel 1 pause
