# “成长迷雾，如何找到自己的火花”插画实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重新生成两张适用于社交媒体文章的竖版叙事插画：电影感数字绘画与东方水墨幻想各一张，人物为无武器、平和从容的游侠。

**Architecture:** 使用内置图像生成工具分别重绘两个独立资产；每张图采用专属提示词，但共享竖版留白、无兵刃游侠、单一暖色火花、舒适观感和无文字约束。生成后逐张做视觉检查，并将合格文件以 `-v2` 文件名保存到项目 `assets/social/`，保留原图。

**Tech Stack:** 内置 image_gen 图像生成、视觉检查工具、本地 PNG 文件。

## Global Constraints

- 竖版构图，适合作为社交媒体文章封面或配图。
- 画面不包含文字、标志、水印或边框。
- 人物为匿名的独行者，不突出具体身份、年龄或五官。
- 主体位于画面中下部，上方保留安静、低细节的标题空间。
- 火花是唯一明确的暖色视觉锚点；它应小而珍贵，不表现为熊熊大火。
- 手机缩略图尺寸下仍须看清“人物—道路/雾—火花”的叙事关系。
- 人物穿素色宽袖长衫与轻便披风，以从容姿态表现无兵刃游侠气质。
- 不出现长剑或任何武器，不出现战斗姿势、肃杀感或武侠海报式英雄造型。
- 降低大面积纯黑、阴冷压迫和危险感，以薄雾、留白、浅色层次和柔和光线提升观看舒适度。

---

### Task 1: 重绘平和游侠电影感数字绘画

**Files:**
- Create: `assets/social/finding-inner-spark-cinematic-v2.png`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-16-finding-inner-spark-illustrations-design.md`
- Produces: 一张可独立使用的竖版 PNG 主视觉。

- [ ] **Step 1: 使用结构化提示词生成图像**

  提示词明确清晨青灰与浅蓝薄雾、背向观众且从容行路的无兵刃游侠、平缓山路、远处柔和橙金微火、顶部留白、高完成度电影概念艺术，以及所有全局约束。

- [ ] **Step 2: 检查画面**

  验证主体位置、顶部留白、火花尺度、浅柔冷暖层次、舒适观感、手机缩略图可读性，并确认无武器、文字、标志、水印和边框。

- [ ] **Step 3: 保存最终文件**

  将合格输出复制到 `assets/social/finding-inner-spark-cinematic-v2.png`，不得覆盖原图；若该版本已存在则使用 `finding-inner-spark-cinematic-v3.png`。

### Task 2: 重绘平和游侠东方水墨幻想插画

**Files:**
- Create: `assets/social/finding-inner-spark-ink-v2.png`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-16-finding-inner-spark-illustrations-design.md`
- Produces: 一张可独立使用的竖版 PNG 主视觉。

- [ ] **Step 1: 使用结构化提示词生成图像**

  提示词明确宣纸般暖白背景、浅淡泼墨山雾、素衣无兵刃游侠、掌心或胸前的朱红微火、墨色由浓至淡、顶部留白、当代东方水墨幻想，以及所有全局约束。

- [ ] **Step 2: 检查画面**

  验证水墨材质、主体位置、顶部留白、朱红焦点、温润平和情绪、手机缩略图可读性，并确认无武器、文字、标志、水印和边框。

- [ ] **Step 3: 保存最终文件**

  将合格输出复制到 `assets/social/finding-inner-spark-ink-v2.png`，不得覆盖原图；若该版本已存在则使用 `finding-inner-spark-ink-v3.png`。

### Task 3: 最终一致性验收

**Files:**
- Verify: `assets/social/finding-inner-spark-cinematic-v2.png`
- Verify: `assets/social/finding-inner-spark-ink-v2.png`

**Interfaces:**
- Consumes: Task 1 与 Task 2 的两张 PNG。
- Produces: 两张风格明显不同、核心隐喻一致的交付图。

- [ ] **Step 1: 并排复核叙事差异**

  电影感版本须表达“看见并走向火光”；水墨版本须表达“发现火光原来在自己身上”。

- [ ] **Step 2: 核对文件与尺寸**

  使用 `file assets/social/finding-inner-spark-*-v2.png` 核对两张文件均为有效竖版 PNG，并报告最终路径。
