#!/usr/bin/env sh
# Lanceur Mac / Linux / Android (Termux) : ./demarrer.sh
cd "$(dirname "$0")" || exit 1

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
}

# 1. Node.js (22.13 ou plus)
if ! node_ok; then
  if [ -n "$TERMUX_VERSION" ]; then
    pkg install -y nodejs-lts || pkg install -y nodejs
  else
    echo "Node.js 22.13 ou plus est nécessaire : installe la version LTS depuis https://nodejs.org puis relance ./demarrer.sh"
    exit 1
  fi
fi
node_ok || { echo "Version de Node.js trop ancienne (22.13 minimum)."; exit 1; }

# 2. Composants et configuration (une seule fois)
[ -d node_modules/tsx ] || npm ci --omit=dev --no-audit --no-fund || exit 1
[ -f .env ] || npm run setup
[ -f .env ] || { echo "Configuration non terminée, relance ./demarrer.sh"; exit 1; }

# 3. Lancement avec redémarrage automatique (Android : empêche la mise en veille de Termux)
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
trap 'echo; echo "Agent arrêté."; exit 0' INT TERM
echo "Pour arrêter l'agent : Ctrl+C."
while true; do
  npm start
  echo "L'agent s'est arrêté, redémarrage dans 10 secondes..."
  sleep 10
done
