# Backend service image (Django + DRF). Used by the root docker-compose.yml.
# Build targets:
#   dev (default) — runserver, config.settings.dev, for local docker compose
#   prod          — gunicorn, config.settings.prod, for AWS ECS / production
FROM python:3.12-slim-bookworm AS base

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# --- Dev target (default) ---
FROM base AS dev
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]

# --- Production target ---
FROM base AS prod
RUN chmod +x docker-entrypoint-prod.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint-prod.sh"]
