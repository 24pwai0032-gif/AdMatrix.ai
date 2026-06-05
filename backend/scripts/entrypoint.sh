#!/usr/bin/env sh
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running Alembic migrations..."
  alembic upgrade head || echo "Migration skipped (tables may be created via init_db)"
fi

if [ "${USE_GUNICORN:-false}" = "true" ]; then
  exec gunicorn app.main:app \
    -k uvicorn.workers.UvicornWorker \
    -b "0.0.0.0:8000" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
