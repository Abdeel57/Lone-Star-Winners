@echo off
rem Recupera el QR del segundo factor del panel desde Railway.
rem Ver scripts\admin-recover-qr.mjs. Requiere `railway login` y `railway link` hechos,
rem y en %USERPROFILE%\.ssh\config `StrictHostKeyChecking accept-new` para
rem ssh.railway.com: la pregunta de la huella no se puede responder desde aqui.
cd /d "%~dp0"
echo.
echo  Conectando con Railway, espera unos segundos...
node scripts\admin-recover-qr.mjs
echo.
echo Cuando termines de escanear, cierra esta ventana.
pause
