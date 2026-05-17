@echo off
setlocal

set "ROOT=%~dp0"

echo [1/2] Syncing web assets to Android...
cd /d "%ROOT%"
call npx cap sync android
if errorlevel 1 (
    echo.
    echo ERROR: cap sync failed.
    exit /b 1
)

echo.
echo [2/2] Building debug APK...
cd /d "%ROOT%android"
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo.
    echo ERROR: Gradle build failed.
    exit /b 1
)

copy /y "%ROOT%android\app\build\outputs\apk\debug\app-debug.apk" "%ROOT%app-debug.apk" >nul

echo.
echo Build complete: %ROOT%app-debug.apk
endlocal
