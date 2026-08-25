#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Lone Star Winners - gate de pre-push: gitleaks sobre el historial completo.
#
# Propietario: security-integration. DEC-018.
#
# El pre-push mira el historial completo, no solo lo que se acaba de escribir:
# un secreto commiteado hace tres commits sigue estando ahi, y `git push` es el
# momento en que deja de ser un problema local.
#
# Fichero .sh y no bloque `run: |` por el mismo fallo de quoting Go/MSYS2
# documentado en .lefthook/pre-commit/no-secret-files.sh. Este job tenia
# exactamente el mismo bug latente que los dos de pre-commit: nunca habia
# llegado a ejecutarse entero.
# ---------------------------------------------------------------------------

set -euo pipefail

GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.18.4"

if command -v gitleaks > /dev/null 2>&1; then
  if gitleaks detect --help > /dev/null 2>&1; then
    exec gitleaks detect --config .gitleaks.toml --redact --no-banner
  elif gitleaks git --help > /dev/null 2>&1; then
    exec gitleaks git . --config .gitleaks.toml --redact --no-banner
  fi
fi

if command -v docker > /dev/null 2>&1; then
  exec docker run --rm -v "$(pwd):/repo" -w /repo "${GITLEAKS_IMAGE}" \
    detect --source=/repo --config=/repo/.gitleaks.toml --redact --no-banner
fi

echo "gitleaks no esta instalado y docker tampoco."
echo "Instalalo (Windows): winget install --id Gitleaks.Gitleaks"
echo "Este hook falla en cerrado a proposito (CLAUDE.md, principios 19 y 20)."
exit 1
