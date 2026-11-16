# 实体资源参考库

本目录不参与构建，只作为新增 MC 原版实体时的权威参考。应用实际使用的模型与贴图在 `assets/` 下。

## 内容与来源

- `bedrock/entity/*.geo.json`、`bedrock/animations/*.json`：Mojang 官方基岩版资源包，取自 Mojang/bedrock-samples 的 main 分支，用于数据驱动几何对照与官方动画角度。少部分动画 JSON 带注释，属原样数据。
- `legacy-wpf/`：旧 WPF 项目的截图、字符串与图标，仅作历史参考，不参与构建。
- `java/net/minecraft/client/model/**`、`java/net/minecraft/client/renderer/entity/**`：Java 版反编译源码（Mojang 映射），取自 MCFireworkDev/MinecraftDeobfuscated-Mojang 的 snapshot 分支，是 Java 版模型结构、逐面 UV 与姿态常数的权威来源。该公开仓库只到 2023 年，26.3 的源码需用 Bram1903/MinecraftSourcesGenerator 本地生成，生成结果不入库。
- 全量贴图：从 26.3 客户端 jar 原样解包到 `assets/minecraft/textures/`，路径与 jar 内一致。
- `assets/minecraft/textures/{item,block}/data/categories.json`：按 26.3 `CreativeModeTabs` 的官方创造栏重建，物品与方块分类不再手写。

## 新增一个实体

1. 在 `java/net/minecraft/client/model/` 找到对应 `*Model.java`，读 `createBodyLayer` 里的 `CubeListBuilder` 与 `PartPose`。
2. 在 `scripts/build-models.mjs` 按现有实体块的写法转录骨骼与立方体，贴图路径写 jar 内相对路径。
3. 动画看对应 `*Model.setupAnim`；玩家姿态同时可参考 `bedrock/animations/humanoid.animation.json`。
4. 用 `bedrock/entity/*.geo.json` 交叉校验世界坐标，不目测调 UV。
5. 在 `src/entity3d/catalog.ts` 加入入口，运行 `node scripts/build-models.mjs` 后在预览窗口验收。

## 坐标约定

Java 模型空间是 y 向下、正面朝 -z。烘焙时绕 X 轴转 180°：x 不变，y、z 取反，骨骼旋转角 (x,-y,-z)。项目内正面为 +z，贴图按官方逐面顶点表映射，不做手工翻转。

## 许可

以上内容版权归 Mojang，仅用于本项目的 Minecraft 相关开发参考，使用时遵守 Minecraft 最终用户许可协议。
