@echo off
REM Alternative download using curl (faster than PowerShell Invoke-WebRequest)
REM Download PBF file for Java Island

echo Downloading Java OSM data using curl...
echo File size: ~800MB, this may take several minutes
echo.

set URL=https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
set OUTPUT=data\java-latest.osm.pbf

REM Create data directory if it doesn't exist
if not exist "data" mkdir "data"

REM Remove old file if exists
if exist "%OUTPUT%" (
    echo Removing old file...
    del "%OUTPUT%"
)

echo Source: %URL%
echo Target: %OUTPUT%
echo.

REM Try curl first (usually available on Windows 10+)
where curl >nul 2>nul
if %ERRORLEVEL% == 0 (
    echo Using curl for faster download...
    curl -L --progress-bar -o "%OUTPUT%" "%URL%"
    if %ERRORLEVEL% == 0 (
        echo.
        echo ✓ Download completed successfully!
        for %%A in ("%OUTPUT%") do (
            set /a sizeMB=%%~zA/1048576
            echo File: %OUTPUT%
            echo Size: !sizeMB! MB
        )
        echo.
        echo Next steps:
        echo    1. Run: .\scripts\process-osrm-v6.ps1
        echo    2. Run: docker-compose up -d
        echo    3. Run: npm start
    ) else (
        echo Download failed with curl!
        goto :fallback
    )
) else (
    echo curl not found, trying PowerShell fallback...
    goto :fallback
)

goto :end

:fallback
echo Using PowerShell as fallback...
powershell -ExecutionPolicy Bypass -File ".\scripts\download-pbf.ps1"

:end
pause