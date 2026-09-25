@echo off
rem Block Survival PC host: `pc-host` runs it in this window, `pc-host offline` hands the
rem global world to the players' browsers and stops a running host (docs/pc-host-research.md).
"%~dp0node.exe" "%~dp0dist\pc-host.mjs" %*
