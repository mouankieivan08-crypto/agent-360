#!/usr/bin/env bash
# Lanceur Mac / Linux / Android (Termux).
# Mac : double-clic sur DEMARRER.command, ou dans le Terminal : bash demarrer.sh
cd "$(dirname "$0")" || exit 1

# Node.js installé par ce script dans le dossier de l'agent (sans mot de passe administrateur).
NODE_LOCAL="$PWD/.node"
[ -x "$NODE_LOCAL/bin/node" ] && export PATH="$NODE_LOCAL/bin:$PATH"

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
}

install_node_locally() {
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) return 1 ;; esac
  case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; x86_64 | amd64) arch=x64 ;; *) return 1 ;; esac
  base="https://nodejs.org/dist/latest-v24.x"
  line=$(curl -fsSL "$base/SHASUMS256.txt" | grep -E "node-v[0-9.]+-$os-$arch\.tar\.gz$") || return 1
  sum=${line%% *}
  file=${line##* }
  echo "Téléchargement de Node.js ($file)..."
  tmp=$(mktemp -d) || return 1
  curl -fL --progress-bar "$base/$file" -o "$tmp/$file" || return 1
  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tmp/$file" | awk '{print $1}')
  else
    actual=$(sha256sum "$tmp/$file" | awk '{print $1}')
  fi
  [ "$actual" = "$sum" ] || { echo "Téléchargement corrompu, relance le script."; rm -rf "$tmp"; return 1; }
  rm -rf "$NODE_LOCAL" && mkdir -p "$NODE_LOCAL"
  tar -xzf "$tmp/$file" -C "$NODE_LOCAL" --strip-components=1 || return 1
  rm -rf "$tmp"
  export PATH="$NODE_LOCAL/bin:$PATH"
}

# 1. Node.js (22.13 ou plus)
if ! node_ok; then
  if [ -n "$TERMUX_VERSION" ]; then
    pkg install -y nodejs-lts || pkg install -y nodejs
  else
    install_node_locally || {
      echo "Impossible d'installer Node.js automatiquement. Installe la version LTS depuis https://nodejs.org puis relance."
      exit 1
    }
  fi
fi
node_ok || { echo "Version de Node.js trop ancienne (22.13 minimum)."; exit 1; }

# 2. Composants et configuration (une seule fois)
if [ ! -d node_modules/tsx ]; then
  echo "Installation des composants, patiente une minute..."
  npm ci --omit=dev --no-audit --no-fund --ignore-scripts || exit 1
fi
[ -f .env ] || npm run setup
[ -f .env ] || { echo "Configuration non terminée, relance le lanceur."; exit 1; }

# 3. Lancement avec redémarrage automatique.
# Mac : caffeinate empêche la mise en veille tant que l'agent tourne. Android : wake-lock Termux.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
KEEP_AWAKE=""
command -v caffeinate >/dev/null 2>&1 && KEEP_AWAKE="caffeinate -i"
trap 'echo; echo "Agent arrêté."; exit 0' INT TERM
echo
echo "Pour arrêter l'agent : ferme cette fenêtre (ou Ctrl+C). Laisse l'ordinateur allumé et branché."
echo
while true; do
  $KEEP_AWAKE npm start
  echo "L'agent s'est arrêté, redémarrage dans 10 secondes..."
  sleep 10
done
