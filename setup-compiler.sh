#!/bin/sh
# Baixa o compilador AMXX 1.10 (Linux) para o Render.
# Roda durante o build. Uso: sh setup-compiler.sh
set -e

cd "$(dirname "$0")"
mkdir -p compiler
cd compiler

if [ ! -x addons/amxmodx/scripting/amxxpc ]; then
  echo "[setup-compiler] Baixando compilador AMXX 1.10 (base + cstrike)..."
  curl -sL -o base-linux.tar.gz https://github.com/alliedmodders/amxmodx/releases/download/1.10.0.5478/amxmodx-1.10.0-git5478-base-linux.tar.gz
  curl -sL -o cstrike-linux.tar.gz https://github.com/alliedmodders/amxmodx/releases/download/1.10.0.5478/amxmodx-1.10.0-git5478-cstrike-linux.tar.gz
  tar xzf base-linux.tar.gz
  tar xzf cstrike-linux.tar.gz
  rm -f base-linux.tar.gz cstrike-linux.tar.gz
fi

chmod +x addons/amxmodx/scripting/amxxpc 2>/dev/null || true
echo "[setup-compiler] Compiler OK: $(pwd)/addons/amxmodx/scripting/amxxpc"