@echo off
setlocal

set "ROOT=%~dp0"
set "SRC=%ROOT%www"
set "OUT=%ROOT%dist"
set "ZIP=%OUT%\zen-pomodoro-firefox.zip"
set "STAGE=%OUT%\_stage_firefox"

if not exist "%OUT%" mkdir "%OUT%"
if exist "%ZIP%" del /q "%ZIP%"
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"
mkdir "%STAGE%\icons"

copy /y "%SRC%\manifest.json"   "%STAGE%\" >nul
copy /y "%SRC%\background.js"   "%STAGE%\" >nul
copy /y "%SRC%\index.html"      "%STAGE%\" >nul
copy /y "%SRC%\tab.css"         "%STAGE%\" >nul
copy /y "%SRC%\tab.js"          "%STAGE%\" >nul
copy /y "%SRC%\icons\icon.svg"  "%STAGE%\icons\" >nul

powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%ZIP%' -Force"

rmdir /s /q "%STAGE%"

echo.
echo Created: %ZIP%
endlocal
