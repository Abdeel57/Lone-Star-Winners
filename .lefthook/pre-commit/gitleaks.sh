#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Lone Star Winners - gate de pre-commit: gitleaks sobre lo que se va a commitear.
#
# Propietario: security-integration. DEC-018.
#
# Este script vive en un fichero y no en un bloque `run: |` por el motivo
# documentado en detalle en .lefthook/pre-commit/no-secret-files.sh: en
# Windows, lefthook entrega el script a bash.exe a traves de una unica linea
# de comandos de Windows, y las comillas dobles que Go escapa como \" no las
# honra el parser MSYS2 de Git Bash. El script se trunca en la primera comilla
# y el resto no se ejecuta. Con este job el corte caia en el `echo` del bloque
# else, dejando el `if` sin cerrar:
#
#   no: -c: line 8: syntax error: unexpected end of file
#      ^ el "shell" llamado `no` era en realidad la palabra que seguia a
#        `echo "gitleaks` una vez rota la linea de comandos.
#
# ---------------------------------------------------------------------------
# POR QUE FALLA EN CERRADO
# ---------------------------------------------------------------------------
# Si gitleaks no esta instalado, el hook falla en vez de dejar pasar el commit.
# Un hook de seguridad que se salta solo cuando falta la herramienta es peor
# que no tenerlo: da una sensacion de cobertura que no existe. CI vuelve a
# escanear el historial completo de todas formas, asi que saltarse el hook no
# evita la deteccion, solo la retrasa hasta que el secreto ya esta publicado.
# ---------------------------------------------------------------------------

set -euo pipefail

# Misma version que el gate de CI (.github/workflows/security.yml). Un escaner
# de secretos solo debe cambiar de reglas cuando alguien lo decide.
GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.18.4"

if command -v gitleaks > /dev/null 2>&1; then
  # gitleaks v8.19 renombro `protect` a `git --staged`. Se decide preguntando
  # al binario, no por el codigo de salida de un intento: `protect` inexistente
  # y `protect` que encuentra un secreto salen ambos con 1, y confundirlos
  # significaria tragarse un hallazgo real.
  if gitleaks protect --help > /dev/null 2>&1; then
    exec gitleaks protect --staged \
      --config .gitleaks.toml --redact --no-banner --verbose
  elif gitleaks git --help > /dev/null 2>&1; then
    exec gitleaks git --staged . \
      --config .gitleaks.toml --redact --no-banner --verbose
  else
    echo "gitleaks esta instalado pero no expone ni 'protect' ni 'git --staged'."
    echo "Version encontrada: $(gitleaks version 2>&1 || echo desconocida)"
    echo "Este hook falla en cerrado a proposito (CLAUDE.md, principios 19 y 20)."
    exit 1
  fi
fi

if command -v docker > /dev/null 2>&1; then
  exec docker run --rm -v "$(pwd):/repo" -w /repo "${GITLEAKS_IMAGE}" \
    protect --staged \
    --config /repo/.gitleaks.toml --redact --no-banner --verbose
fi

echo "gitleaks no esta instalado y docker tampoco."
echo
echo "Instalalo (Windows):   winget install --id Gitleaks.Gitleaks"
echo "Instalalo (macOS):     brew install gitleaks"
echo "Binarios y otros SO:   https://github.com/gitleaks/gitleaks#installing"
echo
echo "Este hook falla en cerrado a proposito (CLAUDE.md, principios 19 y 20)."
echo "No uses --no-verify: CI escanea el historial completo y te bloqueara"
echo "igualmente, pero para entonces el secreto ya estara publicado."
exit 1
