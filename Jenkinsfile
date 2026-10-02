// HRMS-4AT — deploy pipeline for the single-EC2 bare-metal architecture.
//
// Jenkins runs ON the app box (hrms-server, ap-south-1a) and builds the
// `deployment` branch. It deploys the Django backend AND the Next.js frontend:
//   backend  → /var/www/hrms          (gunicorn 127.0.0.1:8000, supervisor `hrms`)
//   frontend → /var/www/hrms-frontend (next start -p 3001, supervisor `hrms-frontend`)
// nginx fronts both (/ → :3001, /admin /healthz /static → :8000).
//
// Only CODE is shipped: rsync copies the backend/ and frontend/ subtrees only,
// so repo-root junk (.claude, docs/, *.md, hrms_dump.sql, .git) never reaches
// EC2. Secrets live only in the box's .env files — never in git, never here.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()      // one deploy at a time on a t3.micro
    timeout(time: 30, unit: 'MINUTES')
  }

  environment {
    BACKEND_DIR  = '/var/www/hrms'
    FRONTEND_DIR = '/var/www/hrms-frontend'
    VENV         = '/var/www/hrms/venv'
    PY           = '/var/www/hrms/venv/bin/python'
    PIP          = '/var/www/hrms/venv/bin/pip'
    DJANGO_SETTINGS_MODULE = 'config.settings.prod'
    HEALTH_URL   = 'http://127.0.0.1:8000/healthz'
    // Cap Node heap so `next build` GCs instead of ballooning past 1 GB RAM.
    // Pair with a swap file on the box (ops task) for headroom.
    NODE_OPTIONS = '--max-old-space-size=1536'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git rev-parse --short HEAD > .gitsha && echo "Deploying $(cat .gitsha)"'
      }
    }

    // ---- Backend ----

    // Snapshot current backend code so a bad deploy can be restored (in-place
    // rsync has no image to roll back to).
    stage('Backup backend') {
      steps {
        sh '''
          set -euo pipefail
          mkdir -p "$BACKEND_DIR/../hrms-backups"
          TS=$(date +%Y%m%d-%H%M%S)
          tar -C "$BACKEND_DIR" \
            --exclude=venv --exclude=.env --exclude=media --exclude=staticfiles \
            -czf "$BACKEND_DIR/../hrms-backups/backend-$TS.tgz" . 2>/dev/null || true
          echo "$TS" > .backup_ts
          ls -1t "$BACKEND_DIR/../hrms-backups"/backend-*.tgz | tail -n +6 | xargs -r rm -f
        '''
      }
    }

    stage('Deploy backend') {
      steps {
        sh '''
          set -euo pipefail
          rsync -a --delete \
            --exclude='.git' --exclude='venv' --exclude='.env' \
            --exclude='media' --exclude='staticfiles' \
            backend/ "$BACKEND_DIR/"
        '''
      }
    }

    stage('Backend dependencies') {
      steps {
        sh '''
          set -euo pipefail
          "$PIP" install --upgrade pip
          "$PIP" install -r "$BACKEND_DIR/requirements.txt"
        '''
      }
    }

    // Config sanity on the fresh code + live .env, before migrate/restart.
    // Plain --deploy: prints the expected HTTP-only security warnings but exits
    // non-zero only on real config ERRORs, so it won't block deploys pre-TLS.
    stage('Checks') {
      steps {
        sh 'cd "$BACKEND_DIR" && "$PY" manage.py check --deploy'
      }
    }

    stage('Migrate') {
      // Plain migrate only. The destructive roster seed (load_real_directory)
      // is NEVER run here — it is manual + --force-gated.
      steps {
        sh 'cd "$BACKEND_DIR" && "$PY" manage.py migrate --noinput'
      }
    }

    stage('Collect static') {
      steps {
        sh 'cd "$BACKEND_DIR" && "$PY" manage.py collectstatic --noinput'
      }
    }

    stage('Restart backend') {
      // jenkins ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl
      steps {
        sh 'sudo /usr/bin/supervisorctl restart hrms'
      }
    }

    stage('Backend health') {
      steps {
        sh '''
          set -euo pipefail
          ok=0
          for i in $(seq 1 15); do
            code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)
            if [ "$code" = "200" ]; then ok=1; break; fi
            sleep 2
          done
          [ "$ok" = "1" ] || { echo "healthz never returned 200"; exit 1; }
          prot=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/v1/permissions/ || true)
          [ "$prot" = "401" ] || { echo "protected route returned $prot, expected 401"; exit 1; }
          echo "Backend health + authz OK"
        '''
      }
    }

    // ---- Frontend ----

    stage('Build frontend') {
      steps {
        // Free the running frontend's RAM during the build (t3.micro is tight).
        sh 'sudo /usr/bin/supervisorctl stop hrms-frontend || true'
        dir('frontend') {
          sh '''
            set -euo pipefail
            npm ci
            npm run build
          '''
        }
      }
    }

    stage('Deploy frontend') {
      steps {
        sh '''
          set -euo pipefail
          # Ship source + built .next (NOT node_modules — installed fresh on target).
          rsync -a --delete \
            --exclude='.git' --exclude='node_modules' --exclude='.env' \
            frontend/ "$FRONTEND_DIR/"
          # `next start` needs production deps present on the target.
          cd "$FRONTEND_DIR" && npm ci --omit=dev
        '''
      }
    }

    stage('Restart frontend') {
      steps {
        sh 'sudo /usr/bin/supervisorctl restart hrms-frontend'
      }
    }

    stage('Frontend health') {
      steps {
        sh '''
          set -euo pipefail
          ok=0
          for i in $(seq 1 15); do
            code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/ || true)
            # any non-5xx means the Node server is up and routing
            if [ -n "$code" ] && [ "$code" -lt 500 ]; then ok=1; break; fi
            sleep 2
          done
          [ "$ok" = "1" ] || { echo "frontend :3001 not healthy"; exit 1; }
          echo "Frontend up"
        '''
      }
    }
  }

  post {
    failure {
      // Restore backend code if we had swapped it in this run; make sure the
      // frontend is running again even if its build/deploy failed.
      sh '''
        set -euo pipefail
        if [ -f .backup_ts ]; then
          TS=$(cat .backup_ts)
          BK="$BACKEND_DIR/../hrms-backups/backend-$TS.tgz"
          if [ -f "$BK" ]; then
            echo "Deploy failed — restoring backend release $TS"
            tar -C "$BACKEND_DIR" -xzf "$BK"
            cd "$BACKEND_DIR" && "$PY" manage.py collectstatic --noinput || true
            sudo /usr/bin/supervisorctl restart hrms || true
          fi
        fi
        sudo /usr/bin/supervisorctl start hrms-frontend || true
      '''
      echo '❌ Deployment failed — rolled back where possible.'
    }
    success {
      echo "✅ Deployed $(cat .gitsha 2>/dev/null || echo unknown)"
    }
  }
}
