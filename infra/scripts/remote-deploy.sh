#!/usr/bin/env bash

set -euo pipefail

# 这个脚本由 GitHub Actions 在 runner 侧执行，再通过 SSH 把版本化的部署逻辑流式发送到服务器。
# 服务器不保存仓库源码，只保留 compose、.env 和容器数据。

: "${SERVER_HOST:?缺少 SERVER_HOST}"
: "${SERVER_USER:?缺少 SERVER_USER}"
: "${SERVER_SSH_PASSWORD:?缺少 SERVER_SSH_PASSWORD}"
: "${IMAGE_NAMESPACE:?缺少 IMAGE_NAMESPACE}"
: "${IMAGE_TAG:?缺少 IMAGE_TAG}"

SERVER_PORT="${SERVER_PORT:-22}"
SERVER_DEPLOY_DIR="${SERVER_DEPLOY_DIR:-/opt/ai-pr-review-assistant}"

export SSHPASS="${SERVER_SSH_PASSWORD}"

sshpass -e ssh \
  -o PubkeyAuthentication=no \
  -o PreferredAuthentications=password \
  -o KbdInteractiveAuthentication=no \
  -o NumberOfPasswordPrompts=1 \
  -o StrictHostKeyChecking=no \
  -p "${SERVER_PORT}" \
  "${SERVER_USER}@${SERVER_HOST}" \
  "SERVER_DEPLOY_DIR='${SERVER_DEPLOY_DIR}' IMAGE_NAMESPACE='${IMAGE_NAMESPACE}' IMAGE_TAG='${IMAGE_TAG}' GHCR_USERNAME='${GHCR_USERNAME:-}' GHCR_READ_TOKEN='${GHCR_READ_TOKEN:-}' bash -s" <<'REMOTE'
set -euo pipefail

DEPLOY_DIR="${SERVER_DEPLOY_DIR}"
ENV_FILE="${DEPLOY_DIR}/.env"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"

if [ ! -f "${ENV_FILE}" ]; then
  echo "缺少服务器环境文件: ${ENV_FILE}" >&2
  exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "缺少 docker compose 文件: ${COMPOSE_FILE}" >&2
  exit 1
fi

update_env_line() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${ENV_FILE}"
  fi
}

API_IMAGE="ghcr.io/${IMAGE_NAMESPACE}/ai-pr-review-api:${IMAGE_TAG}"
WORKER_IMAGE="ghcr.io/${IMAGE_NAMESPACE}/ai-pr-review-worker:${IMAGE_TAG}"
WEB_IMAGE="ghcr.io/${IMAGE_NAMESPACE}/ai-pr-review-web:${IMAGE_TAG}"
RULE_ENGINE_IMAGE="ghcr.io/${IMAGE_NAMESPACE}/ai-pr-review-rule-engine:${IMAGE_TAG}"

update_env_line "API_IMAGE" "${API_IMAGE}"
update_env_line "WORKER_IMAGE" "${WORKER_IMAGE}"
update_env_line "WEB_IMAGE" "${WEB_IMAGE}"
update_env_line "RULE_ENGINE_IMAGE" "${RULE_ENGINE_IMAGE}"

if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_READ_TOKEN:-}" ]; then
  printf '%s' "${GHCR_READ_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin >/dev/null
else
  echo "未提供 GHCR 读令牌，假设目标镜像已公开。"
fi

cd "${DEPLOY_DIR}"
docker compose pull api worker web rule-engine
docker compose up -d api worker web rule-engine

# 直接在服务器上做最小健康检查，避免工作流只看 compose 返回码。
docker compose ps
curl -fsS http://127.0.0.1:35001/api/health >/dev/null
REMOTE
