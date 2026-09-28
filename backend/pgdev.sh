#!/usr/bin/env bash
# Starts/stops the dev-only Postgres cluster in backend/.pgdata — separate from
# any system-wide Postgres install, on port 5433 so it can't collide with one.
# Not a system service: nothing here runs at login, and nothing outside this
# repo's .env points at it. See backend/README.md for how it was set up.
set -euo pipefail

PG_BIN="/c/Program Files/PostgreSQL/13/bin"
DATA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.pgdata"
LOG_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.pglogs/postgres.log"
PORT=5433

case "${1:-}" in
  start)
    "$PG_BIN/pg_ctl.exe" -D "$DATA_DIR" -l "$LOG_FILE" -o "-p $PORT" start
    ;;
  stop)
    "$PG_BIN/pg_ctl.exe" -D "$DATA_DIR" stop
    ;;
  status)
    "$PG_BIN/pg_ctl.exe" -D "$DATA_DIR" status
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
