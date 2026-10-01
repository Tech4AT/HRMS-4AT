#!/usr/bin/env bash
# Backend container entrypoint: wait for Postgres, migrate, seed, then serve.
set -e

echo "==> Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}"
until python -c "import socket,os; s=socket.socket(); s.settimeout(2); s.connect((os.environ['POSTGRES_HOST'], int(os.environ['POSTGRES_PORT'])))" 2>/dev/null; do
  sleep 1
done

echo "==> Migrating"
python manage.py migrate --noinput

if [ -f /data/docs/roster.xlsx ]; then
  echo "==> Loading REAL directory from docs/roster.xlsx"
  python manage.py load_real_directory /data/docs/roster.xlsx || true
else
  echo "==> No docs/roster.xlsx found; seeding demo data"
  python manage.py createinitialadmin || true
  python manage.py seed_demo_org || true
fi

echo "==> Starting Django on :3000"
exec python manage.py runserver 0.0.0.0:3000
