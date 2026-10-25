# minecraft-mod-dev plugin v0.7.0

## v0.7.0（2026-10-25）

- DSH 与新增 Codex MCP 入口共享 `core.js` 中的 14 个工具；DSH 输出与注册接口保持兼容。
- 每个运行实例独立跟踪其子进程；构建使用 `--no-daemon`，退出清理不会接管手动启动的游戏。
- 场景执行前检查全部步骤，避免后续参数错误导致前面的命令已经执行。
- 增加运行实例隔离、连接配置、错误脱敏和进程生命周期回归。

## v0.6.0（2026-10-25）

- 保留 Forge 1.20.1 的 `*-dev.jar` 和 `MixinConfigs` 校验。
- 支持 Forge / NeoForge 26.1.2 的官方映射探针；文件名、manifest 的 `Mcdev-Loader` / `Mcdev-Minecraft-Version` / `Mcdev-Mappings` 和对应模组描述文件必须匹配。
- `mcdev_install_probe` 新增可选 `loader`、`minecraftVersion`。读取实例目录内同名的基础版本 JSON 推断目标，显式参数与实例元数据都必须兼容。不会读取账号配置；未知目标通过 `warnings` 提示补全参数。
- 所有目标先检查再复制；遇到其他文件名的探针会拒绝，提示手动移除。允许覆盖同名探针，不删除其他模组。
- `mcdev_build`、`mcdev_prepare`、`mcdev_gametest` 新增可选 `javaHome`，只为子进程设置 `JAVA_HOME` 和 `PATH`，检查 JDK 的 `java`、`javac` 和项目 wrapper 路径。
- `mcdev_scenario` 新增可选 `minecraftVersion`，优先于卡片的同名字段。`dryRun` 未指定时固定使用 1.20.1；实际运行卡片或 item 步骤时可读取服务端 `/status` 推断，推断失败会警告并回退到 1.20.1。
- 卡片 `give` / `select_item` 支持字符串 `components`（可带外围 `[]`）；1.20.1 拒绝此字段。`give` 即使不选中物品也保留 `nbt`，26.1.2 将旧式 `nbt` 放入 `minecraft:custom_data`；原版耐久等数据应通过 `components: 'minecraft:damage=3'` 设置。
- `item` 步骤和 `item_bar` 断言转发 components；同时提供 `nbt` 和 components 内的 `custom_data` 会报错，避免互相覆盖。
- JAR 元数据由 Node 直接读取，不再依赖 PATH 中的 `jar`，校验失败不会降级为未验证安装。
- 回归测试：在插件目录运行 `npm test`（测试需要支持 `module.registerHooks` 的 Node 22.15+ 或 24+）。

## v0.5.1 历史记录

日期：2026-10-18
位置：`plugin/minecraft-mod-dev`

## 已安装

```text
plugin_manager install_bundle target=...\plugin\minecraft-mod-dev
application=applied, version=0.5.1
```

v0.5.1 包含：
- 14 个 `mcdev_*` 工具；
- `mcmod` preset（团队默认，Agent Teams 9 工具）；
- 内置官方实验 Agent Teams 挂载（禁用传统 subagent 四行）；
- `mcdev_scenario`：YAML 卡片、`dryRun`、`give.select`/`select_item`、`block`（comparator）、`break`（loot_break）、`craft`、`mine`/`client_mine`/`items`、`ui_close`、`recipe`/`loot`/`item`、`wait`；
- `mcdev_prepare`：等客户端到 TitleScreen 后通过 `/connect` 显式连接（不再依赖 quickPlay）；Disconnected 提前失败；最多 3 次尝试，返回 `attempts` 诊断。

## 工具

| 工具 | 作用 |
|---|---|
| `mcdev_status` | server/client probe 状态 |
| `mcdev_command` | server 控制台 / client 玩家命令 |
| `mcdev_ui` | 客户端 Screen、控件树、容器槽位 |
| `mcdev_click` | GUI 坐标/槽位点击（支持 shift） |
| `mcdev_use` | 右键方块（开箱子/交互） |
| `mcdev_screenshot` | 客户端截图，返回 path/exists/size |
| `mcdev_run_dump` | run 快照写到 `.mcdev/runs/<id>/snapshot-*.json` |
| `mcdev_build` | 在指定 Forge 项目跑 `gradlew build` |
| `mcdev_gametest` | 跑 `gradlew runGameTestServer` |
| `mcdev_install_probe` | 校验并把 dev probe jar 放进一个或多个 `<runDir>/mods` |
| `mcdev_scenario` | 顺序执行 steps，或把 card YAML 转成 steps；支持 dryRun |
| `mcdev_prepare` | 启动 `runServer`/`runClient`，等待 probe ready，返回 pid/port/logPath |
| `mcdev_stop` | 停止 prepare 启动的进程（先 probe stop/quit，再强杀进程树） |
| `mcdev_launch_status` | 查看 prepare 启动的进程列表/pid/port/logPath/running |

## 实测

| 调用 | 结果 |
|---|---|
| `mcdev_status side=server` | tick/gameTime/players/version |
| `mcdev_command cmd="time set day"` | result=1000 |
| `mcdev_run_dump` | runId/tick/logs/path |
| `mcdev_screenshot` | exists=true, 854×480 |
| `mcdev_build` | exitCode=0 |
| `mcdev_gametest` | exitCode=0，12/12 GameTests |
| `mcdev_install_probe`（dev jar） | `manifestChecked=true, hasMixinConfigs=true`，3 个 runDir 已复制 |
| `mcdev_install_probe`（普通 jar） | 被拒绝：`probe jar must be a *-dev.jar` |
| `mcdev_scenario` 成功 | 8 步全过：status/assert/command/wait/status/assert/run_dump/assert |
| `mcdev_scenario` 失败 | `ok=false, failedAt=1`，错误 `expected eq "1.12.2"`，第 3 步未执行 |
| `mcdev_prepare kind=server` | pid=12620, port=39001, logPath=`.mcdev/launch-server-*.log`, ready=true |
| `mcdev_prepare kind=both` | server pid=26068 + client pid=7944，两个 probe 都 ready |
| `mcdev_stop side=all` | 两个进程都 stopped，之后 `launch_status=[]`，无 Java 残留 |
| YAML card dryRun | F-001/F-002 正常翻译；F-006 对不支持的 action/assert 给 warnings |
| YAML card live | S-001：setblock + data merge + data get + assert 123 全过 |
| YAML card live F-002 | 客户端 `card=F-002`：8 步全过，打开 ChargerScreen，title/slot 断言通过，warnings=[] |
| YAML card live F-001 | `give.select` 主手 + use + data get：assert 223 ≥ 100 通过；comparator 警告 |
| comparator analog | `scenario` 的 `block` 步骤：Energy=5000 → `/world/block` 返回 `analog=7`，assert eq 7 通过 |
| prepare waitJoin | `kind=both` → server ready + client `joined=true`；最多 3 次尝试 |
| prepare retry 恢复 | 无 server 先起 client，延迟 35s 起 server：attempt1/2 Disconnected，attempt3 `joined=true` |
| prepare 失败诊断 | 无 server 时 3 次都失败：`joined=false, retry=true, attempts[]`，每次带 pid/logPath/lastScreen |
| prepare 成功诊断 | 等 TitleScreen → `/connect` → `joined=true`，attempts 长度 1 |
| explicit connect | 连续 3 次 `kind=both` 都是 attempt1 `joined=true`，无 quickPlay |
| F-001 card live | `warnings=[]`，give.select/use/data get/assert 5200≥100、block analog=7 全过 |
| F-002 card live | `warnings=[]`，wait+use+wait+ui/title/slot 全过 |
| F-004 card live | `craft` crafted=true/result charger×1；recipe×1、loot total=1、loot_break drops charger×1；warnings=[] |
| client break | creative + `/player/break`：before=charger，after=air，server `/world/block` 也变 air（无掉落） |
| F-006 card live | `item` 返回 visible=true/width=6/color=65280；warnings=[] |
| F-007 card live | 客户端 packet mine：server block air、`items` charger×1；warnings=[]（client 本地 block 可能滞后） |
| 全量回归 | F-001/F-002/F-004/F-006/F-007 顺序执行全部 `ok=true, warnings=[]` |

## v0.5.1 install_probe 校验历史

1. 文件名必须是 `*-dev.jar`；
2. 用 `jar xf <jar> META-INF/MANIFEST.MF` 解出 manifest；
3. manifest 必须包含 `MixinConfigs: mcdev_probe.mixins.json`；
4. 通过后复制到 `<runDir>/mods/<name>`。

`jar` 路径优先取 `JAVA_HOME/bin/jar.exe`，否则用 PATH 里的 `jar`。
Windows 下 `spawnSync` 用 `shell: false`，避免 `C:\Program Files\...` 被 shell 截断。

## 团队/模式

- `task-1` 创建 → 分配给 docs-checker → `wait_agent` 收到总结 → complete；
- `mcmod` preset 需要在**新会话**里选一次，确认 roster/UI 正常。

## 客户端 handshake 诊断

失败时：

- client：`Starting new vanilla impl connection` 后不再有 modded handshake；
- server：已发 22 个 handshake 包，30s 后 `lost connection: Disconnected`；
- client Netty 线程在 selector 空闲，Render thread 正常 tick。

已做：

1. runClient 移除 `--quickPlayMultiplayer`；
2. 客户端到 `TitleScreen` 后 probe `/connect` 显式连接（带 `ServerData`，避免 NPE）；
3. `mcdev_prepare` 失败最多 3 次尝试并记录 `attempts[]`；
4. 每次改 probe 后 `clean devJar` + `mcdev_install_probe`。

实测：连续 3 次 `kind=both` 均 attempt1 `joined=true`。

## 待办

1. reference-mod 沙箱：从 Charger 模板生成新模组。
2. 正式 npm 包/插件目录分发（当前本地 link + GitHub release 资产）。
3. 更多 item NBT / 容器交互断言。
