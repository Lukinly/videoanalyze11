#!/usr/bin/env bash
# Ubuntu Docker Engine only. Run on the deployment server, not Docker Desktop.
set -euo pipefail

if [[ "$(uname -s)" != Linux || "$EUID" -ne 0 ]]; then
  echo '请在 Ubuntu 服务器上使用 sudo bash scripts/disable-server-proxy.sh 执行。' >&2
  exit 1
fi
command -v python3 >/dev/null
command -v dockerd >/dev/null
command -v systemctl >/dev/null

# Proxy flags override environment settings and need editing in the original unit.
if systemctl show docker --property=ExecStart --value | grep -Eq -- '--(http|https)-proxy([=[:space:]]|$)'; then
  echo 'Docker ExecStart 含代理参数，请先从原 systemd 配置移除 --http-proxy / --https-proxy。尚未修改配置。' >&2
  exit 1
fi

server_user_home="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
server_client_config="${1:-$server_user_home/.docker/config.json}"
python3 - "$server_client_config" <<'PY'
import json, os, sys, tempfile, time
from pathlib import Path

paths = dict.fromkeys([
    Path('/etc/docker/daemon.json'),
    Path('/root/.docker/config.json'),
    Path(sys.argv[1]),
])
changes = []
for path in paths:
    if not path.exists():
        continue
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError(f'{path} must contain a JSON object')
    if 'proxies' in data:
        del data['proxies']
        changes.append((path, data))

# Parse all files before writing. Backups may contain registry credentials.
for path, data in changes:
    backup = path.with_name(path.name + '.before-direct-' + str(time.time_ns()))
    with open(backup, 'x', opener=lambda name, flags: os.open(name, flags, 0o600)) as file:
        file.write(path.read_text())
    stat = path.stat()
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as file:
            file.write(json.dumps(data, indent=2) + '\n')
            os.fchmod(file.fileno(), stat.st_mode & 0o777)
            os.fchown(file.fileno(), stat.st_uid, stat.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('已清除代理并备份原文件：', path)
PY

if [[ -f /etc/docker/daemon.json ]]; then
  dockerd --validate --config-file=/etc/docker/daemon.json
fi

install -d -m 755 /etc/systemd/system/docker.service.d
server_override=/etc/systemd/system/docker.service.d/zz-direct-network.conf
if [[ -f "$server_override" ]]; then
  cp -p "$server_override" "$server_override.before-direct-$(date +%s)-$$"
fi
cat > "$server_override" <<'EOF'
[Service]
UnsetEnvironment=HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY NO_PROXY http_proxy https_proxy all_proxy ftp_proxy no_proxy
EOF
chmod 644 "$server_override"
systemctl daemon-reload
systemctl restart docker
echo 'Docker 已重启并取消出站代理。请清空当前 shell 代理变量，然后重新创建生产容器。'
