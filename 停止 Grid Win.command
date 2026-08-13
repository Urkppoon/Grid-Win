#!/bin/zsh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}"
PORT="3002"
RUNTIME_DIR="${PROJECT_DIR}/.grid-win"
PID_FILE="${RUNTIME_DIR}/grid-win.pid"

echo "Grid Win 停止器"
echo ""

listen_pids="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
if [[ -z "${listen_pids}" ]]; then
  echo "3002 当前没有服务在运行。"
else
  echo "正在停止 3002 上的服务..."
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    kill "${pid}" 2>/dev/null || true
    echo "已发送停止信号：PID ${pid}"
  done <<< "${listen_pids}"
fi

rm -f "${PID_FILE}" 2>/dev/null || true

sleep 1
remaining="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
if [[ -z "${remaining}" ]]; then
  echo "Grid Win 已停止。"
else
  echo "仍有进程占用 3002："
  echo "${remaining}"
fi

echo ""
read "?按回车关闭窗口..."
