@echo off
setlocal enabledelayedexpansion

echo =======================================================
echo     Verificacion de Proyecto ServiceDesk Microservices
echo =======================================================
echo.

set "services=api-gateway auth-service catalog-service ticket-service frontend"
set "error_found=0"

for %%s in (%services%) do (
    echo [%%s] Verificando...
    if not exist "%%s" (
        echo [ERROR] No se encontro la carpeta %%s
        set "error_found=1"
    ) else (
        pushd "%%s"
        echo [%%s] Instalando dependencias...
        call npm install >nul 2>&1
        if !errorlevel! neq 0 (
            echo [ERROR] Fallo npm install en %%s.
            set "error_found=1"
        ) else (
            echo [%%s] Dependencias instaladas correctamente.
            
            REM Verificamos si existe el comando build
            findstr /C:"\"build\":" package.json >nul 2>&1
            if !errorlevel! equ 0 (
                echo [%%s] Ejecutando build de prueba...
                call npm run build >nul 2>&1
                if !errorlevel! neq 0 (
                    echo [ERROR] Fallo la compilacion build en %%s.
                    set "error_found=1"
                ) else (
                    echo [%%s] Compilacion exitosa.
                )
            ) else (
                echo [%%s] No se encontro script de build, omitiendo compilacion.
            )
        )
        popd
    )
    echo -------------------------------------------------------
)

if "%error_found%"=="1" (
    echo.
    echo =======================================================
    echo [ERROR CRITICO] Se encontraron problemas durante la verificacion.
    echo Por favor, revisa los logs arriba para mas detalles.
    echo =======================================================
    exit /b 1
) else (
    echo.
    echo =======================================================
    echo [EXITO] Todas las dependencias se instalaron y
    echo compilaron correctamente. El proyecto esta listo.
    echo =======================================================
)

echo.
echo Verificando Docker y contenedores...
docker-compose config >nul 2>&1
if !errorlevel! neq 0 (
    echo [ADVERTENCIA] docker-compose.yml tiene errores de sintaxis o docker no esta disponible.
) else (
    echo [EXITO] docker-compose.yml es valido.
)

pause
