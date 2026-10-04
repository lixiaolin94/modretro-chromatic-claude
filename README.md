# ModRetro Chromatic for Claude Code

把 OpenAI DevDay 2026 发布的 **ModRetro Chromatic Plugin for Codex**（MIT 许可）移植到 Claude Code 的社区版本：用自然语言做 Game Boy / Game Boy Color 游戏（GB Studio 工程），在浏览器和 PyBoy 模拟器里试玩，再串流或烧录到 ModRetro Chromatic 掌机。

> 非官方移植，与 ModRetro、OpenAI 无关联，也未获其背书。上游代码按 MIT 许可保留版权声明；ModRetro 的闭源 Chromatic CLI **不随本插件分发**（见下文）。

## 安装

需要 Node.js 22+（在 Claude Code 使用的 PATH 里）。

在 Claude Code 里依次执行（直接从 GitHub 安装，无需下载代码）：

```text
/plugin marketplace add lixiaolin94/modretro-chromatic-claude
```

```text
/plugin install modretro-chromatic@modretro-chromatic-claude
```

或在终端里：

```bash
claude plugin marketplace add lixiaolin94/modretro-chromatic-claude
```

```bash
claude plugin install modretro-chromatic@modretro-chromatic-claude
```

更新到最新版本：

```bash
claude plugin marketplace update modretro-chromatic-claude
```

### 从本地克隆安装（开发用）

```bash
git clone https://github.com/lixiaolin94/modretro-chromatic-claude.git ~/Documents/GitHub/modretro-chromatic-claude
```

```bash
claude plugin marketplace add ~/Documents/GitHub/modretro-chromatic-claude
```

```bash
claude plugin install modretro-chromatic@modretro-chromatic-claude
```

## 使用

```text
/modretro-chromatic:new-game 一个园丁收集三颗种子、种下后打开大门的小探索游戏
```

也可以直接说"帮我做一个 Game Boy 游戏"，Claude 会自动调用对应 skill。首次构建时会把 GB Studio CLI 4.3.2、GBDK 4.5.0、PyBoy 等开源依赖装到 `~/Library/Application Support/modretro-chromatic`（与 Codex 版共用，已装过就直接复用）。

| Skill | 用途 |
| --- | --- |
| `/modretro-chromatic:new-game` | 从想法到可玩预览的一条龙入口 |
| `/modretro-chromatic:authoring` | 场景、角色、事件、对话、碰撞、变量 |
| `/modretro-chromatic:pixel-art` | 像素画（文本网格 ⇄ PNG）、调色板、瓦片预算 |
| `/modretro-chromatic:rom-debugging` | 构建、ROM 检查、PyBoy 逐帧试玩与调试 |
| `/modretro-chromatic:deployment` | 连接 Chromatic、串流试玩、烧录卡带、采集画面 |
| `/modretro-chromatic:setup` | 依赖安装与故障诊断 |

预览：在 Claude Code 桌面版里会直接在内置 Browser 面板打开官方 Binjgb 播放器；终端版会给出本地 URL 让你自己打开。

## 真机（Chromatic）

1. 串流、烧录、采集需要 ModRetro 的闭源 `chromatic-cli`。第一次用时 Claude 会征求你的同意，然后从 npm 官方源下载 `@modretro/chromatic-cli-<平台>@1.2.1`，按上游插件记录的 SHA-256 逐字节校验后安装；缓存在 `~/Library/Application Support/modretro-chromatic-claude`，插件更新后由 SessionStart 钩子离线恢复。
2. 烧录卡带需要开发者模式：在官方 [ModRetro Chromatic Firmware Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx) 里按 `Cmd-I` 输入 DevDay 版附带的激活码。插件和 Claude 永远不会索要或处理激活码。
3. 首次烧录前 Claude 会明确告知"会擦除卡带现有数据、存档可能丢失、不做备份"并取得你的同意；只烧录自制游戏，拒绝商业游戏。

## 与 Codex 版的区别

| | Codex 版 | 本移植 |
| --- | --- | --- |
| 插件格式 | `.codex-plugin` | `.claude-plugin` + `.mcp.json` + skills + hooks |
| MCP 服务端 | 81 个工具 | 原样复用（只改了面向用户/模型的 "Codex" 措辞） |
| 浏览器预览 | Codex 内置浏览器 | Claude 桌面版 Browser 面板 / 终端版给 URL |
| 像素画 | Codex 内置生图 + 网格识别 | 新增 `pixel-grid.mjs`：Claude 用文本网格逐像素作画，渲染 PNG + 放大预览 + GB 硬件约束检查 |
| "Annotate game" 注释 | 依赖 Codex/ChatGPT 浏览器私有 API | 不可用，改用截图/模拟器帧/文字描述 |
| Chromatic CLI | 随插件内嵌（仅授权给官方 Codex 插件） | 不分发，经用户同意后从 npm 官方源下载并校验 |
| 掌机画面采集 | macOS、Linux | 仅 macOS。Linux 采集依赖的 FFmpeg 打了私有补丁、无法提供 LGPL 对应源码，因此未包含 |
| 工具超时 | 900 秒 | 受 Claude Code 的 `MCP_TOOL_TIMEOUT` 控制；首次安装依赖很慢时 skill 会改用后台 Bash |

详见 [plugins/modretro-chromatic/CLAUDE-PORT.md](plugins/modretro-chromatic/CLAUDE-PORT.md)。

## 仓库结构

```text
.claude-plugin/marketplace.json   本地插件市场
plugins/modretro-chromatic/       生成的插件（由 port.mjs 产出，勿手改）
port/port.mjs                     可复现移植脚本：上游 zip/目录 → Claude 插件
port/overlay/                     Claude 专属文件（清单、skills、钩子、新工具）
port/smoke.mjs                    快速自检（不联网、不碰 USB）
port/e2e-build.mjs                真实工具链端到端测试（建工程→画精灵→构建→模拟器→预览）
```

## 跟进上游新版本

```bash
node port/port.mjs ~/Downloads/modretro-chromatic.zip
```

```bash
node port/smoke.mjs
```

移植脚本里每条文本替换都声明了期望命中次数，上游措辞一变就会报错并指出是哪条规则，避免产出"半移植"的插件。
