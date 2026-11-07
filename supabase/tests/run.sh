#!/usr/bin/env bash
# Builds a throwaway Postgres database, applies the schema and runs the permission tests.
# Needs PostgreSQL client + server binaries. Set PGBIN if they are not on PATH (e.g. /usr/lib/postgresql/16/bin).
# Uses a temporary cluster on port 5544; set PGHOST/PGPORT/PGUSER to reuse an existing server instead.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${PGBIN:-}"; [ -n "$BIN" ] && BIN="$BIN/"
HOST="${PGHOST:-}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
STARTED=""
if [ -z "$HOST" ]; then
  DIR="$(mktemp -d)"; chmod 777 "$DIR"; HOST=/tmp
  su postgres -c "${BIN}initdb -D $DIR/data -A trust >/dev/null && ${BIN}pg_ctl -D $DIR/data -o '-p $PORT -k /tmp' -l $DIR/log start >/dev/null"
  STARTED="$DIR"; sleep 2
fi
P=(${BIN}psql -h "$HOST" -p "$PORT" -U "$USER_" -v ON_ERROR_STOP=1 -q)
"${P[@]}" -c "drop database if exists perm_test" -c "create database perm_test"
for f in tests/00_stubs.sql migrations/*.sql seed.sql; do "${P[@]}" -d perm_test -f "$f"; done
OUT="$("${P[@]}" -d perm_test -f tests/01_permissions.sql)"
echo "$OUT"
[ -n "$STARTED" ] && su postgres -c "${BIN}pg_ctl -D $STARTED/data stop >/dev/null" || true
if echo "$OUT" | grep -v '|t$' | grep -q .; then echo "FAILED"; exit 1; fi
echo "All $(echo "$OUT" | grep -c '|t$') permission checks passed."
