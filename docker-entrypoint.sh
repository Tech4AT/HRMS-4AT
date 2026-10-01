#!/usr/bin/env bash
# Boots Postgres, migrates + seeds the DB, then runs Django (:3000) and
# Next.js (:3001) together. Idempotent: safe to re-run on a persisted volume.
set -e

PG_BIN="$(ls -d /usr/lib/postgresql/*/bin | head -1)"
export PATH="$PG_BIN:$PATH"

echo "==> Preparing PostgreSQL data dir at $PGDATA"
mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  su postgres -c "$PG_BIN/initdb -D '$PGDATA' -E UTF8"
fi

echo "==> Starting PostgreSQL"
su postgres -c "$PG_BIN/pg_ctl -D '$PGDATA' -o '-c listen_addresses=127.0.0.1 -p ${POSTGRES_PORT}' -w -t 60 start"

echo "==> Ensuring role and database exist"
su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'\" | grep -q 1" \
  || su postgres -c "psql -c \"CREATE ROLE ${POSTGRES_USER} LOGIN PASSWORD '${POSTGRES_PASSWORD}' CREATEDB;\""
su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'\" | grep -q 1" \
  || su postgres -c "createdb -O ${POSTGRES_USER} ${POSTGRES_DB}"

echo "==> Migrating and seeding"
cd /app/backend
python manage.py migrate --noinput
if [ -f /data/docs/roster.xlsx ]; then
  echo "==> Loading REAL directory from docs/roster.xlsx"
  python manage.py load_real_directory /data/docs/roster.xlsx || true
else
  python manage.py createinitialadmin || true
  python manage.py seed_demo_org || true
fi

echo "==> Starting Django on :3000 and Next.js on :3001"
cd /app/backend && python manage.py runserver 0.0.0.0:3000 &
DJANGO_PID=$!
cd /app/frontend && npm run start -- -p 3001 &
NEXT_PID=$!

# If either process exits, stop the container.
trap 'kill $DJANGO_PID $NEXT_PID 2>/dev/null; su postgres -c "$PG_BIN/pg_ctl -D \"$PGDATA\" stop -m fast" 2>/dev/null' TERM INT
wait -n $DJANGO_PID $NEXT_PID
echo "A service exited; shutting down."
kill $DJANGO_PID $NEXT_PID 2>/dev/null || true
