#!/usr/bin/env bash
# Production backend entrypoint: wait for Postgres, migrate, collectstatic, then serve via gunicorn.
# Uses config.settings.prod (set DJANGO_SETTINGS_MODULE=config.settings.prod in env).
set -e

echo "==> Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}"
until python -c "import socket,os; s=socket.socket(); s.settimeout(2); s.connect((os.environ['POSTGRES_HOST'], int(os.environ['POSTGRES_PORT'])))" 2>/dev/null; do
  sleep 1
done

echo "==> Migrating"
python manage.py migrate --noinput

echo "==> Collecting static files (WhiteNoise)"
python manage.py collectstatic --noinput

echo "==> Ensuring initial admin user"
python manage.py createinitialadmin || true

# NOTE: Do NOT run load_real_directory here — it wipes all users and org data.
# To import a real roster: docker compose exec backend \
#   python manage.py load_real_directory /data/docs/roster.xlsx --force

echo "==> Starting gunicorn on :3000"
exec gunicorn config.wsgi \
  --bind 0.0.0.0:3000 \
  --workers "${GUNICORN_WORKERS:-4}" \
  --timeout "${GUNICORN_TIMEOUT:-120}" \
  --access-logfile - \
  --error-logfile -
