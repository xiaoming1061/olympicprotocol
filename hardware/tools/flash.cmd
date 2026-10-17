@echo off
rem Keep this file ASCII-only: cmd.exe reads .cmd in the OEM code page,
rem so UTF-8 Chinese comments would be parsed as broken commands.
setlocal EnableExtensions
title Olympic Protocol - flash watch

rem Machine paths (change these on another computer, or set them in the environment first)
if not defined ARDUINO_DIRECTORIES_DATA set "ARDUINO_DIRECTORIES_DATA=D:\arduino-data"
if not defined ARDUINO_DIRECTORIES_USER set "ARDUINO_DIRECTORIES_USER=D:\arduino-user"
if not defined OP_BUILD_DIR set "OP_BUILD_DIR=D:\op-build"

set "CLI=%LOCALAPPDATA%\arduino-cli\arduino-cli.exe"
set "SKETCH=%~dp0..\firmware"
set "FQBN=esp32:esp32:esp32c6:CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=no_ota"

if not exist "%CLI%" (
  echo arduino-cli not found: %CLI%
  echo Install it first, see hardware\BRINGUP.md
  pause
  exit /b 1
)

set "PORT=%~1"
if not "%PORT%"=="" goto haveport

echo Serial ports seen now:
"%CLI%" board list
echo.
set /p "PORT=Enter the board port (e.g. COM5), then press Enter: "
if "%PORT%"=="" goto fail

:haveport
echo.
echo [1/3] Compiling...
"%CLI%" compile --fqbn "%FQBN%" --build-path "%OP_BUILD_DIR%" "%SKETCH%"
if errorlevel 1 goto fail

echo.
echo [2/3] Uploading to %PORT% ...
"%CLI%" upload -p "%PORT%" --fqbn "%FQBN%" --input-dir "%OP_BUILD_DIR%" "%SKETCH%"
if errorlevel 1 goto fail

echo.
echo [3/3] Done. Opening serial monitor (Ctrl+C to quit)...
"%CLI%" monitor -p "%PORT%" -b "%FQBN%" --config baudrate=115200
goto end

:fail
echo.
echo Failed. Copy the last few lines and send them.
pause

:end
endlocal
