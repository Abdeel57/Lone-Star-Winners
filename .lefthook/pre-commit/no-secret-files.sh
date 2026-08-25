#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Lone Star Winners - gate de pre-commit: ficheros que nunca deben versionarse.
#
# Propietario: security-integration.
# Es la misma comprobacion que hace CI (.github/workflows/security.yml),
# adelantada al pre-commit. CLAUDE.md, principios 19 y 20.
#
# ---------------------------------------------------------------------------
# POR QUE ESTE SCRIPT VIVE EN UN FICHERO Y NO EN UN BLOQUE `run: |`
# ---------------------------------------------------------------------------
# Porque en Windows un bloque `run: |` con comillas dobles NO se ejecuta
# entero. Se trunca en silencio. Cadena completa del fallo:
#
#   1. lefthook (Go) ejecuta el job como exec.Command("bash", "-c", script).
#   2. Windows no tiene argv: Go tiene que serializar los argumentos en UNA
#      unica linea de comandos con syscall.EscapeArg, que envuelve el script
#      en comillas dobles y escapa cada comilla interna como \".
#   3. bash.exe de Git Bash es un binario MSYS2. MSYS2 reparsea esa linea de
#      comandos con SUS reglas, y NO honra el \" de Go: la comilla escapada
#      cierra la region entrecomillada en vez de ser un caracter literal.
#   4. A partir de ahi el primer espacio en blanco que estaba DENTRO de unas
#      comillas del script original pasa a ser un separador de argumentos.
#
# Resultado medido (BASH_EXECUTION_STRING del propio hook, lefthook 1.13.6):
#
#   offenders=""                       ->  offenders="        <- comilla suelta
#   for f in {staged_files}; do        ->  for f in a.txt ...
#   case "$f" in                       ->  case $f in         <- comillas comidas
#   ...) offenders="$offenders $f" ;;  ->  ...) offenders=$offenders
#                                                             ^ AQUI SE CORTA
#
# Todo lo que venia despues del corte no se ejecuta: bash lo recibe como
# parametros posicionales ($0, $1...) que nadie mira.
#
# ---------------------------------------------------------------------------
# LO PELIGROSO NO ES EL ERROR DE SINTAXIS: ES EL CASO EN QUE NO HAY ERROR
# ---------------------------------------------------------------------------
# Aqui el truncamiento partio un `case` por la mitad y bash protesto, asi que
# nos enteramos. Pero el corte cae donde caiga la primera comilla. Si el
# fragmento que sobrevive resulta ser sintacticamente valido, el job SALE CON
# 0 sin haber comprobado nada. Verificado en banco de pruebas:
#
#   run: |
#     echo "AAA BBB"
#     echo "CCC DDD"
#     echo EEE
#
#   -> imprime solo `AAA`, no ejecuta las otras dos lineas, y termina en 0.
#      lefthook lo pinta con un check verde.
#
# Es la misma leccion que la trampa de String.raw: un gate que no revienta no
# esta necesariamente funcionando, puede estar ciego. Un gate de seguridad que
# pasa sin haber mirado nada es peor que no tener gate.
#
# REGLA PARA QUIEN EDITE lefthook.yml: en `run:` no se escriben comillas
# dobles. Si el script necesita comillas -y cualquier script de shell correcto
# las necesita, sin ellas no hay word splitting seguro-, va a un fichero .sh
# aqui y se invoca con `run: bash .lefthook/<hook>/<script>.sh`.
# ---------------------------------------------------------------------------

set -euo pipefail

# Los ficheros staged se calculan aqui, no con la plantilla {staged_files} de
# lefthook. Dos motivos: -z sobrevive a rutas con espacios o saltos de linea,
# y no se depende del limite de longitud de la linea de comandos de Windows
# (~32 KiB) cuando el commit toca cientos de ficheros.
if git rev-parse --verify --quiet HEAD > /dev/null; then
  diff_base=()
else
  # Primer commit del repositorio: no hay HEAD contra el que comparar.
  diff_base=("$(git hash-object -t tree /dev/null)")
fi

offenders=()

while IFS= read -r -d '' f; do
  base="${f##*/}"

  # Las plantillas versionadas son justo lo contrario de un secreto: existen
  # para documentar que variables hacen falta, con valores falsos.
  case "$base" in
    *.example | *.example.*) continue ;;
  esac

  # Se compara contra el basename: asi un id_rsa enterrado en
  # infra/keys/ se detecta igual que uno en la raiz.
  case "$base" in
    .env | .env.*) offenders+=("$f") ;;
    *.pem | *.key | *.p12 | *.pfx | *.jks | *.keystore) offenders+=("$f") ;;
    id_rsa | id_dsa | id_ecdsa | id_ed25519) offenders+=("$f") ;;
    credentials.json | secrets.json) offenders+=("$f") ;;
    service-account*.json) offenders+=("$f") ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMR -z "${diff_base[@]+"${diff_base[@]}"}")

if [ ${#offenders[@]} -gt 0 ]; then
  echo "Estos ficheros no pueden versionarse:"
  printf '  - %s\n' "${offenders[@]}"
  echo
  echo "Si alguno contenia un valor real, rotalo: ya paso por tu disco."
  echo "Si es una plantilla, renombrala a *.example y vuelve a intentarlo."
  exit 1
fi
