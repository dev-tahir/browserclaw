@echo off
:: Install Native Messaging Host for AI Browser Control Agent
:: Run this script as Administrator

setlocal

set HOST_NAME=com.browser_control.agent
set SCRIPT_DIR=%~dp0

:: Update the manifest with absolute path
set MANIFEST_PATH=%SCRIPT_DIR%com.browser_control.agent.json
set BAT_PATH=%SCRIPT_DIR%bridge.bat

:: Create a temp manifest with the absolute bat path
echo {> "%MANIFEST_PATH%"
echo   "name": "%HOST_NAME%",>> "%MANIFEST_PATH%"
echo   "description": "AI Browser Control Agent - Terminal Bridge",>> "%MANIFEST_PATH%"
echo   "path": "%BAT_PATH:\=\\%",>> "%MANIFEST_PATH%"
echo   "type": "stdio",>> "%MANIFEST_PATH%"
echo   "allowed_origins": [>> "%MANIFEST_PATH%"
echo     "chrome-extension://*/">> "%MANIFEST_PATH%"
echo   ]>> "%MANIFEST_PATH%"
echo }>> "%MANIFEST_PATH%"

:: Register in Chrome's native messaging hosts registry
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

if %errorlevel% equ 0 (
    echo.
    echo ✅ Native messaging host installed successfully!
    echo    Host: %HOST_NAME%
    echo    Manifest: %MANIFEST_PATH%
    echo    Bridge: %BAT_PATH%
    echo.
    echo    Make sure Node.js is installed and available in PATH.
    echo    Restart Chrome for changes to take effect.
) else (
    echo.
    echo ❌ Failed to install native messaging host.
    echo    Try running this script as Administrator.
)

pause
