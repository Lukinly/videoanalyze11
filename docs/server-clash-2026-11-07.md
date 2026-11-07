# 服务器 Clash / Mihomo 部署记录

日期：2026-11-07（Asia/Shanghai）。服务器为 `ubuntu@124.222.173.229`。本记录不包含节点地址、密码、UUID、订阅令牌或控制器密钥。

## 安装和运行

参考用户提供的 [Linux Clash 教程](https://clash.guide/clash-for-linux.html)，采用 [Mihomo 官方 systemd 方式](https://wiki.metacubex.one/startup/service/)部署，未执行第三方一键安装脚本。服务器原有 `/usr/local/bin/clash` 为 2024 年的 v1.18.0，无对应运行服务；原二进制已备份。

| 项目 | 当前设置 |
| --- | --- |
| 内核 | [Mihomo v1.19.33](https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.33)，linux-amd64-v1 |
| 版本文件 | `/usr/local/lib/mihomo/mihomo-v1.19.33` |
| 命令入口 | `/usr/local/bin/mihomo`、`/usr/local/bin/clash`，均链接到版本文件 |
| 服务 | `/etc/systemd/system/clash.service`，别名 `mihomo.service` |
| 启动方式 | systemd enabled，非 root 的 `mihomo` 用户，故障自动重启 |
| 原始配置 | `/home/ubuntu/Workspace/config.yaml`，内容未改变，权限收紧为 0600 |
| 运行配置 | `/etc/mihomo/config.yaml`，root:mihomo，0640 |
| 状态和 GeoIP | `/var/lib/mihomo`，0750 |
| 备份目录 | `/var/backups/videoanalyze-clash/20261107-212734`，仅 root 可访问 |
| 本机 HTTP/SOCKS 入口 | `127.0.0.1:7890` |
| Docker HTTP/SOCKS 入口 | `172.17.0.1:7890`（Docker host-gateway） |
| 管理 API | `127.0.0.1:9090`，运行配置中保存随机密钥 |
| DNS 监听 | `127.0.0.1:1053` |
| 登录终端环境 | `/etc/profile.d/server-clash.sh` |

导入 34 个节点（7 个 Hysteria2、27 个 VMess）及原有策略组、分流规则。运行副本覆盖监听地址、控制器认证、日志级别和 IPv6 设置，保留规则模式及持久化节点选择。只监听回环和 Docker 网桥，不监听公网地址；没有启用 TUN，没有改变系统路由、系统 DNS、SSH 或 Caddy 入口。

内核和 Country.mmdb 从教程所用的 GitHub 下载加速入口取得，但**安装前均与 GitHub 官方 API 提供的 SHA-256 比对一致**：

```text
mihomo-linux-amd64-v1-v1.19.33.gz
8ec92e7b2fdc6b853ba00156bab7e4e965c8b0d843b8c4ac8ab98795f02ad524

MetaCubeX/meta-rules-dat country.mmdb（本次取得的 latest）
c0c6ea5661a3167abb24bbbaf629605aa3856c425384cbf2897c5a0f41027663
```

## 视频应用接入

代码提交 `c4a56d0` 已推送并在服务器拉取，Worker 已重建，API/Worker 已重新创建，其他容器及数据卷未变更。服务器 `.env.production` 设置：

```env
SERVER_OUTBOUND_PROXY=http://host.docker.internal:7890
```

生产 Compose 把该地址传给 API/Worker 的大小写代理变量，启用 Node 环境代理支持；Worker 入口同时映射大小写变量，兼容 Python、curl 和 FFmpeg。`host.docker.internal` 通过 host-gateway 映射到服务器，完全独立于个人电脑。

`NO_PROXY` 保持回环、PostgreSQL、Redis、Garage、B站、北京 Qwen 和 SMTP 域名直连。其他容器及 Docker 守护进程仍维持直连。显式空代理配置和已配置代理两种模式都通过实际 Compose 渲染检查。

## 实测

- `mihomo -t` 配置校验通过，34 个节点全部导入。
- systemd 为 active/running、enabled；代理入口仅绑定 `127.0.0.1` 和 `172.17.0.1`，控制器仅绑定回环且需要认证。
- 本机显式代理访问 Google、YouTube 的 `generate_204` 均返回 204，约 0.21 秒。
- 新登录 shell 自动使用代理，YouTube 返回 204；已有终端可执行 `source /etc/profile.d/server-clash.sh`。
- API 的 Node fetch、Worker 的 curl 访问 YouTube 均返回 204。
- API `/readyz` 为 200，database、redis、storage 均 ok。
- B站 `BV1oWPYzSEQK` 元数据读取成功，时长 1043 秒。
- Qwen 短音频协议验证通过，不创建分析任务或积分账目；该静音样本只验证接口协议，不证明识别质量。
- 12 项部署/入口验收测试与 Lint 通过；Compose 校验、空代理及启用代理两种模式的环境和内部直连检查通过。

### YouTube 视频读取仍有平台限制

公网连通与视频下载应分别验证。公开视频 `jNQXAC9IVRw` 的实际元数据读取返回 YouTube `Sign in to confirm you're not a bot`；美国、日本、新加坡三个已提供出口均出现该响应，已恢复原策略组选择，未使用或导入任何登录 Cookie。

现有镜像固定的 yt-dlp 2026.07.04 还提示版本超过 90 天且默认未启用 Node JS 运行时；诊断时显式添加 `--js-runtimes node` 后仍然遇到机器人确认。因此不能宣称 YouTube 视频分析已完整验收。后续如需继续处理，应单独验证下载器更新、运行时和平台要求的认证，不能再次把此错误归为“Clash 未连通”。参见 [yt-dlp EJS 官方说明](https://github.com/yt-dlp/yt-dlp/wiki/EJS)和 [YouTube 提取说明](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#youtube)。

网站公网的 ICP 备案入口拦截是另一个独立问题，此出站代理不改变网站备案接入状态。

## 常用操作

```bash
sudo systemctl status clash
sudo systemctl restart clash
sudo systemctl is-enabled clash

# 修改实际运行配置后，先校验再重载；不要输出含密钥的完整配置。
sudoedit /etc/mihomo/config.yaml
sudo -u mihomo /usr/local/bin/mihomo -t -d /var/lib/mihomo -f /etc/mihomo/config.yaml
sudo systemctl reload clash

# 原始 Workspace 文件是本次导入来源，后续编辑该文件不会自动覆盖运行副本。
curl --proxy http://127.0.0.1:7890 -fsS -o /dev/null -w '%{http_code}\n' https://www.youtube.com/generate_204
```

如需让应用停用代理，先清空 `.env.production` 中的 `SERVER_OUTBOUND_PROXY`，用现有 `dc` 命令重建 API/Worker 容器的配置；再停用 Clash，并按需移除登录 shell 的代理环境。不要直接执行会重启整个 Docker 的旧清理脚本。
