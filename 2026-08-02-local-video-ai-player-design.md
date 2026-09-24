# 本地视频智能解析播放器需求分析与技术方案

> 文档定位：本文件同时作为第一版产品边界、架构设计和验收基线。易变化的第三方 API 限制不作为架构前提，统一通过 provider adapter 的运行时配置和能力探测处理。
>
> 版本边界：P0 先验证“本地视频 → 转写 → 可点击跳转”的核心闭环；摘要、章节和搜索属于完整 MVP 的 P1 能力；复杂格式转码、多音轨和离线模型属于后续能力。

## 1. 项目概述

本项目是一个本地桌面程序。用户可以选择本地下载的视频文件，程序负责播放视频、提取音频、调用大模型 API 完成语音转文字和内容总结，并在视频旁边展示带时间戳的摘要、章节和转写内容。

用户点击任意摘要、章节或转写片段后，视频会自动跳转到对应时间点。

项目的核心价值是把长视频变成可检索、可跳转、可复盘的结构化知识内容。

## 2. 项目目标

### 2.1 核心目标

- 验证核心价值：用户导入一个可播放的本地视频后，可以得到带时间戳的 transcript，并从文字跳回原视频。
- 支持用户选择并播放本地视频文件。
- 自动从视频中提取音频。
- 接入 Groq 等大模型 API，完成音频转写。
- 根据转写内容生成结构化摘要和章节。
- 在视频旁边展示摘要、章节和完整转写。
- 支持点击时间戳跳转到视频对应位置。
- 支持本地 transcript 搜索，并从搜索结果跳转视频。
- 将处理结果保存在本地，避免重复处理。

### 2.2 非目标

第一版不追求以下能力：

- 在线视频网站下载。
- 多人协作。
- 云端视频存储。
- 复杂视频剪辑。
- 精细到逐字级别的字幕编辑。
- 完全离线的本地大模型总结。
- P0 不承诺所有容器和编码都能播放；MKV、HEVC、AC3/EAC3、AVI、FLV、WMV、TS 等兼容性处理按 P1 或后续版本规划。

这些能力可以作为后续版本扩展。

## 3. 目标用户

本项目适合以下用户：

- 经常下载课程、讲座、访谈、播客视频的人。
- 想快速浏览长视频重点的人。
- 需要从视频中提取笔记、字幕和摘要的人。
- 想根据摘要快速跳回原视频片段的人。
- 需要对会议录像、学习资料或知识型视频做复盘的人。

## 4. 核心使用场景

### 4.1 长视频快速理解

用户导入一个 1 小时课程视频，希望快速知道视频讲了什么。程序自动生成总摘要、章节和每章要点，用户可以先看摘要，再点击感兴趣的章节跳转观看。

### 4.2 视频笔记整理

用户导入访谈或会议录像，程序生成带时间戳的 transcript 和关键结论。用户可以复制摘要，也可以导出 Markdown 笔记。

### 4.3 内容回看定位

用户记得视频里提到某个主题，但不知道具体位置。用户搜索关键词后，程序展示相关转写片段，点击即可跳转到视频中的对应时间。

## 5. MVP 功能需求

### 5.1 本地视频选择

用户可以从本地文件系统选择视频文件。

第一版建议支持：

P0：

- `mp4`
- `mov`
- `webm`

以上格式仅承诺 Chromium/Electron 能直接播放的编码组合，默认以 H.264/AAC 作为测试基线。

P1：

- `mkv`
- 其他需要 remux 或重编码的容器

P1 对 MKV 等容器复用「试播 → remux → 验证 → 重编码」流程。AVI、FLV、WMV、TS 等其他容器先作为兼容性测试样本和后续候选，不计入 P0 验收。

推荐命令：

```bash
ffmpeg -i input.mkv -map 0:v:0 -map 0:a:0? -sn -dn -c copy output.mp4
```

如果 remux 失败，程序需要提示用户当前视频编码暂不支持直接播放，后续版本可提供完整转码。

remux 命令默认只选择第一条视频流和第一条可用音频流，并显式排除字幕流（`-sn`）和数据流（`-dn`）：MKV 常见的 ASS/SRT 字幕无法原样 mux 进 MP4，若使用 `-map 0` 全量映射，`-c copy` 模式下 MP4 muxer 会因字幕编码不兼容而直接报错，导致整个 remux 失败。后续支持用户手动选择音轨时，再把 `0:a:0?` 替换为用户选择的音轨。

需要注意：remux 只改变容器，不改变视频和音频编码。如果 MKV 内部是 Chromium/Electron 不支持的 H.265/HEVC、AC3 或 EAC3 等编码，即使 remux 成 MP4，HTML video 仍可能无法播放。MVP 的处理顺序建议为：

1. 原文件直接试播。
2. 对 MKV 等容器不稳定格式执行无损 remux。
3. remux 后通过播放器事件验证是否能真正播放。
4. 如果仍无法播放，提示用户编码不兼容，并预留 H.264/AAC 重编码路径。

重编码兜底命令：

```bash
ffmpeg -i input.mkv -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k output.compat.mp4
```

重编码会消耗较长时间和更多磁盘空间，因此 P1 可以作为用户确认后的兜底能力；重编码结果需要缓存到应用数据目录，避免重复处理。

### 5.2 视频播放

播放器需要支持：

- 播放和暂停。
- 拖动进度。
- 音量控制。
- 倍速播放。
- 全屏播放。
- 根据摘要或转写时间戳跳转。

时间跳转通过前端播放器 API 实现。默认行为是定位并保持当前播放/暂停状态；是否在定位后自动播放由用户设置控制，不能因为一次点击强制改变用户的播放状态。

```js
video.currentTime = start
// 可选：仅当用户启用了“跳转后自动播放”时调用 video.play()
```

### 5.3 音频提取

程序使用本地 `ffmpeg` 从视频中抽取音频，并转为适合语音识别的格式。

推荐输出格式：

- 采样率：16 kHz
- 声道：mono
- 编码：FLAC 或 WAV

示例命令：

```bash
ffmpeg -i input.mp4 -ar 16000 -ac 1 -map 0:a:0 -c:a flac output.flac
```

`-map 0:a:0` 显式选取第一条可用音轨，与 5.5 节「MVP 默认选择第一条音轨」保持一致；若使用 `-map 0:a` 映射全部音轨，多音轨视频下 FLAC muxer 行为不确定。

### 5.4 音频切片

为了处理长视频和 API 文件大小限制，程序需要支持自动切片。

推荐策略：

- 初始按 5 到 10 分钟切片。
- 相邻分片保留 5 到 10 秒重叠，降低边界处漏字风险。
- 先生成确定性的 chunk manifest，记录每片的原始时间范围、重叠范围、文件格式和生成参数；重试时复用 manifest，不重新计算边界。
- 切片后检查编码后的文件大小。
- 单个上传文件应低于 provider adapter 返回的当前上传限制，并预留安全余量；限制不能写死在核心任务逻辑中。
- 若某个切片超过限制，继续二分切分，直到每片大小合规。
- 每段单独调用 ASR API。
- 转写完成后，将每段内部时间戳加上该分片的起始偏移。
- 合并时需要对重叠区做去重，避免同一句话在两个分片中重复出现。
- 合并优先依据分片时间范围裁剪重叠区，再用归一化文本相似度辅助去重；n-gram 最长匹配只作为辅助策略。匹配不可靠时记录 `mergeWarning`，禁止静默删除可能有意义的文本。
- 单片转写可携带 `prompt` 参数传入上一片尾部文本，降低跨片上下文与语言识别断裂（详见 8.4）。
- 最终合并为完整 transcript，并在边界去重不确定时记录 `mergeWarning`。

上传限制、请求速率、最短计费长度和模型能力由 provider adapter 在运行时提供。实现时应以实际账户和官方文档为准，并将上传目标大小、并发度和重试策略配置化。桌面端不把本地音频暴露成公网 URL，P0 只使用直接上传和本地切片路线。

### 5.5 语音转文字

第一版使用 Groq Speech-to-Text。

推荐配置：

- 模型：`whisper-large-v3-turbo`
- 返回格式：`verbose_json`
- 时间戳粒度：优先使用 `segment`
- API 参数名：`timestamp_granularities[]`
- 语言：默认自动识别时不传 `language` 参数；用户手动指定时再传 ISO-639-1 语言码，例如 `zh` 或 `en`

转写结果需要至少包含：

- 片段 ID
- 起始时间
- 结束时间
- 文本内容

如果源视频包含多条音轨，MVP 默认选择第一条可用音轨进行转写，并在处理前记录音轨信息。后续版本可在 UI 中允许用户手动选择音轨。

### 5.6 智能摘要（P1）

程序将 transcript 发送给 LLM，生成结构化摘要。该请求会把 transcript 文本发送给第三方 LLM 服务，隐私提示需要覆盖这一阶段（见 6.2）。

摘要结果需要包含：

- 一句话总结。
- 视频整体摘要。
- 章节列表。
- 每章起止时间。
- 每章标题。
- 每章摘要。
- 每章关键要点。
- 每章引用的 `sourceSegmentIds`；章节时间由程序根据这些片段计算，不接受 LLM 直接生成的时间作为唯一事实来源。
- 章节数量应设上限（默认不超过 15 个，可按视频时长线性约束），避免超长视频生成过多章节挤爆输出 token 预算。

后续可以扩展：

- 行动项。
- 术语解释。
- 问题列表。
- 适合导出的学习笔记。

### 5.7 时间戳交互

章节、带来源的关键要点、转写片段和搜索结果需要绑定时间戳。整体摘要和一句话总结本身没有天然的唯一时间点，不强制提供跳转。

用户点击以下元素时，视频跳转到对应时间：

- 章节标题。
- 带 `sourceSegmentIds` 的摘要或关键要点。
- transcript 片段。
- 搜索结果。

### 5.8 本地缓存

同一个视频处理完成后，结果需要保存在本地。

缓存内容包括：

- 视频文件路径。
- 视频文件指纹。
- 视频时长。
- 音频缓存路径。
- 转写结果。
- 摘要结果。
- 处理状态。
- 当前分析运行的 ID 和配置指纹。
- 创建时间和更新时间。

缓存必须按“视频指纹 + 音频处理配置 + ASR provider/model/language + 摘要 provider/model + prompt/schema 版本”区分。程序再次打开同一个视频时，优先读取与当前配置匹配的已完成 `analysisRun`；旧结果仍可保留并由用户切换或删除。

### 5.9 本地搜索（P1）

MVP 需要支持基于 transcript 的本地关键词搜索。

搜索范围：

- transcript 片段文本。
- 章节标题。
- 章节摘要。
- 关键要点。

搜索结果需要展示命中的文本、所属时间戳和来源类型。用户点击搜索结果后，视频跳转到对应片段起始时间。

## 6. 非功能需求

### 6.1 性能

- 以 1 小时、H.264/AAC、单音轨视频作为基准样本，处理流程必须可完成或给出可恢复的明确失败状态；“稳定”需要通过第 15 节的故障注入和打包测试验证。
- 长视频必须切片，避免单次上传失败。
- 前端需要展示处理进度；进度事件经节流后通过 IPC 回传，避免高频事件打满 IPC（见 7.4）。
- 已完成的分片不应重复转写。
- 转写分片允许小并发执行，默认并发度由 provider adapter 和用户配置共同决定；连续收到 429 时降低并发度，并优先尊重服务端返回的等待时间。
- 进度以已完成分片数、当前阶段和可选的媒体处理百分比组成，不把不可预测的 LLM 处理时间伪装成精确百分比。

### 6.2 隐私

- 视频文件默认不上传。
- ASR 阶段只上传抽取后的音频片段到 Groq。
- 摘要阶段会额外把 transcript 文本发送给 Groq Chat API 用于生成摘要和章节。
- UI 需要明确提示用户：音频内容会发送给第三方 ASR 服务，转写文本会发送给第三方 LLM 服务。
- 用户可以在摘要阶段选择跳过第三方 LLM；音频分片和临时文件需要在任务完成或取消后按保留策略清理。
- 后续版本支持本地离线转写模式。

### 6.3 可靠性

- API 调用失败时需要自动重试。
- 处理中断后可以恢复。
- 每个音频分片转写完成后应立即写盘，并更新任务状态。
- 分片转写和摘要写入必须幂等；任务恢复时，已确认成功的分片不得重复请求。
- 应用异常退出后，启动时将超时的 `running` 任务标记为可恢复，而不是永久停留在处理中。
- 视频无音轨时需要给出明确错误。
- 视频格式不支持时需要给出明确错误。
- 网络不可用或 API key 无效时需要给出明确错误。

### 6.4 可扩展性

系统需要允许替换：

- ASR 服务商。
- LLM 服务商。
- 本地存储实现。
- 视频播放实现。

provider 接口必须使用领域模型，不把 Groq 的字段名、HTTP 错误码和模型限制泄漏到任务编排层。

## 7. 推荐技术方案

### 7.1 技术选型

第一版推荐：

- 桌面框架：Electron
- 前端框架：React + TypeScript
- 样式方案：Tailwind CSS 或普通 CSS Modules
- 本地任务：Node.js worker
- 音视频处理：`ffmpeg-static` + `ffprobe-static`
- ASR：Groq Whisper API
- 总结：Groq Chat API
- 本地数据库：SQLite，推荐 `better-sqlite3`
- 文件缓存：应用数据目录
- API key 存储：Electron `safeStorage`

推荐 Electron 的原因：

- 文件系统访问和本地进程调用简单。
- 调用 `ffmpeg` 成本低。
- HTML video 足以完成第一版播放器。
- React 生态成熟，适合快速做 MVP。
- 调试和打包路径清晰。

备选方案是 Tauri。Tauri 安装包更小，原生体验更好，但 Rust/native bridge 的开发复杂度更高。MVP 阶段优先选择 Electron 更稳。

`better-sqlite3` 是原生 Node 模块，Electron 开发和打包阶段需要执行 ABI rebuild。项目脚手架应预留 `@electron/rebuild` 或构建工具等价配置，并在 CI 或打包脚本中验证数据库模块能在目标 Electron 版本下加载。

`ffmpeg-static` 通常只提供 `ffmpeg` 可执行文件。由于本方案需要使用 `ffprobe` 读取媒体元数据，项目需要显式引入 `ffprobe-static`，并在打包配置中同时处理两个二进制文件的可执行权限和 asar 解包路径。

### 7.2 系统分层

系统分为五层：

1. UI 层
   负责文件选择、视频播放、任务进度、摘要展示、转写展示、搜索和点击跳转。

2. 本地任务层
   负责任务编排，包括抽音频、切片、转写、合并、总结和缓存。

3. 媒体处理层
   封装 `ffmpeg`，处理音频提取、音频压缩和音频切片。

4. AI 服务层
   封装 Groq API，提供转写和总结能力。

5. 数据存储层
   保存视频记录、任务状态、转写结果、摘要结果和用户配置。

### 7.3 数据流

```text
本地视频文件
  -> 判断播放兼容性
  -> (P1) 必要时 remux 为 MP4
  -> HTML video 播放
  -> ffmpeg 抽取音频
  -> 音频切片
  -> Groq Whisper 转写
  -> 合并 transcript
  -> LLM 生成摘要和章节
  -> 本地保存
  -> UI 展示
  -> 点击时间戳跳转视频
```

### 7.4 Electron 进程与 IPC 设计

Electron 采用主进程、preload、renderer 和后台 worker 分层。

主进程职责：

- 创建窗口、注册自定义本地媒体 protocol。
- 打开文件选择对话框。
- 管理应用数据目录和缓存目录。
- 启动、取消和恢复后台处理任务。
- 持有 `safeStorage`、SQLite、文件系统和 `ffmpeg` 能力。

renderer 职责：

- 展示播放器和分析结果。
- 发起用户操作，例如选择文件、开始解析、取消任务、搜索和跳转。
- 不直接访问任意本地文件路径、数据库、API key 或子进程。

preload 职责：

- 在 `contextIsolation: true` 下通过 `contextBridge` 暴露最小 API。
- 对 renderer 入参做基本结构校验。
- 只暴露明确命名的能力，例如 `selectVideo`、`startAnalysis`、`getVideoState`、`searchTranscript`、`revealCache`。

后台任务职责：

- 任务编排建议放在主进程创建的 `worker_threads` 中，避免阻塞窗口和 IPC 响应。
- `ffmpeg` 本身通过子进程执行，由 worker 负责编排进度、退出码、日志和取消信号。
- ASR/LLM 网络请求可以在 worker 中执行；API key 解密由主进程完成后以短生命周期内存值传入 worker，不写入日志。

IPC 通道建议：

- renderer -> main：`video:select`、`analysis:start`、`analysis:cancel`、`analysis:resume`、`search:query`、`settings:update`。
- main -> renderer：`analysis:progress`、`analysis:stageChanged`、`analysis:error`、`analysis:completed`。
- 所有 IPC payload 使用 TypeScript schema 或运行时校验库校验，避免 renderer 传入任意路径导致越权访问。
- 主进程向 renderer 回传进度事件时需按时间或事件量节流（例如每 100 ms 聚合一次或按分片粒度上报），避免高频进度通知打满 IPC。
- 数据库采用单一写入者原则：要么由主进程统一写入，要么由独立 storage worker 统一写入；禁止主进程和多个 worker 并发修改同一任务状态。
- Electron 安全基线至少包括 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、CSP、禁止 renderer 任意导航和禁止未经授权的 `window.open`。

## 8. 核心模块设计

### 8.1 Video Library 模块

职责：

- 选择视频文件。
- 读取视频元数据。
- 计算视频文件指纹。
- 判断是否已有缓存。
- 管理视频记录。

大视频不应在 UI 线程中计算全量加密 hash。MVP 推荐使用快速文件指纹：

- 文件路径。
- 文件名。
- 文件大小。
- 修改时间。
- 前 4 MB 和后 4 MB 的快速 hash。

指纹算法需要带版本号。视频被移动或重命名后，应允许用户通过指纹重新关联文件；文件不存在时标记为 `missing`，不能直接删除历史 transcript。

后续如果需要强一致性去重，再增加全量 hash 选项。

### 8.2 Player 模块

职责：

- 加载本地视频。
- 播放控制。
- 当前时间同步。
- 根据外部输入跳转。
- 高亮当前对应 transcript 片段。

### 8.3 Media Processor 模块

职责：

- 检查 `ffmpeg` 是否可用。
- 通过 `ffprobe` 读取容器、视频编码、音频编码、时长和音轨信息。
- 检测多音轨并返回可用音轨列表；MVP 默认选择第一条音轨，后续支持用户选择。
- 对 MKV 等浏览器不稳定支持、无法直接播放的容器执行 remux。
- 对 remux 后仍无法播放的视频执行可选 H.264/AAC 重编码。
- 抽取音频。
- 压缩音频。
- 切分音频。
- 校验切片文件大小。
- 返回分片文件列表、文件大小和时间偏移。

播放兼容性不能只看 `ffmpeg` 是否执行成功。Media Processor 需要返回 `playbackCandidate`，Player 模块需要通过 `loadedmetadata`、`canplay` 或首帧 seek/play 验证播放闭环；建议额外 seek 到接近末尾确认末尾解码，因为 AC3、HEVC 等编码错误常在解码中后段才暴露，首帧 play 不一定触发。验证失败时再进入重编码或错误提示。

### 8.4 Transcription 模块

职责：

- 调用 Groq Speech-to-Text。
- 支持分片转写。
- 控制转写并发。
- 处理指数退避重试。
- 每片转写成功后立即写盘。
- 单片请求可携带 `prompt` 参数传入上一片尾部文本，保持跨片上下文与语言识别连贯；具体长度由 provider adapter 按当前模型能力截断。
- 合并分片 transcript。
- 修正时间戳偏移。
- 对相邻分片重叠区做去重合并，并记录边界合并警告。
- 重叠区先按 manifest 的时间范围裁剪，再用文本归一化和相似度判断重复；n-gram 最长匹配作为辅助。低于阈值时记录 `mergeWarning` 并保守保留内容。

单片重试次数、退避时间和并发度由 provider adapter 返回的能力及配置决定。429、5xx、网络超时可重试；401/403、参数错误和明确的文件格式错误应立即失败并给出可行动提示。连续收到 429 时降低整体并发度，并记录服务端响应信息但不写入 API key 或敏感内容。

### 8.5 Summary 模块

职责：

- 将 transcript 转为适合 LLM 的输入。
- 控制 token 长度，限制章节数量。
- 生成总摘要、章节和要点。
- 校验 LLM 输出 JSON。
- 根据 `sourceSegmentIds` 计算章节时间戳。

摘要策略：

- 摘要 provider 需要在启动或设置页做能力校验；调用时优先使用结构化输出，仍必须通过运行时 schema 校验。
- 摘要前先估算 transcript token 数，优先按模型上下文窗口判断是否可以单次摘要，不单纯按视频时长判断。
- 当 transcript 输入 token 超过模型上下文安全阈值时，使用 map-reduce：先按 10 到 20 分钟窗口生成局部摘要，再基于局部摘要生成全局摘要和章节。
- 单次摘要输入 token 预算建议控制在所选模型上下文窗口的 60% 以内，保留至少 25% 给输出和修正重试。
- prompt 需要明确章节数量上限（默认不超过 15 个），避免超长视频生成过多章节挤爆输出 token 预算。
- 局部摘要窗口按 transcript segment 边界切分，不在 segment 中间截断；相邻窗口可以保留 30 到 60 秒重叠内容，以减少章节跨窗口断裂。
- map-reduce 模式下，各局部窗口生成的章节可能存在重复或冲突，需要在全局阶段做合并去重、排序后再进行时间戳对齐。
- LLM 只返回章节及要点引用的 `sourceSegmentIds`，不直接返回可信时间。程序根据片段的最小 start 和最大 end 计算时间，再校验引用存在、章节单调、不重叠和不超出视频时长。
- 如果引用不存在、章节跨度异常或章节之间发生重叠，记录 `alignmentWarning`，并使用确定性的后处理规则修正；不能静默接受模型幻觉时间。

### 8.6 Storage 模块

职责：

- 保存视频记录。
- 保存任务状态。
- 保存 transcript。
- 保存 summary。
- 保存分片级转写结果。
- 读取历史结果。

分片级结果需要在每片转写完成后立即写入磁盘。任务恢复时，程序读取当前 `analysisRun` 的已完成分片列表，只重新处理缺失或失败的分片。

SQLite 负责索引和状态，完整 transcript 与 summary 仍可以保存为 JSON 文件，避免单行 JSON 过大。`transcript_segments` 和 `chapters` 表是当前分析运行的唯一查询数据源，JSON 文件仅作为原始结果与导出缓存；读取时以数据库为准，可从表重建 JSON。

`analysisRun` 是缓存和恢复的边界。它必须记录输入指纹、配置哈希、provider/model、prompt/schema 版本和状态；同一个视频可以存在多个运行，但 UI 默认只展示当前选中的成功运行。

MVP 搜索建议使用 SQLite FTS5，并以 `trigram` 分词器建立中文可用的子串索引（见 9.8）；trigram 查询要求至少 3 个字符，1 到 2 字符的短查询降级到 `LIKE` 搜索。若目标环境的 SQLite 构建不支持 FTS5 或 trigram，则整体降级到普通 `LIKE` 搜索，并在设置或日志中标记搜索能力降级。

### 8.7 Settings 模块

职责：

- 保存 Groq API key。
- 配置模型名称。
- 配置默认语言。
- 配置缓存目录。
- 配置是否自动转写。
- 配置网络代理。

Groq API key 通过 Electron `safeStorage` 保存，不写入普通 JSON 配置文件。注意：Linux 上如果没有可用的系统钥匙串（gnome-keyring / kwallet，WSL2 常见），`safeStorage` 可能回退到 `basic_text`；这不是等价的安全加密。应用应检测保护级别，在设置页明确提示，并允许用户选择不持久化 key。

网络设置需要允许用户配置 HTTPS 代理或继承系统代理，并提供连接测试。面向可能无法直连 Groq 的网络环境时，错误提示应区分 DNS/连接超时、代理认证失败、API key 无效和 API 限流。

## 9. 数据结构设计

### 9.1 视频记录

```json
{
  "id": "video_001",
  "filePath": "/Users/me/videos/demo.mp4",
  "fileFingerprint": "abc123",
  "fingerprintVersion": 1,
  "fileName": "demo.mp4",
  "fileSize": 2147483648,
  "modifiedAt": "2026-08-02T09:00:00Z",
  "duration": 3600,
  "status": "available",
  "currentAnalysisRunId": "run_001",
  "playbackPath": ".../playback.mp4",
  "createdAt": "2026-08-02T10:00:00Z",
  "updatedAt": "2026-08-02T10:30:00Z"
}
```

### 9.2 转写片段

```json
{
  "id": "seg_001",
  "runId": "run_001",
  "start": 12.4,
  "end": 28.9,
  "text": "这里是视频中的一段讲话内容。"
}
```

### 9.3 摘要章节

```json
{
  "id": "chapter_001",
  "title": "项目背景介绍",
  "sourceSegmentIds": ["seg_001", "seg_002"],
  "start": 12.4,
  "end": 180.0,
  "summary": "这一章介绍了项目的背景、问题和目标。",
  "bullets": [
    {
      "text": "当前处理长视频效率低",
      "sourceSegmentIds": ["seg_001"]
    },
    {
      "text": "用户希望快速定位关键内容",
      "sourceSegmentIds": ["seg_002"]
    }
  ]
}
```

`start` 和 `end` 是程序根据 `sourceSegmentIds` 计算出的派生字段，不由 LLM 直接决定。

### 9.4 分析运行

```json
{
  "id": "run_001",
  "videoId": "video_001",
  "fileFingerprint": "abc123",
  "configHash": "cfg_456",
  "asrProvider": "groq",
  "asrModel": "whisper-large-v3-turbo",
  "llmProvider": "groq",
  "llmModel": "configured-model",
  "language": null,
  "promptVersion": 1,
  "schemaVersion": 1,
  "audioPath": ".../audio.flac",
  "transcriptPath": ".../transcript.json",
  "summaryPath": ".../summary.json",
  "stage": "transcribing",
  "status": "running",
  "progress": 0.65,
  "heartbeatAt": "2026-08-02T10:20:00Z",
  "error": null,
  "createdAt": "2026-08-02T10:00:00Z",
  "updatedAt": "2026-08-02T10:20:00Z"
}
```

### 9.5 处理任务

```json
{
  "id": "job_001",
  "videoId": "video_001",
  "runId": "run_001",
  "stage": "transcribing",
  "status": "running",
  "progress": 0.65,
  "error": null,
  "createdAt": "2026-08-02T10:00:00Z",
  "updatedAt": "2026-08-02T10:20:00Z"
}
```

### 9.6 音频分片

```json
{
  "id": "chunk_001",
  "videoId": "video_001",
  "runId": "run_001",
  "jobId": "job_001",
  "index": 1,
  "start": 0,
  "end": 600,
  "duration": 600,
  "filePath": ".../chunks/chunk_001.flac",
  "fileSize": 12582912,
  "status": "completed",
  "transcriptPath": ".../chunks/chunk_001.transcript.json",
  "retryCount": 0,
  "error": null
}
```

### 9.7 章节对齐结果

```json
{
  "chapterId": "chapter_001",
  "sourceSegmentIds": ["seg_001", "seg_002"],
  "alignedStart": 12.4,
  "alignedEnd": 180.0,
  "alignmentWarning": false
}
```

### 9.8 SQLite 表结构

MVP 推荐表结构：

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_fingerprint TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  duration REAL,
  status TEXT NOT NULL,
  fingerprint_version INTEGER NOT NULL DEFAULT 1,
  playback_path TEXT,
  current_analysis_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('available', 'missing', 'error')),
  FOREIGN KEY (current_analysis_run_id) REFERENCES analysis_runs(id)
);

CREATE TABLE analysis_runs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  file_fingerprint TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  asr_provider TEXT NOT NULL,
  asr_model TEXT NOT NULL,
  llm_provider TEXT,
  llm_model TEXT,
  language TEXT,
  prompt_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  audio_path TEXT,
  transcript_path TEXT,
  summary_path TEXT,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  heartbeat_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  CHECK (progress >= 0 AND progress <= 1),
  CHECK (status IN ('queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed'))
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  progress REAL NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
  CHECK (progress >= 0 AND progress <= 1)
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start REAL NOT NULL,
  end REAL NOT NULL,
  duration REAL NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT NOT NULL,
  transcript_path TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE (run_id, chunk_index),
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped'))
);

CREATE TABLE transcript_segments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  start REAL NOT NULL,
  end REAL NOT NULL,
  text TEXT NOT NULL,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start REAL NOT NULL,
  end REAL NOT NULL,
  summary TEXT NOT NULL,
  bullets_json TEXT NOT NULL,
  source_segment_ids_json TEXT,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_video_id ON jobs(video_id);
CREATE INDEX idx_runs_video_id_status ON analysis_runs(video_id, status);
CREATE INDEX idx_chunks_run_index ON chunks(run_id, chunk_index);
CREATE INDEX idx_segments_run_time ON transcript_segments(run_id, start);
CREATE INDEX idx_chapters_run_time ON chapters(run_id, start);
```

搜索索引：

```sql
CREATE VIRTUAL TABLE transcript_search
USING fts5(run_id UNINDEXED, source_type, source_id, text, tokenize = 'trigram');
```

`transcript_search` 写入当前 `analysisRun` 的 transcript 文本、章节标题、章节摘要和关键要点。搜索结果通过 `run_id`、`source_type` 和 `source_id` 回查对应时间戳。

使用 `trigram` 分词器是为了支持中文子串匹配：FTS5 默认的 `unicode61` 分词器不做中文分词，会把整段中文当成一个 token，导致「人工智能」无法命中包含「今天我们学习人工智能」的句子。`trigram` 将文本切分为 3 字符滑动片段，可覆盖中英文子串查询，但要求查询长度至少 3 个字符；1 到 2 字符的短查询应降级到 `LIKE`。主流 `better-sqlite3` 版本通常包含 FTS5，但目标平台和打包组合下仍需在启动时执行能力探测：尝试创建临时 FTS5 trigram 表并执行一次查询；探测失败则降级到 `LIKE`。

FTS 索引需要由应用层在 transcript 或 chapter 写入成功后同步更新。重新解析同一视频时，应先删除该 `run_id` 对应的旧 FTS 记录，再写入新记录，避免搜索结果指向过期片段。

## 10. 页面设计

### 10.1 主页面布局

主页面采用左右布局。

左侧：

- 视频播放器。
- 视频文件名。
- 当前播放时间。
- 解析状态。
- 解析按钮。
- 重新解析按钮。

右侧：

- 智能摘要。
- 章节列表。
- 完整转写。
- 搜索结果。

### 10.2 右侧信息区

右侧使用 Tab 组织：

- 摘要：展示整体摘要和关键结论。
- 章节：展示可点击的章节卡片。
- 转写：展示完整 transcript。长视频下 segment 可达数千条，应使用虚拟滚动（如 react-window）渲染，避免一次性渲染大量 DOM 导致卡顿；章节和搜索结果也建议做数量上限或分页。
- 搜索：根据关键词定位 transcript 片段。

### 10.3 任务状态

处理过程需要展示：

- 等待处理。
- 提取音频中。
- 切片中。
- 转写中。
- 合并转写中。
- 生成摘要中。
- 已完成。
- 失败。

### 10.4 文字线框图

主页面第一版交互结构：

```text
┌───────────────────────────────┬──────────────────────────────┐
│ 视频区域                       │ 摘要 | 章节 | 转写 | 搜索     │
│                               │                              │
│ ┌───────────────────────────┐ │ 当前 Tab 内容                 │
│ │ HTML video                 │ │ - 摘要：整体摘要、关键结论    │
│ │                           │ │ - 章节：章节标题、时间、要点  │
│ └───────────────────────────┘ │ - 转写：segment 列表          │
│ 文件名 / 当前时间 / 状态       │ - 搜索：输入框、命中片段      │
│ 选择视频 / 开始解析 / 取消     │                              │
└───────────────────────────────┴──────────────────────────────┘
```

移动端或窄窗口可以改为上下布局：上方播放器固定显示，下方信息区使用 Tab。

## 11. API 设计

### 11.1 转写服务接口

输入：

```json
{
  "audioPath": ".../chunk_001.flac",
  "response_format": "verbose_json",
  "timestamp_granularities": ["segment"]
}
```

封装层可以使用 camelCase，但调用 Groq API 时必须映射为官方参数名 `response_format` 和 `timestamp_granularities[]`。默认自动识别语言时不传 `language` 参数；只有用户手动指定语言时才传 ISO-639-1 语言码。

上述字段仅属于 Groq adapter 的映射示例。任务层只依赖统一接口，例如 `transcribeChunk({ audioFile, language, timestampLevel })`，不能直接依赖 provider 的字段名。

输出：

```json
{
  "segments": [
    {
      "start": 0,
      "end": 12.5,
      "text": "..."
    }
  ]
}
```

### 11.2 摘要服务接口

输入：

```json
{
  "videoDuration": 3600,
  "segments": [
    {
      "id": "seg_001",
      "start": 0,
      "end": 15,
      "text": "..."
    }
  ]
}
```

输出：

```json
{
  "oneLineSummary": "...",
  "overallSummary": "...",
  "chapters": [
    {
      "title": "...",
      "sourceSegmentIds": ["seg_001", "seg_002"],
      "summary": "...",
      "bullets": [
        {
          "text": "...",
          "sourceSegmentIds": ["seg_001"]
        }
      ]
    }
  ]
}
```

LLM 输出的章节和要点必须引用输入 transcript 的 `segmentId`。程序根据引用片段计算 `start`、`end`，并在写入数据库前执行 schema、引用存在性、单调性和范围校验。

## 12. 错误处理

### 12.1 视频无音轨

提示用户该视频没有可解析音轨，仅支持播放，不支持转写。

### 12.2 视频格式不支持

如果 HTML video 无法播放，程序应先尝试无损 remux（对 MKV 等容器需显式跳过字幕流，见 5.1）。remux 后需要用播放器事件或首帧解码结果验证是否真的可播放，验证时建议额外 seek 到接近末尾确认末尾解码，因为 AC3、HEVC 等编码错误常在解码中后段才暴露。remux 成功但仍无法播放时，说明问题大概率来自编码而不是容器；此时提示用户当前视频编码暂不支持，并提供可选 H.264/AAC 重编码入口或后续集成更强播放器。该流程同样适用于 AVI、FLV、WMV、TS 等其他无法直接播放的容器。

### 12.3 ffmpeg 不可用

提示用户安装 `ffmpeg`，或在应用内提供内置 `ffmpeg`。

MVP 建议使用 `ffmpeg-static` 和 `ffprobe-static` 随应用打包 `ffmpeg` 与 `ffprobe`，减少用户配置成本。Electron 打包时需要确保二进制文件不被打进无法执行的 asar 内，构建配置需要使用 `asarUnpack` 或等价机制处理。

### 12.4 API key 无效

提示用户检查 Groq API key。

### 12.5 网络失败

提供重试入口。已完成的分片保留，重试时只处理失败分片。

自动重试策略：

- 429、5xx、网络超时按 provider 返回的可重试标记处理。
- 重试次数、退避上限和并发降级策略由 provider adapter 与用户配置共同决定。
- 429 优先尊重服务端返回的等待时间；没有等待时间时才使用本地退避策略。
- 401/403、参数错误和明确的文件格式错误不自动重试。
- 重试失败后，将该分片状态标记为 `failed`。
- 用户手动重试时，只处理 `failed` 或缺失 transcript 的分片。

### 12.6 LLM 输出格式错误

程序需要使用运行时 schema 校验结构化输出。如果解析失败、引用不存在或章节数量超限，应自动重试一次；重试仍失败则将摘要阶段标记为 `failed`，但保留可用的 transcript，不影响视频播放和文字跳转。transcript 必须作为不可信内容放入 prompt，模型不能把视频中的指令当成系统指令。

## 13. 安全与隐私

- API key 使用 Electron `safeStorage` 保存，不写入明文项目文件；检测到 `basic_text` 等弱保护级别时必须明确提示用户。
- 视频文件不上传到服务器。
- 转写阶段只上传音频分片；摘要阶段还会把 transcript 文本发送给 LLM 服务。
- 用户需要在设置页看到清晰说明：音频内容会发送给第三方 ASR 服务，转写文本会发送给第三方 LLM 服务。
- 缓存文件默认保存在应用数据目录。
- 用户可以清理单个视频缓存或全部缓存。
- Electron 必须启用 `contextIsolation: true`，关闭 renderer 的直接 Node.js 能力。
- BrowserWindow 必须启用 `nodeIntegration: false`、`sandbox: true` 和严格 CSP，并禁止 renderer 任意导航、弹窗和加载未授权远程资源。
- 本地视频加载建议使用自定义 protocol，例如 `app-media://`，由主进程映射到已授权的视频或缓存路径。
- 自定义 protocol 需要校验路径归属，禁止 `..`、符号链接逃逸和任意文件读取。
- 自定义 protocol 的实现需要支持 HTTP Range 请求（推荐在 handler 内用 `net.fetch(file://...)` 转发），否则大文件的拖动 seek 会失败或不稳定，直接影响时间戳跳转。
- `safeStorage` 在 Linux 无系统钥匙串时可能退化为弱保护存储，需要检测并在设置页提示当前保护级别（见 8.7）。
- IPC 不传递明文 API key，不把本地绝对路径暴露给不需要路径的 UI 组件。
- 缓存清理需要覆盖音频、分片、重编码视频、原始 provider 响应和 FTS 记录，并在删除失败时给出可诊断提示。

## 14. 开发阶段规划

### 14.1 V0：最小可用闭环

V0 的目标是验证核心价值：用户导入一个可直接播放的本地视频，程序完成可恢复的转写，点击 transcript 可以跳转。V0 不包含摘要、章节、FTS 搜索和复杂格式转码。

- 创建 Electron + React 项目。
- 配置 Electron 安全基线、preload API 和 IPC schema。
- 配置 `ffmpeg-static`、`ffprobe-static` 和 `better-sqlite3` 的 Electron ABI rebuild。
- 实现本地视频选择。
- 优先支持 Chromium/Electron 可直接播放的 `mp4`、`mov` 和 `webm`。
- 通过 `ffprobe` 读取时长、编码和音轨信息。
- 集成 `ffmpeg` 抽取第一条可用音轨。
- 实现按文件大小校验的音频切片，包含 5 到 10 秒重叠。
- 接入 Groq ASR。
- 合并 transcript，处理重叠区去重。
- 展示 transcript。
- 实现点击 transcript 跳转视频。
- 使用 `analysisRun` 保存视频指纹、配置版本、任务状态、分片结果和 transcript。
- 实现取消、异常退出后的恢复，以及已完成分片不重复提交。

### 14.2 V1：完整 MVP

V1 在 V0 基础上补齐格式兼容、摘要和搜索能力，达到第一版可交付状态。

- 实现 MKV remux 到 MP4。
- 验证 remux 后可播放，并预留 H.264/AAC 重编码兜底。
- 接入 LLM 摘要。
- 按 token 预算选择单次摘要或 map-reduce 摘要。
- 生成章节摘要，并通过 `sourceSegmentIds` 计算时间戳。
- 实现摘要和章节点击跳转。
- 实现 SQLite FTS5 本地搜索，并提供 `LIKE` 降级。
- 实现缓存清理。
- 完成基础打包验证。

### 14.3 V2：体验增强

- 当前播放片段高亮。
- 多视频历史记录。
- 多音轨手动选择。
- 导出 Markdown。
- 导出 SRT。
- 导出 JSON。
- 网络代理配置和连接测试。
- 可选 H.264/AAC 重编码入口。

### 14.4 V3：高级能力

- 本地 faster-whisper 离线转写。
- WhisperX 精准时间戳。
- 说话人识别。
- 多语言翻译。
- 自动生成学习笔记。
- 自动生成思维导图。
- 批量处理视频。

## 15. 验收标准

V0 完成时需要满足：

- 用户可以选择本地视频。
- 程序可以播放测试矩阵中 Chromium/Electron 直接支持的 `mp4`、`mov` 或 `webm` 视频；P0 以 H.264/AAC 单音轨为基线。
- 程序可以读取视频元数据和第一条可用音轨。
- 程序可以从视频中抽取音频。
- 程序可以按文件大小限制将长音频切片，并保留边界重叠。
- 程序可以调用 Groq 完成转写。
- 转写结果包含时间戳。
- 用户点击 transcript 后，视频可以跳转到对应时间。
- 每个完成分片会持久化到当前 `analysisRun`，重试时不会重复提交成功分片。
- 应用在分片处理期间强制退出并重新打开后，可以识别未完成任务并恢复或明确标记失败。
- 关闭程序后重新打开，已处理结果仍可查看。

V1 完成时需要满足：

- 程序可以对 MKV 等不稳定播放容器尝试 remux。
- remux 后如果编码仍不兼容，程序可以识别播放失败并给出重编码或不支持提示。
- 程序可以生成结构化摘要和章节。
- 用户点击章节或带来源的关键要点后，视频可以跳转到对应时间；整体摘要不强制绑定时间。
- 用户可以搜索 transcript，并从搜索结果跳转视频。
- 章节和关键要点通过 `sourceSegmentIds` 生成时间范围，不依赖 LLM 直接返回时间。
- 转写中断后重试时，已完成分片不会重复转写。
- API 失败、视频无音轨、格式不支持时有明确提示。

验收测试至少包含：无音轨视频、多音轨视频、接近上传限制的分片、429/5xx、断网、错误 API key、损坏视频、强制退出恢复、缓存删除和重新解析。每个测试都需要记录平台、Electron 版本、输入文件指纹、provider/model 和最终状态。

## 16. 主要风险与应对

### 16.1 大文件上传限制

风险：长视频音频文件可能超过 API 限制。

应对：音频压缩、按 provider adapter 返回的文件大小限制校验切片，并预留安全余量；具体数值放在 provider 配置和集成测试中，不写死在核心架构。

### 16.2 视频格式兼容问题

风险：部分本地下载视频格式无法被 HTML video 播放。无损 remux 只能解决容器兼容，不能解决 H.265/HEVC、AC3/EAC3 等编码兼容。

应对：第一版优先支持常见格式，对 MKV 等无法直接播放的容器优先尝试无损 remux（注意 `-sn` 跳过字幕流，避免 MP4 不支持的字幕编码导致 remux 失败）；remux 后必须验证播放闭环，并建议 seek 到接近末尾验证末尾解码。验证失败时提供 H.264/AAC 重编码兜底或提示用户当前编码不支持。重编码结果缓存到应用数据目录。

### 16.3 时间戳不够准确

风险：segment 时间戳可以用于跳转，但不适合逐字级字幕编辑。

应对：MVP 使用 segment 时间戳，后续可引入 word 时间戳或 WhisperX。

### 16.4 API 成本不可控

风险：重复处理长视频会产生额外 API 成本。

应对：本地缓存按视频指纹、配置哈希和模型版本复用；处理前显示预计分片数和可能产生的 API 请求数；用户主动重新解析时明确确认可能产生重复费用。

### 16.5 隐私顾虑

风险：用户可能不希望上传音频到第三方服务。

应对：明确提示上传范围，后续提供离线转写模式。

### 16.6 原生模块构建失败

风险：`better-sqlite3` 依赖原生二进制，Electron 版本变化后可能出现 ABI 不匹配。

应对：开发脚本和打包脚本固定执行 `@electron/rebuild` 或构建工具等价流程，并在启动时检测数据库模块加载失败，给出可诊断错误。

### 16.7 网络访问不稳定

风险：用户所在网络可能无法直连 Groq，导致转写和摘要请求失败。

应对：设置页提供代理配置、系统代理继承和连接测试；错误提示区分网络不可达、代理错误、认证错误和限流错误。

### 16.8 缓存版本和重复解析

风险：同一个视频可能使用不同语言、模型、prompt 或 schema 重新解析，旧结果被覆盖后无法解释或恢复。

应对：使用 `analysisRun` 隔离每次运行，配置哈希参与缓存键；数据库和 FTS 查询必须带 `run_id`，UI 只展示当前选中的运行。

### 16.9 Electron 与 FFmpeg 分发

风险：原生模块 ABI、FFmpeg 二进制权限、平台差异和许可证可能导致开发环境正常、打包后失败。

应对：在 CI 中对目标平台执行打包启动、ffmpeg/ffprobe 探测、媒体 fixture 测试和许可证清单检查；不要只验证开发模式。

## 17. 推荐实现优先级

推荐按 V0 到 V1 的顺序推进，先完成最小闭环，再补齐完整 MVP 能力。

V0 优先级：

1. 创建 Electron + React 项目，并配置 Electron 安全基线、preload API 和 IPC schema。
2. 配置 `ffmpeg-static`、`ffprobe-static`、`better-sqlite3` rebuild 和基础打包验证。
3. 选择本地视频并播放 P0 测试矩阵中的 `mp4`、`mov`、`webm`。
4. 通过 `ffprobe` 读取视频元数据和第一条可用音轨。
5. 抽取音频。
6. 按文件大小切片，保留 5 到 10 秒重叠。
7. 调用 Groq 转写并分片落盘。
8. 合并 transcript，处理重叠区去重。
9. 展示 transcript。
10. 点击 transcript 跳转视频。
11. 保存本地缓存。

V1 优先级：

1. 按 token 预算生成章节摘要，并通过 `sourceSegmentIds` 计算时间。
2. 点击章节和带来源的关键要点跳转视频。
3. 实现 SQLite FTS5 搜索和 `LIKE` 降级。
4. 对不稳定播放容器执行 remux，并验证 remux 后可播放。
5. 预留或实现用户确认后的 H.264/AAC 重编码兜底。
6. 实现缓存清理和主要错误提示。

完成 V0 后，项目已经可以验证核心产品价值；完成 V1 后，项目达到完整 MVP 可交付状态。

## 18. 实现前置决策清单

### 18.1 切片大小判定

先按 5 到 10 分钟生成 FLAC 分片，相邻分片保留 5 到 10 秒重叠，再根据 provider adapter 返回的上传限制检查文件大小；超过目标大小的分片继续二分切分，并更新同一份 manifest。合并 transcript 时按时间范围优先、文本相似度辅助，无法可靠匹配时记录 `mergeWarning`。单片请求可携带上一片尾部文本作为 provider prompt，但长度必须由 adapter 按模型能力截断。

### 18.2 章节时间戳对齐

LLM 只返回章节和要点引用的 `sourceSegmentIds`。程序取被引用片段的最小 start 和最大 end 生成时间范围，并校验引用存在、章节单调、不重叠和不超出视频时长。异常时记录 `alignmentWarning` 并执行确定性的后处理。

### 18.3 断点续传和恢复

每个分片转写成功后立即写入独立 transcript 文件，并在 SQLite 中记录当前 `analysisRun` 的 chunk 状态。任务恢复时只处理缺失、失败或租约超时的分片；成功分片通过幂等键禁止重复提交。

### 18.4 并发和限流

默认转写并发度由 provider adapter 和用户配置决定。遇到 429、5xx 或网络错误时按 provider 返回的可重试标记和等待时间退避；若仍失败，保留失败状态等待用户手动重试。连续 429 时降低整体并发度。

### 18.5 超长视频摘要

摘要前先估算 transcript token 数。只有当输入 token 低于所选模型上下文安全阈值时，才使用单次摘要；超过阈值时使用 map-reduce 策略：先按 10 到 20 分钟窗口或 token 预算双条件生成局部摘要，再生成全局摘要和章节。map-reduce 模式下需要在全局阶段合并去重局部章节、排序并做时间戳对齐；同时 prompt 应限制章节数量上限（默认不超过 15 个），避免输出 token 超预算。

### 18.6 API key 存储

Electron 版本使用 `safeStorage` 加密 Groq API key。数据库或 JSON 配置文件只保存加密后的值和必要的元数据，不保存明文 key。Linux 无系统钥匙串（如 WSL2）时 `safeStorage` 会退化为弱保护存储，应用需要检测并在设置页提示当前保护级别。

### 18.7 ffmpeg 打包

MVP 使用 `ffmpeg-static` 和 `ffprobe-static` 提供跨平台二进制。Electron 打包时需要通过 `asarUnpack` 或等价配置保证 `ffmpeg` 和 `ffprobe` 二进制可以被主进程执行。

### 18.8 Electron 进程边界

MVP 使用主进程管理文件、数据库、`safeStorage` 和后台任务；renderer 只通过 preload 暴露的最小 API 发起操作。`ffmpeg` 由 worker 编排并以子进程执行，任务进度通过事件型 IPC 回传。

### 18.9 播放兼容验证与重编码

remux 后必须验证 HTML video 能触发 `loadedmetadata` 和 `canplay`，并至少完成一次首帧 seek 或短暂播放；建议额外 seek 到接近末尾确认末尾解码，因为 AC3、HEVC 等编码错误常在解码中后段才暴露。验证失败时，才进入 H.264/AAC 重编码或显示编码不兼容提示。重编码文件命名为 `playback.compat.mp4` 并纳入缓存清理。

### 18.10 搜索实现

MVP 使用 SQLite FTS5（`trigram` 分词器）建立 transcript、章节标题、章节摘要和关键要点索引，以支持中文子串匹配。trigram 要求查询至少 3 个字符，1 到 2 字符的短查询降级为 `LIKE`。若目标平台 SQLite 不支持 FTS5 或 trigram，则整体降级为 `LIKE` 搜索；降级模式不承诺复杂分词和排序，只保证关键词命中与跳转。

### 18.11 摘要 token 预算

单次摘要输入控制在所选模型上下文窗口的 60% 以内，并保留至少 25% 给输出。map-reduce 局部窗口按 10 到 20 分钟或 token 预算双条件切分，以先达到的条件为准；窗口只在 segment 边界切分，并允许 30 到 60 秒重叠。

### 18.12 网络与代理

设置页需要支持 HTTPS 代理配置、系统代理继承和连接测试。连接测试至少覆盖 Groq API key 校验、DNS/连接超时、代理认证失败和限流响应。

### 18.13 原生模块 rebuild

使用 `better-sqlite3` 时，开发、测试和打包流程必须执行 Electron ABI rebuild，并把目标 Electron 版本纳入锁定依赖。

### 18.14 分析运行和缓存键

每次解析创建一个 `analysisRun`。缓存键至少包含视频指纹、指纹版本、音频处理配置、ASR/LLM provider 和 model、语言、prompt 版本及 schema 版本。运行完成后才将其设置为视频的当前运行；失败或取消的运行不得覆盖已完成结果。

### 18.15 播放跳转行为

点击 transcript、章节或搜索结果时，播放器定位到来源片段的 start，并默认保持原有播放状态；“跳转后自动播放”作为用户设置，不在底层 API 中强制调用 `play()`。所有时间统一使用秒数的浮点值，范围必须校验在 `[0, duration]` 内。

## 19. 参考资料

- Groq Speech-to-Text: https://console.groq.com/docs/speech-to-text
- Groq API Reference: https://console.groq.com/docs/api-reference
- MDN HTMLMediaElement currentTime: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime
- Electron Dialog: https://www.electronjs.org/docs/latest/api/dialog
- ffmpeg.wasm: https://ffmpegwasm.netlify.app/docs/overview/
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- WhisperX: https://github.com/m-bain/whisperX
