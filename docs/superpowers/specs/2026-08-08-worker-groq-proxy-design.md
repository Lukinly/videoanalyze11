# Worker Groq 代理支持设计

日期：2026-08-08  
项目：videoanalyze  
范围：Docker Compose 中 Worker 到 Groq API 的出站网络

## 1. 背景与根因

视频上传、BullMQ 消费、FFmpeg 音频提取和音频分块已经正常。失败的分析任务均进入 `transcribing`，随后记录：

```text
provider request failed with status 403: {"error":{"message":"Forbidden"}}
```

证据表明同一项目 Groq key 和相同请求格式在宿主机代理链路上返回 HTTP 200；关闭 Node 环境代理后连接失败。当前 Worker 容器没有代理变量，并使用 Node 22 的原生 `fetch`，不会按本项目需要自动使用 WSL 代理。因此 Worker 采用失败的直连路径访问 Groq。

## 2. 目标

- 让 Worker 在 WSL 本地开发时通过显式代理访问 Groq。
- 保持 PostgreSQL、Redis 和 MinIO 走 Docker 内网，不经过代理。
- 生产环境未配置代理时继续直接访问 Groq。
- 不向日志、浏览器或仓库暴露 Groq key 或代理凭据。
- 保留现有 Groq multipart、模型和时间片段响应格式。

## 3. 非目标

- 不修改上传、HTTPS、MinIO 或 BullMQ 数据模型。
- 不增加 OpenAI ASR 回退。
- 不在本次改动中增加失败任务自动重试按钮。
- 不自动恢复已经处于 `failed` 的历史 run；修复部署后发起新的分析任务。

## 4. 方案选择

采用 Node 24 内置环境代理支持：

1. Worker 的构建阶段和运行阶段镜像都升级为 `node:24-bookworm-slim`。
2. Worker 容器设置 `NODE_USE_ENV_PROXY=1`。
3. Compose 把项目级变量映射为 Node 识别的标准变量：
   - `WORKER_HTTP_PROXY` → `HTTP_PROXY`
   - `WORKER_HTTPS_PROXY` → `HTTPS_PROXY`
   - `WORKER_NO_PROXY` → `NO_PROXY`
4. Worker 服务增加 `host.docker.internal:host-gateway` 映射，兼容 Docker Desktop 和 Linux Docker Engine。
5. 本地 `.env` 使用 `http://host.docker.internal:7897`；示例配置不硬编码个人代理地址。

未选择的方案：

- `undici ProxyAgent`：可继续使用 Node 22，但会增加运行依赖、类型转换和 provider 代码分支。
- Docker 全局代理：对宿主机环境耦合较强，无法从项目配置和测试中明确验证。

## 5. 配置设计

`.env.example` 增加：

```env
# Optional outbound proxy used only by the analysis worker.
WORKER_HTTP_PROXY=
WORKER_HTTPS_PROXY=
WORKER_NO_PROXY=postgres,redis,minio,localhost,127.0.0.1
```

本机 `.env` 配置：

```env
WORKER_HTTP_PROXY=http://host.docker.internal:7897
WORKER_HTTPS_PROXY=http://host.docker.internal:7897
WORKER_NO_PROXY=postgres,redis,minio,localhost,127.0.0.1
```

Compose 中只在 Worker 服务映射这些值。API、Web、MinIO、Redis 和 PostgreSQL 不继承 Worker 专用代理。

## 6. 请求数据流

```text
Worker
  ├─ PostgreSQL / Redis / MinIO → NO_PROXY → Docker 内网
  └─ https://api.groq.com       → HTTPS_PROXY → host.docker.internal:7897
```

Groq provider 仍执行现有流程：读取 FLAC 音频块、构造 multipart `FormData`、请求 `whisper-large-v3-turbo`、解析 `verbose_json` 中的 segment 时间片段。

## 7. 错误处理与安全

- Worker 未配置代理时允许直接连接，适用于可直连 Groq 的生产环境。
- 代理不可达时保留 provider 网络错误并将 run 标记为 `failed`。
- Groq 401/403/429 继续通过现有 `ProviderError` 分类保存；本次不改变重试语义。
- 日志和文档只报告代理是否配置，不输出含用户名、密码或 token 的完整代理 URL。
- `GROQ_API_KEY` 继续仅存在于服务端环境变量中。

## 8. 测试设计

### 自动测试

- 部署配置测试断言 Worker Dockerfile 的构建和运行阶段均使用 Node 24。
- 部署配置测试断言 Worker 设置 `NODE_USE_ENV_PROXY=1`。
- 部署配置测试断言三个 Worker 专用变量正确映射到标准代理变量。
- 部署配置测试断言 `NO_PROXY` 默认包含 `postgres`、`redis` 和 `minio`。
- 部署配置测试断言 `host.docker.internal:host-gateway` 存在。
- 运行全量 Vitest、ESLint、TypeScript、Compose 配置检查和 Worker 镜像构建。

### 本地运行验收

1. 重新构建并创建 Worker。
2. 检查 Worker 处于 `running`，且不输出任何密钥。
3. 使用 `test.mp4` 发起新的分析 run。
4. 确认状态依次经过 `probing`、`extracting_audio`、`transcribing`、`merging_transcript`、`completed`。
5. 确认至少一个 chunk 为 `completed`，并且 transcript segment 数量大于 0。

## 9. 部署步骤

```bash
cd /mnt/v/Vworkspace/videoanlast
sudo docker compose -f infra/docker-compose.yml up -d --build --force-recreate worker
sudo docker compose -f infra/docker-compose.yml logs --tail=100 worker
```

然后重新上传测试视频或运行完整验收脚本。现有 `failed` run 保持失败状态，避免静默篡改历史结果。

