# Codex 插件

v0.7.0 提供本地 Codex 插件，包含 14 个 MCP 工具和 Minecraft 开发技能。DSH 入口仍可使用，两者共享工具实现及游戏探针。

## 安装

需要 Node.js **22.16 或更新版本**，且 `node` 在 PATH 中。游戏开发还需要对应 JDK：Forge 1.20.1 使用 JDK 17，Forge/NeoForge 26.1.2 使用 JDK 25。

使用支持插件命令的 Codex CLI：

```powershell
codex plugin marketplace add yofengi/minecraft-mod-dev --ref v0.7.0
codex plugin add minecraft-mod-dev@minecraft-mod-dev-plugins
```

重新打开 Codex 聊天，使插件工具和技能加载。桌面端也可在插件列表中选择 `Minecraft Mod Dev`。GitHub 市场是本项目的分发方式；本项目未提交官方公共插件目录。

离线包可从 [v0.7.0 Releases](https://github.com/yofengi/minecraft-mod-dev/releases/tag/v0.7.0) 下载 `minecraft-mod-dev-codex-0.7.0.zip`。解压后将其中的 `minecraft-mod-dev-codex` 目录添加为本地市场：

```powershell
codex plugin marketplace add '<解压路径>/minecraft-mod-dev-codex'
codex plugin add minecraft-mod-dev@minecraft-mod-dev-plugins
```

插件内的 `server.cjs` 已包含 MCP SDK 和运行依赖，无需在安装目录执行 npm install。`minecraft-mod-dev-0.7.0.zip` 是另一个 DSH 包，不用于 Codex 安装。

## 连接 Minecraft

先把匹配的探针 jar 放入游戏实例的 `mods`，再通过原启动器启动游戏。PCL 的版本隔离目录和 Gradle 工程是两种目录：游戏目录不能作为 `mcdev_build` 或 `mcdev_prepare` 的 `projectDir`。

例如在 Codex 中输入：

> 使用 Minecraft Mod Dev 检查我的 NeoForge 26.1.2 实例，连接现有探针，读取状态并截图。

单人模式进入世界后，服务端和客户端探针均可用。默认连接 `127.0.0.1:39001`（服务端）和 `127.0.0.1:39002`（客户端），token 为 `mcdev`。

开发工程可以由 `mcdev_prepare` 启动，并由 `mcdev_stop` 停止。插件关闭时只清理它自己启动的进程；已通过启动器打开的游戏不会成为插件拥有的进程。多人游戏端口是 `joinPort`，默认 `25566`，与探针端口不同。

可在本地 MCP 启动环境中设置 `MCDEV_TOKEN`、`MCDEV_SERVER_PORT`、`MCDEV_CLIENT_PORT`；对应游戏 JVM 属性为 `mcdev.probe.token`、`mcdev.probe.port`、`mcdev.probe.client.port`。两侧必须匹配。环境配置只改变连接目标，不修改游戏或 Gradle 项目的运行配置。自定义配置应保存在本机，避免随仓库发布。

## 工具

| 用途 | 工具 |
|---|---|
| 状态与证据 | `mcdev_status`、`mcdev_ui`、`mcdev_screenshot`、`mcdev_run_dump` |
| 游戏操作 | `mcdev_command`、`mcdev_click`、`mcdev_use`、`mcdev_scenario` |
| 构建与测试 | `mcdev_build`、`mcdev_gametest` |
| 启停与安装 | `mcdev_prepare`、`mcdev_stop`、`mcdev_launch_status`、`mcdev_install_probe` |

截图工具返回 PNG 图片和文件元数据，支持的图片上限为 16 MiB。其他 JSON 结果同时作为文字与 MCP `structuredContent` 返回。参数错误、探针错误、构建失败和场景断言失败会标记 `isError`。`result: 0` 是 Minecraft 命令结果，不自动等于构建失败；场景 warnings 仍需检查。

MCP 配置为长构建设置 1200 秒工具超时。游戏内操作会改变世界和背包，功能验证应使用独立测试世界。已有授权范围内的工作可正常执行，技能不要求额外的通用审批流程。

## 从源码验证

```powershell
npm ci --ignore-scripts
npm test
python scripts/package-release.py --plugins-only
```

省略 `--plugins-only` 会把本地构建好的两个 26.1.2 探针一并打包到 `dist/v0.7.0/`。完整游戏验证需要可丢弃的 Gradle 运行目录、已配置的 EULA/端口，以及对应 JDK：

```powershell
node lab/tools/smoke_mcp.mjs '<Gradle工程绝对路径>' '<JDK25绝对路径>' 25566
```

该检查经由发布包内的 MCP 服务执行构建、启动、连接、真实合成、界面读取、图片截图、记录导出和停止。已有 Forge/NeoForge 探针的 Java 功能范围及独立测试见仓库的 `docs/MINECRAFT-26.1.2.md`。

协议测试验证标准 SDK 客户端与 stdio 服务的交互，并在仓库外复制插件以验证不依赖源代码或 node_modules。插件能否在当前聊天出现还取决于宿主是否已启用它；安装后请在新聊天中确认工具列表。

### v0.7.0 验证记录

2026-10-25 在 Windows 上完成 83 项自动测试，全部通过。将 Codex ZIP 解压到仓库外后，以该包中的 MCP 服务连接 NeoForge 26.1.2.114，完成构建、服务端与客户端启动、入服、原木合成 4 块木板的断言、界面读取、PNG 截图、记录导出及进程停止；截图确认已进入世界。

本次沿用 v0.6.0 的 Forge 64.1.5 / NeoForge 26.1.2.114 探针源码与 jar。两种探针均已有独立的构建及真实服务端、客户端验证；此次新增 MCP 全流程游戏验证使用 NeoForge。

## 依据

- [OpenAI 插件打包与本地市场](https://developers.openai.com/plugins/build/plugins)
- [本地 stdio MCP 插件](https://developers.openai.com/plugins/deploy/desktop-only)
