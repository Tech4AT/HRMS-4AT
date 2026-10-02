# All-in-one image: PostgreSQL + Django backend + Next.js frontend in one
# container. Build once, then a single `docker run` boots everything.
#
#   docker build -t hrms .
#   docker run --rm -p 3000:3000 -p 3001:3001 hrms
#
# Frontend: http://localhost:3001   Backend/API: http://localhost:3000
# This is a demo/dev convenience image (single container, runserver, bundled
# DB). For production you would split these into separate services.
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# System deps: Postgres server, Node.js 20, and build tools for any wheels.
RUN apt-get update && apt-get install -y --no-install-recommends \
        postgresql postgresql-contrib \
        curl ca-certificates gnupg build-essential libpq-dev \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Backend deps (cached unless requirements change) ---
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

# --- Frontend deps + build (cached unless lockfile/source change) ---
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci

# --- App source ---
COPY backend/ backend/
COPY frontend/ frontend/

# Build the Next.js app (server route handlers read BACKEND_API_URL at runtime).
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd frontend && npm run build

# --- Runtime configuration ---
# This is a demo/dev convenience image. Secrets (DJANGO_SECRET_KEY, POSTGRES_PASSWORD,
# INITIAL_ADMIN_PASSWORD) must be injected at runtime — they are NOT baked in.
# See env.example for the full variable reference.
ENV DJANGO_SETTINGS_MODULE=config.settings.dev \
    DJANGO_DEBUG=true \
    DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0 \
    POSTGRES_DB=hrms \
    POSTGRES_USER=hrms \
    POSTGRES_HOST=127.0.0.1 \
    POSTGRES_PORT=5432 \
    INITIAL_ADMIN_EMAIL=admin@hrms.local \
    BACKEND_API_URL=http://localhost:3000/api/v1 \
    MOCK_AUTH=false \
    PGDATA=/var/lib/postgresql/data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000 3001
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
