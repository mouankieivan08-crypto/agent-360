#!/bin/bash
# Mac : double-clic dans le Finder pour lancer l'agent.
cd "$(dirname "$0")" || exit 1
exec bash ./demarrer.sh
