#!/usr/bin/env bash
# Prueba de carga con JMeter (Docker) contra la API levantada con docker compose.
# Uso (desde la raíz del repo, en bash o Git Bash):
#   bash load/run.sh                       # 20 usuarios, rampa 20 s, 120 s
#   USUARIOS=50 RAMPUP=30 DURACION=180 bash load/run.sh
# Requiere .env con AUTH0_DOMAIN, AUTH0_AUDIENCE, AUTH0_CLIENT_ID y AUTH0_CLIENT_SECRET,
# y el seed aplicado (mesa 1 y productos 1 y 3).
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1   # Git Bash en Windows: no convertir rutas /load/...

set -a; . ./.env; set +a
USUARIOS="${USUARIOS:-20}"; RAMPUP="${RAMPUP:-20}"; DURACION="${DURACION:-120}"

# El token se obtiene una sola vez ANTES de la carga: la prueba no mide Auth0.
TOKEN="$(curl -fsS "https://${AUTH0_DOMAIN}/oauth/token" -H 'content-type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"${AUTH0_CLIENT_ID}\",\"client_secret\":\"${AUTH0_CLIENT_SECRET}\",\"audience\":\"${AUTH0_AUDIENCE}\"}" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
[ -n "$TOKEN" ] || { echo "No se pudo obtener el token de Auth0: revisar .env" >&2; exit 1; }

ID="$(date +%Y%m%d-%H%M%S)"
SALIDA="load/resultados/${ID}"
mkdir -p "$SALIDA"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo desconocido)$(git diff --quiet 2>/dev/null || echo '+cambios')"
echo "Carga ${ID}: ${USUARIOS} usuarios, rampa ${RAMPUP} s, ${DURACION} s, commit ${COMMIT}"

docker compose --profile carga run --rm -T jmeter -n \
  -t /load/pedidos.jmx \
  -l "/load/resultados/${ID}/resultados.jtl" \
  -j "/load/resultados/${ID}/jmeter.log" \
  -e -o "/load/resultados/${ID}/reporte" \
  -Jhost=api -Jport=3000 -Jtoken="$TOKEN" \
  -Jusuarios="$USUARIOS" -Jrampup="$RAMPUP" -Jduracion="$DURACION"

cp "$SALIDA/reporte/statistics.json" "$SALIDA/statistics.json"
gzip -kf "$SALIDA/resultados.jtl"
cat > "$SALIDA/parametros.txt" <<EOF
fecha=${ID}
commit=${COMMIT}
usuarios=${USUARIOS}
rampup_s=${RAMPUP}
duracion_s=${DURACION}
host=api:3000 (red interna de Compose)
jmeter=alpine/jmeter:5.6.3
EOF
echo "Resultados en ${SALIDA}: reporte/index.html, statistics.json, resultados.jtl.gz"
