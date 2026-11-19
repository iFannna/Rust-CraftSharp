# Minecraft 资源参考库

本目录不参与构建，只作为新增 MC 原版实体时的权威参考。应用实际使用的模型、动画与贴图在 `assets/` 下，路径均相对仓库根目录。

## 内容与来源

- `reference/bedrock/entity/*.geo.json`、`reference/bedrock/*.animation.json`：Mojang 官方基岩版资源包，取自 Mojang/bedrock-samples 的 main 分支，用于数据驱动几何对照与官方动画角度。少部分动画 JSON 带注释，属原样数据。
- `reference/java/net/minecraft/**`：Java 版反编译源码（Mojang 映射），取自 MCFireworkDev/MinecraftDeobfuscated-Mojang 的 snapshot 分支，是模型结构、逐面 UV 与姿态常数的权威来源。该公开仓库只到 2023 年，26.3 的源码需用 Bram1903/MinecraftSourcesGenerator 本地生成，生成结果不入库。
- `assets/minecraft/textures/`：从 26.3 客户端 jar 原样解包，路径与 jar 内一致。
- `assets/minecraft/textures/{item,block}/data/categories.json`：按 26.3 `CreativeModeTabs` 的官方创造栏重建，物品与方块分类不再手写。

## 新增一个实体

1. 在 `reference/java/net/minecraft/client/model/` 找到对应 `*Model.java`，读 `createBodyLayer` 里的 `CubeListBuilder` 与 `PartPose`。
2. 在 `apps/desktop/scripts/build-models.mjs` 按现有实体转录骨骼与立方体，贴图路径写 jar 内相对路径，输出到 `assets/models/entity/`。
3. 动画看对应 `*Model.setupAnim`；玩家姿态同时参考 `reference/bedrock/humanoid.animation.json`，用 `apps/desktop/scripts/build-animations.mjs` 烘焙到 `assets/animations/`。
4. 用 `reference/bedrock/entity/*.geo.json` 交叉校验世界坐标，不目测调 UV。
5. 在 `apps/desktop/src/entity3d/catalog.ts` 的 `ENTITIES` 加入入口，运行两个脚本后在实体预览窗口验收。

## 坐标约定

Java 模型空间是 y 向下、正面朝 -z。烘焙时绕 X 轴转 180°：x 不变，y、z 取反，骨骼旋转角 (x,-y,-z)。项目内正面为 +z，贴图按官方逐面顶点表映射，不做手工翻转。

## 许可

以上内容版权归 Mojang，仅用于本项目的 Minecraft 相关开发参考，使用时遵守 Minecraft 最终用户许可协议。
