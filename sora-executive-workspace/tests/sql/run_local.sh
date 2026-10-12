#!/usr/bin/env bash
# Chạy migrations + seed + test SQL trên một Postgres 15/16 tạm (không cần Supabase).
# Dùng: bash tests/sql/run_local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || echo /usr/lib/postgresql/16/bin/pg_ctl)")}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c timezone=UTC" -l "$TMP/log" start >/dev/null
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/tests/sql/00_local_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"; "${PSQL[@]}" -f "$f"
done
for f in "$ROOT"/tests/sql/[1-9]*_test.sql; do
  echo "→ $(basename "$f")"; "${PSQL[@]}" -f "$f"
done
echo "→ seed.sql"; "${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -At -c "select 'demo tasks: '||count(*) from public.tasks where source='demo'"
"${PSQL[@]}" -At -c "select 'demo goals: '||count(*) from public.goals where source='demo'"
