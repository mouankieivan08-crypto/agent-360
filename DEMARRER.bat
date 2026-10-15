@echo off
setlocal
cd /d "%~dp0"
title Agent 360
chcp 65001 >nul

rem --- 1. Node.js (22.13 ou plus)
where node >nul 2>nul
if errorlevel 1 goto installnode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto installnode
goto deps

:installnode
echo.
echo Node.js est necessaire. Installation automatique en cours...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto nodefail
echo.
echo Node.js est installe. FERME cette fenetre puis relance DEMARRER.bat
pause
exit /b 0

:nodefail
echo.
echo Installation automatique impossible.
echo Installe Node.js (version LTS) depuis https://nodejs.org puis relance DEMARRER.bat
pause
exit /b 1

rem --- 2. Dependances (une seule fois)
:deps
if exist node_modules\tsx goto config
echo Installation des composants, patiente une minute...
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto depsfail
goto config

:depsfail
echo Echec de l'installation des composants. Verifie ta connexion internet et relance.
pause
exit /b 1

rem --- 3. Configuration (une seule fois)
:config
if exist .env goto run
call npm run setup
if not exist .env goto configfail
goto run

:configfail
echo Configuration non terminee. Relance DEMARRER.bat
pause
exit /b 1

rem --- 4. Lancement, avec redemarrage automatique
:run
echo.
echo Pour arreter l'agent : ferme cette fenetre. Laisse le PC allume, branche, sans mise en veille.
echo.
call npm start
echo.
echo L'agent s'est arrete. Redemarrage dans 10 secondes (ferme la fenetre pour annuler)...
timeout /t 10 >nul
goto run
