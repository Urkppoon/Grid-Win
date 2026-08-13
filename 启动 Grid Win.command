#!/bin/zsh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}"
PORT="3002"
HOST="127.0.0.1"
URL="http://${HOST}:${PORT}/calculator"
API_URL="http://${HOST}:${PORT}/api/market/kline?stock_code=300408&k_type=m15&num=200"
RUNTIME_DIR="${PROJECT_DIR}/.grid-win"
PID_FILE="${RUNTIME_DIR}/grid-win.pid"
LOG_FILE="${RUNTIME_DIR}/grid-win.log"
BUILD_STAMP="${RUNTIME_DIR}/build-success"

mkdir -p "${RUNTIME_DIR}"
cd "${PROJECT_DIR}" || exit 1

echo "Grid Win 启动器"
echo "项目目录：${PROJECT_DIR}"
echo "访问地址：${URL}"
echo ""

listen_pid="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
needs_build="false"
if [[ ! -d "${PROJECT_DIR}/dist" || ! -f "${BUILD_STAMP}" ]]; then
  needs_build="true"
elif find app package.json package-lock.json vite.config.ts tsconfig.json postcss.config.mjs -type f -newer "${BUILD_STAMP}" -print -quit 2>/dev/null | /usr/bin/grep -q .; then
  needs_build="true"
fi

if [[ "${needs_build}" == "true" ]]; then
  echo "检测到项目更新，正在同步桌面版本..."
  if ! npm run build; then
    echo "构建失败，未启动旧版本。"
    echo ""
    read "?按回车关闭窗口..."
    exit 1
  fi
  touch "${BUILD_STAMP}"
  if [[ -n "${listen_pid}" ]]; then
    echo "正在重启旧服务..."
    kill "${listen_pid}" 2>/dev/null || true
    for attempt in {1..20}; do
      lsof -tiTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 0.2
    done
    listen_pid=""
  fi
fi

if [[ -n "${listen_pid}" ]]; then
  echo "3002 已有服务在运行，PID：${listen_pid}"
else
  echo "正在启动 Grid Win..."
  : > "${LOG_FILE}"
  PORT="${PORT}" nohup npm run start >> "${LOG_FILE}" 2>&1 &
  server_pid="$!"
  echo "${server_pid}" > "${PID_FILE}"
  echo "启动进程 PID：${server_pid}"
fi

echo "等待页面和行情接口就绪..."
ready="false"
for attempt in {1..30}; do
  page_code="$(curl -s -o /dev/null -w "%{http_code}" "${URL}" || true)"
  api_status="$(curl -s "${API_URL}" | /usr/bin/grep -o '"status":"success"' || true)"
  if [[ "${page_code}" == "200" && -n "${api_status}" ]]; then
    ready="true"
    break
  fi
  sleep 1
done

if [[ "${ready}" == "true" ]]; then
  echo "启动成功。正在打开浏览器..."
  open "${URL}"
else
  echo "启动未完成，请查看日志：${LOG_FILE}"
  echo ""
  tail -n 40 "${LOG_FILE}" 2>/dev/null || true
fi

echo ""
echo "这个窗口可以关闭；Grid Win 会继续在后台运行。"
read "?按回车关闭窗口..."
