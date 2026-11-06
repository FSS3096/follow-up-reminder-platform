#!/usr/bin/env bash
# Applies supabase/migrations to a throwaway local Postgres with a minimal Supabase stand-in
# (roles anon/authenticated/service_role, auth.uid()) and runs the RLS + claim checks.
# Needs: Postgres 15+ binaries on PATH (initdb, pg_ctl, psql). Does not touch Supabase.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
data="$(mktemp -d)"
port="${PGPORT_LOCAL:-5499}"
trap 'pg_ctl -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"' EXIT

initdb -D "$data" -A trust -U postgres >/dev/null
pg_ctl -D "$data" -o "-p $port -k $data" -l "$data/log" start >/dev/null
psql_() { psql -h "$data" -p "$port" -U postgres -X -q "$@"; }
psql_ -d postgres -c 'create database t' >/dev/null

psql_ -d t -v ON_ERROR_STOP=1 -f "$here/local_bootstrap.sql"
for f in "$root"/supabase/migrations/*.sql; do
  psql_ -d t -v ON_ERROR_STOP=1 -f "$f"
  echo "applied $(basename "$f")"
done
psql_ -d t -f "$here/local_checks.sql" 2>&1
