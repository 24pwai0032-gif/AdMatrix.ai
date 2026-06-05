#!/usr/bin/env bash
# AdMatrix.ai — Alibaba Cloud Container Registry push + ECS launch
set -euo pipefail

REGISTRY="${ACR_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}"
NAMESPACE="${ACR_NAMESPACE:-admatrix}"
VERSION="${VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo 'latest')}"
ECS_HOST="${ECS_HOST:-}"
ECS_USER="${ECS_USER:-root}"

BACKEND_IMAGE="${REGISTRY}/${NAMESPACE}/admatrix-backend:${VERSION}"
FRONTEND_IMAGE="${REGISTRY}/${NAMESPACE}/admatrix-frontend:${VERSION}"

echo "==> Building images (version: ${VERSION})"
docker build -t "${BACKEND_IMAGE}" ./backend
docker build -t "${FRONTEND_IMAGE}" ./frontend

echo "==> Logging into Alibaba Cloud Container Registry"
docker login "${REGISTRY}" -u "${ACR_USERNAME:?Set ACR_USERNAME}" -p "${ACR_PASSWORD:?Set ACR_PASSWORD}"

echo "==> Pushing images"
docker push "${BACKEND_IMAGE}"
docker push "${FRONTEND_IMAGE}"

if [ -n "${ECS_HOST}" ]; then
  echo "==> Deploying to ECS (${ECS_HOST})"
  ssh "${ECS_USER}@${ECS_HOST}" bash -s <<REMOTE
    set -euo pipefail
    export BACKEND_IMAGE="${BACKEND_IMAGE}"
    export FRONTEND_IMAGE="${FRONTEND_IMAGE}"

    docker pull "\${BACKEND_IMAGE}"
    docker pull "\${FRONTEND_IMAGE}"

    docker stop admatrix-backend admatrix-frontend admatrix-celery 2>/dev/null || true
    docker rm admatrix-backend admatrix-frontend admatrix-celery 2>/dev/null || true

    docker network create admatrix-net 2>/dev/null || true

    docker run -d --name admatrix-backend --network admatrix-net \
      -p 8000:8000 \
      -e DATABASE_URL="\${DATABASE_URL}" \
      -e REDIS_URL="\${REDIS_URL:-redis://redis:6379/0}" \
      -e QWEN_API_KEY="\${QWEN_API_KEY}" \
      "\${BACKEND_IMAGE}"

    docker run -d --name admatrix-celery --network admatrix-net \
      -e REDIS_URL="\${REDIS_URL:-redis://redis:6379/0}" \
      "\${BACKEND_IMAGE}" \
      celery -A app.tasks.video_pipeline.celery_app worker --loglevel=info

    docker run -d --name admatrix-frontend --network admatrix-net \
      -p 3000:3000 \
      -e NEXT_PUBLIC_API_URL="\${NEXT_PUBLIC_API_URL:-http://localhost:8000}" \
      "\${FRONTEND_IMAGE}"

    echo "Deployment complete."
REMOTE
else
  echo "==> Skipping ECS deploy (set ECS_HOST to enable remote launch)"
fi

echo "==> Done. Images:"
echo "    Backend:  ${BACKEND_IMAGE}"
echo "    Frontend: ${FRONTEND_IMAGE}"
