# Minecraft 26.1.2

本 fork 保留上游 Forge 1.20.1 工程，新增 Forge 与 NeoForge 的 26.1.2 探针。原有工具名称、HTTP JSON 格式、`X-Mcdev-Token` 和端口保持兼容。

| Minecraft | 加载器 | Java | 工程 | 产物 |
|---|---|---|---|---|
| 1.20.1 | Forge 47.4.28 | 17 | `lab/mcdev-probe` | 原版 `mcdev_probe-0.1.0-dev.jar` |
| 26.1.2 | NeoForge 26.1.2.114 | 25 | `lab/mcdev-probe-neoforge-26.1.2` | `mcdev_probe-neoforge-26.1.2-0.2.0.jar` |
| 26.1.2 | Forge 64.1.5 | 25 | `lab/mcdev-probe-forge-26.1.2` | `mcdev_probe-forge-26.1.2-0.2.0.jar` |

26.1.2 两种加载器共享 `lab/mcdev-probe-26.1.2-common`。每种加载器有独立入口和元数据，必须安装匹配的 jar。新版使用官方名称，可装入正常启动器实例；旧版仍仅供 Forge 开发环境使用。

## 构建

安装 JDK 25，设置当前终端的 `JAVA_HOME`，然后执行：

```powershell
cd lab\mcdev-probe-neoforge-26.1.2
.\gradlew.bat build

cd ..\mcdev-probe-forge-26.1.2
.\gradlew.bat build
```

产物位于各自的 `build/libs/`。首次构建会下载并编译 Minecraft 和加载器依赖。Java 的网络代理需通过 Gradle 系统属性配置；Java 不自动读取 `HTTP_PROXY`。不要将个人代理或 JDK 路径提交到仓库。

NeoForge 版本固定为 26.1.2.114，与本次适配的 PCL 实例一致。升级加载器后应重新运行验证。Forge 的 `runGameTestServer` 和 NeoForge 的同名任务留给被测模组注册的测试使用；探针本身不提供 Charger 的 12 项 GameTest。

## 安装与启动

从 [本 fork 的 Releases](https://github.com/yofengi/minecraft-mod-dev/releases/tag/v0.6.0) 下载插件包及所需加载器的探针。将 `minecraft-mod-dev-0.6.0.zip` 解压后，在 DSH 中执行 `plugin_manager install_bundle target=<解压目录>/minecraft-mod-dev`。

将匹配的新版 jar 放入目标实例的 `mods` 目录。PCL 使用版本隔离时，应放在 `.minecraft/versions/<实例名>/mods`，不是根目录的 `mods`。同一实例只保留一个 `mcdev_probe`。

插件的安装工具会验证 jar 元数据、PCL 启动参数和已存在的探针：

```text
mcdev_install_probe
  probeJar=<绝对路径>/mcdev_probe-neoforge-26.1.2-0.2.0.jar
  runDirs=["<绝对路径>/<NeoForge实例>"]
  loader=neoforge
  minecraftVersion=26.1.2
```

普通启动器实例通过 PCL 等启动。`mcdev_prepare` 用于含 Gradle wrapper 的开发工程，不能把游戏安装目录当成 Gradle 工程：

```text
mcdev_prepare
  projectDir=<仓库绝对路径>/lab/mcdev-probe-neoforge-26.1.2
  javaHome=<JDK25绝对路径>
  kind=both
```

`mcdev_build` 和 `mcdev_gametest` 同样接受可选 `javaHome`，仅作用于当前子进程。开发工程分别使用 `run-server`、`run-client`、`run-gametest`；运行服务端前配置该测试实例的 EULA 和端口。插件默认连接本机 `25566`，可通过 `joinPort` 指定测试服端口。

探针 HTTP 默认仅监听 `127.0.0.1`：服务端 `39001`、客户端 `39002`，默认 token 为 `mcdev`。单人世界启动后也提供服务端探针，退出世界时关闭服务端监听。

```powershell
Invoke-RestMethod http://127.0.0.1:39002/status -Headers @{ 'X-Mcdev-Token' = 'mcdev' }
```

## API 变化

- `/status` 新增 `loader`，Minecraft `version` 为 `26.1.2`。
- `mcdev freeze`、`mcdev step` 使用原生 tick 管理器，暂停不会改写世界 gamerules。
- `/world/block` 的 `blockEntity` 仍返回 SNBT，使用当前 registry 进行序列化。
- `/item/mainhand` 的 `nbt` 兼容字段返回 components patch 文本。
- `/item` 的旧 `nbt` 参数映射到 `minecraft:custom_data`；当前物品组件通过 `components` 参数传入 `/give` 方括号内的语法，例如 `minecraft:damage=100`。HTTP 查询参数需 URL 编码。
- `mcdev_scenario` 接受 `minecraftVersion`，也可放在卡片顶层；实际执行时可从服务端状态推断，离线 `dryRun` 默认沿用 1.20.1。新版卡片应明确填写 `26.1.2`。`give`、`select_item`、`item` 和 `item_bar` 支持 `components`。
- `/recipe` 使用当前配方展示结果。`/craft` 只支持可放入普通合成格的配方；材料不足或匹配失败不消耗背包，成功时计算真实产物和容器返还物。
- 客户端点击适配新版鼠标事件与容器操作接口。

旧 Charger 示例仍针对 1.20.1；它的配方、方块、功能卡及上游 12/12 GameTest 结果不代表已迁移到 26.1.2。

## 验证

自动化服务端检查会修改测试世界的 `(0,100,0)` 方块并临时暂停 tick，只在可丢弃的测试世界运行：

```powershell
python lab/tools/smoke_probe.py --loader neoforge
python lab/tools/smoke_probe.py --loader forge
python lab/tools/smoke_client.py --loader neoforge
python lab/tools/smoke_client.py --loader forge --game-port 25567
node --test plugin/minecraft-mod-dev/test/*.test.js
```

服务端检查覆盖版本、加载器、token、命令执行和失败、方块、配方、物品组件、掉落、暂停/逐帧及记录导出。两种加载器的服务端应逐个启动，避免默认端口冲突。

客户端检查需要对应服务端已启动，覆盖连接、真实合成、背包/槽位操作、生存挖掘和截图。`/player/mine` 期间会显示临时非暂停界面以隔离原生输入，结束后恢复先前界面；用户切换界面会中止挖掘。

2026-10-25 在 Windows 11 / JDK 25.0.3 的独立测试世界中完成以下验证：

| 检查 | 结果 |
|---|---|
| 插件 Node.js 回归 | 48/48 通过 |
| Forge 64.1.5 构建及材料匹配回归 | 通过 |
| NeoForge 26.1.2.114 构建及材料匹配回归 | 通过 |
| 两种加载器的服务端 HTTP 检查（含假玩家） | 通过 |
| 两种加载器的客户端连接、合成、背包、生存挖掘、截图 | 通过 |

Forge 测试服使用 `25567`，NeoForge 使用 `25566`；脚本参数应与实际服务端配置一致。原 Forge 1.20.1 工程保留原样，本次未重新进行其游戏内验证。上述检查未覆盖任意第三方模组组合。

## 参考

- [NeoForge 开发环境与 Java 25 要求](https://docs.neoforged.net/docs/gettingstarted/)
- [NeoForge 26.1.2 官方 MDK](https://github.com/NeoForgeMDKs/MDK-26.1.2-ModDevGradle)
- [Forge 26.1.2 官方下载](https://files.minecraftforge.net/net/minecraftforge/forge/index_26.1.2.html)
- [上游仓库](https://github.com/yan-mc/minecraft-mod-dev)
