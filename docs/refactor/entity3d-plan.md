# 通用实体 3D 渲染实施计划

## 0. 进度

- S1 完成：模型与动画数据冻结。模型从 Mojang 映射反编译源码逐条转录（`scripts/build-models.mjs`，出处注释在各实体块），与基岩官方 geometry 交叉校验 ALL MATCH（苦力怕/铁傀儡/玩家，浮点噪声已按容差处理）；玩家 slim 由 PlayerModel.createMesh 转录；村民按 Java 版修正（Bedrock 版袍高与抱臂旋转均不同）；末影龙颈 5 段、尾 12 段按渲染器重复方式展开，龙眼为自发光叠层
- S1 完成：动画烘焙（`scripts/build-animations.mjs`），玩家 10 姿态 + 四生物动画，数值全部来自 HumanoidModel.setupAnim / 各模型 setupAnim / EnderDragonRenderer 与基岩官方 player.animation.json
- S1 完成：贴图提取，1.20.4 jar（与现有玩家皮肤同版本，steve.png 哈希一致），苦力怕、铁傀儡、村民、末影龙 + 龙眼共 5 张，路径保持 jar 内原样（`enderdragon`）
- S2 完成：`src/entity3d/`（model/animation/scene/index/catalog），UV 面序经带字探针贴图四朝向标定（背面 u 翻转，底面 v 翻转），MC 面亮度用世界法线着色器，最近邻采样，零厚度翼膜只留顶面
- S3 完成：姿态与生物动画截图逐项验证；坐姿、举三叉戟、蹲下、拉弓、挥手、游泳、滑翔、走路均与权威值一致
- S4 完成：预览窗口 `pages/entity-preview.html` + `src/windows/entityPreview.ts`，入口为托盘「3D 预览」与设置外观页按钮；实体/皮肤/动作/相机/线框/背景全部可用
- S5 完成（真机待验收）：离屏窗口 `entity-view` 出帧（PNG 回读，20fps），命令 `entity_host_frame` 解码合成进物品栏 player 区域；头部跟随按 WPF 契约换算（脖子基准、显示器四边归一、±45/±10/±10）；显隐联动与皮肤变更重建
- S6 完成：设置外观页皮肤入口（默认皮肤、模型类型、打开预览）、全量构建通过（tsc + vite + cargo check）
- 已修复：UV 六面映射改按官方源码定义。`ModelPart.Cube` 构造器明确写出每面四个顶点的位置与 UV 对应（含 Java y 向下到本项目 y 向上的换算），渲染器不再按面序常数猜测，改为按顶点角标查表（`src/entity3d/model.ts` 的 `FACE_UV`）。此前背面 v 方向错误导致背面贴图上下颠倒，末影龙翼膜同源错乱，均已随此修正
- 已修复：骨骼欧拉顺序改为 ZYX，对应 MC 先 X 后 Y 后 Z 的施加顺序；此前用 three 默认 XYZ，导致挥手等含 180° 偏航的复合旋转把手臂折进头部。预览切姿态取景前先跳过交叉淡入，包围盒按目标姿态计算
- 已修复：整体左右镜像。此前坐标转换只翻转 y、保留 x 与 z，整体是镜像变换。正确做法是把 Java 模型空间（y 向下、正面朝 -z）绕 X 轴转 180° 换成右手系：x 不变，y、z 取反，骨骼旋转角 (x,-y,-z)，模型正面为 +z，相机移到 +z 一侧。`FACE_UV` 按官方顶点表同步重定：正面贴图左沿在 x 最小处、背面在 x 最大处、左侧面在 z 最大处、右侧面在 z 最小处，顶面/底面 v 方向随 z 取反。动画里手写的挥手、游泳、滑翔、蹲下位移按同一变换换算。重新烘焙后与基岩几何按 z 取反映射对照仍 ALL MATCH。物品栏注视改为整体模型组偏航/俯仰、头部绕脖子额外俯仰，俯仰符号随新朝向改为光标下方为正值
- 已验证：铁傀儡藤蔓回到胸口左侧、近侧左臂外观与官方 wiki 渲染一致；alex 正背面、末影龙俯视双翼对称；拉弓手臂朝前、挥手双臂张开、蹲下前倾均正常
- 资源参考库就绪：`reference/bedrock`（Mojang 官方基岩几何 193 个、动画 143 个）、`reference/java`（反编译模型 124 个、实体渲染 167 个）、`assets/minecraft/textures/entity`（1.20.4 全量实体贴图 502 个）。新增实体按 `reference/README.md` 的步骤执行
- 待用户验收：真实桌面端的物品栏 3D 预览与头部跟随手感、自定义皮肤选择、切换皮肤后预览刷新
- 已知取舍：预览窗口相机在切姿态后自动重新取景；物品栏玩家区取景按 58/70 契约；dragon 暗色贴图在深色背景下对比度低属正常

## 1. 目标与基准

- 做一层通用 MC 实体渲染能力：玩家、苦力怕、铁傀儡、村民、末影龙，后续任意长方体实体零代码接入
- 视觉基准是 MC 游戏内实际渲染。旧 WPF 的 UV 与参数是手工试出来的，数据源不详，不作为基准；模型结构、UV、姿态角度全部取权威来源
- WPF 预览的布局、相机、交互参数仍然有效，作为预览行为的参考契约（见第 5 节）
- 动作/姿态是需求的一部分：蹲下、坐下、拉弓、用三叉戟等，对齐 MC 皮肤网站的预览体验

## 2. 需求清单

- 多功能预览窗口（本轮新增，用户明天验收用）：换实体、换皮肤、换动作、相机操作，详见第 10 节
- P3 物品栏 player 区：显示玩家，头身跟随鼠标，保持原版行为，不加动作选择
- 皮肤预览能力并入预览窗口：透视相机、左键拖拽旋转、wide/slim 正确区分、姿态选择
- 姿态库第一批：idle、walk、run、crouch、sit、bow、trident、wave、fly；切换 200ms 交叉淡入
- 生物能力：苦力怕、铁傀儡、村民、末影龙的模型与动画本轮做进渲染层；生物展示入口 UI 延后
- 玩家皮肤：配置里的皮肤路径与类型，默认皮肤 wide/slim 各 9 张已在 assets

## 3. 硬性约束

- 轻量：只引入 three.js 核心，不引入 skinview3d 运行时（它只覆盖玩家，会形成第二套实现）；其 MIT 动画数据可移植为纯数据
- 整齐：渲染模块独立目录 `src/entity3d/`，模型与动画数据放 assets，不与 HUD 代码混放
- 简洁：文件名短而达意，模块按 model/animation/scene 三个职责拆分
- 优雅：一份模型 schema 通吃所有实体，加一个生物 = 一份模型文件 + 一张贴图 + 可选动画文件，零代码改动
- 不手写 UV：模型结构与 UV 全部来自权威数据源，S1 验证后冻结格式
- 通宵自校验用独立 headless 浏览器与隐藏实例，不启动用户桌面端，不弹可见窗口

## 4. 架构

### 渲染与合成

- 物品栏是 Rust 原生分层窗口，3D 画面用离屏 WebView 渲染 + 回读合成：
  - 隐藏窗口 `entity-view` 跑 three.js，动画帧经 `canvas.toDataURL` 输出 PNG
  - 命令 `entity_frame` 把 PNG 交给 Rust，`image` crate 解码后合成进物品栏帧缓冲的 player 区域
  - 画面无变化不送帧；物品栏隐藏时停止渲染循环
  - 保持单窗口，不新增叠加窗口，不碰桌面层与 Win+D 层级
- 预览窗口是独立可见 WebView，直接渲染，不回读
- 回读尺寸 = player 区域物理像素（6x 下约 350×350），30fps 上限，实测 CPU 与帧率后定

### 输入

- 物品栏：原生侧已有光标位置，落在 player 区域附近时按第 5 节规则算跟随角度，事件发给离屏窗口
- 预览窗口：窗口内自己处理左键拖拽旋转与滚轮缩放

### 目录与数据

- `src/entity3d/model.ts`：schema 类型 + 骨骼树构建
- `src/entity3d/animation.ts`：关键帧播放、循环、交叉淡入
- `src/entity3d/scene.ts`：three.js 场景、相机、MC 面亮度、最近邻采样
- `src/entity3d/index.ts`：对外组装接口（加载实体、设姿态、设皮肤、取帧）
- `src/windows/entityView.ts`：离屏窗口引导（物品栏用）
- `src/windows/entityPreview.ts`：预览窗口引导
- `pages/entity-preview.html`：预览窗口页面
- 模型数据：`assets/models/entity/<name>.json`（玩家 wide/slim 两份）
- 动画数据：`assets/animations/<name>/<pose>.json`
- 转换脚本：`apps/desktop/scripts/bedrock-to-model.mjs`，权威源 JSON 转本项目 schema，可重复执行
- 生物贴图：已从 1.20.4 jar 提取；带电苦力怕护层、铁傀儡裂纹、村民职业等变体延后
- 旧 `assets/minecraft/textures/entity/player/uv/wide.json`、`slim.json` 在新玩家模型验收后删除（删除前确认）

## 5. 预览行为契约（来自 WPF 参考实现）

### 物品栏玩家预览

- 正交相机，视野宽 28 模型单位，相机在模型半高正前方
- 模型高 32 单位，显示高 = player 区域高 - 12 基准像素，上下边距各 6 基准像素，随缩放等比
- 模型脚底对齐区域底边 + 6 基准像素
- 跟随基准点是脖子（模型 y=24，脚底为 0）；光标相对脖子与显示器四边的距离归一化到 -1..1
- 身体偏航 ±45°，身体俯仰 ±10°，头部相对脖子额外俯仰 ±10°；鼠标向上时仰头

### 皮肤预览（预览窗口承担）

- 透视相机 FOV 45°，3/4 俯视机位（参考 (-50, 25, -50) 看向模型中部）
- 左键拖拽旋转，位移 × 0.5 为旋转增量
- 透明背景；wide/slim 按皮肤类型选模型（WPF 旧实现一律 wide，是缺陷，新实现修正）

## 6. MC 渲染规则

- 长方体骨骼模型：骨骼树（parent/pivot/rotation），长方体（origin/size/inflate/逐面 UV/mirror）
- 贴图最近邻采样，无 mipmap，透明部分 alpha cutout
- 按面固定亮度：顶 1.0、底 0.5、南北 0.8、东西 0.6（S2 用游戏截图校验）
- 动画统一为关键帧轨道：每骨骼 rotation/position 随时间线性插值，loop/once + duration
- 静态姿态 = 单帧动画；vanilla 正弦程序动画（末影龙扇翅等）烘焙成循环关键帧，全系统只有一种播放机制
- 姿态切换 200ms 交叉淡入

## 7. 数据来源（S1 验证后冻结）

候选：

- 模型：Mojang/bedrock-samples 官方 geometry JSON（box UV 与逐面 UV 两种形式）；社区 Java 模型 Blockbench/JSON 转换（逐面 UV，与 Java 贴图最匹配）
- 动画：skinview3d MIT 关键帧（idle/walk/run/fly/wave）；vanilla 姿态常数转录（蹲下/坐姿/拉弓/三叉戟/游泳/鞘翅）；基岩官方 animation JSON
- 生物动画：基岩官方 animation JSON 或按 vanilla 行为公式烘焙（摆肢公式 cos(limbSwing*0.6662)*amount 等是权威常数）

验证要点：四个生物 + 玩家的覆盖度、与 Java 贴图的 UV 匹配、许可证、末影龙多骨骼动画的表达。结论写回本节。

贴图版本结论：本机 jar 在 `D:\game\Minecraft\.minecraft\versions`；现有 assets 的 steve.png 与 1.20.4/1.21.1 一致，26.1.2 有修订；生物贴图取 1.20.4，与现有资源同版本。

## 8. 通宵执行步骤（细化）

### S1 数据源冻结

1. 研究代理结论回收：模型源、动画源、姿态常数来源、许可证
2. 下载权威 geometry：player(humanoid)、creeper、iron_golem、villager、ender_dragon
3. 定 schema 并写转换脚本，产出 `assets/models/entity/*.json`
4. 校验：玩家 head/body UV 与已知 64×64 皮肤布局对照（head 正面 8,8；body 正面 20,20）；生物贴图尺寸与模型 textureWidth/Height 一致
5. 结论与来源 URL 写回第 7 节

### S2 渲染核心

1. `npm install three`（唯一新增依赖，已获委托）
2. model.ts：schema → three.js 骨骼树 + 长方体网格，逐面 UV、inflate、mirror、alpha cutout、面亮度
3. scene.ts：正交/透视相机、透明背景、最近邻采样
4. animation.ts：关键帧轨道播放、loop/once、200ms 交叉淡入
5. 校验：headless 浏览器渲染 steve 正面/侧面/背面截图，与 MC 标准形象目视比对；UV 探针（给贴图打标记验证面朝向）

### S3 动画与姿态库

1. 玩家：idle/walk/run/wave/fly 从 skinview3d MIT 数据移植；crouch/sit/bow/trident 从 vanilla 常数转录
2. 生物：creeper walk、iron_golem walk、villager walk、ender_dragon fly，基岩 animation JSON 或 vanilla 公式烘焙
3. 校验：探针读关键时间点骨骼角度断言；每个姿态截图与参考比对

### S4 预览窗口

1. `pages/entity-preview.html` + `src/windows/entityPreview.ts`，窗口配置进 tauri.conf.json
2. 左侧 3D 视口 + 右侧控制面板，功能见第 10 节
3. 校验：headless 打开页面，逐个切换实体/皮肤/姿态截图检查；拖拽旋转用真实鼠标事件探针

### S5 物品栏集成

1. 隐藏窗口 `entity-view` + `entity_frame` 命令 + Rust 合成进 player 区域
2. 头部跟随：原生侧算角度发事件，离屏窗口应用
3. 显隐联动：物品栏隐藏停渲染，显示补帧；皮肤配置变化重载
4. 校验：Rust 合成单测（PNG 解码 + 区域合成像素断言）；离屏页面 headless 出帧验证；整链路代码走查。真实桌面端效果留给用户验收，不启动用户实例

### S6 收尾

1. 设置面板皮肤入口：按现有 config player 分组接入（皮肤路径、wide/slim、打开预览窗口）
2. 全量构建：tsc + vite build + cargo check + cargo test
3. 删除旧 UV JSON（先向用户确认，通宵期间保留不删）
4. 更新本文件进度与验收结论，整理留给用户的验收清单

## 9. 依赖与风险

- three.js 是唯一新增依赖（方案已确认并获全权委托）
- 网络：GitHub 下载按本机代理规则处理，代理不可用时直连或换源
- 基岩与 Java 模型差异：经典四生物同源，若发现结构差异以 Java 贴图布局为准修正并记录
- 末影龙动画若基岩无现成 JSON：按 vanilla EnderDragon 程序公式烘焙循环关键帧
- 不启动用户桌面端验证；整链路视觉效果明天用户验收
- 提交只在用户明确要求时做，通宵改动保留在工作区

## 10. 预览窗口规格

窗口 `entity-preview`，页面 `pages/entity-preview.html`，常规尺寸约 1000×680，可调整大小，进任务栏。左侧 3D 视口，右侧控制面板（约 280 宽）：

- 实体选择：玩家 / 苦力怕 / 铁傀儡 / 村民 / 末影龙，下拉
- 皮肤（仅玩家）：9 张默认皮肤下拉 + wide/slim 切换 + 自定义皮肤文件选择（系统文件对话框）
- 动作/姿态：按当前实体列出可用项（玩家全姿态库；生物各自 walk/idle/fly），下拉 + 播放/暂停 + 速度滑杆（0.25-2x）
- 相机：左键拖拽旋转、滚轮缩放、右键平移（可选）、重置视角按钮、自动旋转开关
- 显示：背景切换（深色 / 棋盘格，检查透明）、线框开关（校验模型结构）
- 状态栏：当前实体、骨骼数、动画时间、FPS

预览窗口直接跑 three.js，不回读；与离屏窗口共用 entity3d 模块。

## 11. 验收矩阵

| 项 | 方法 | 通过标准 |
|---|---|---|
| 玩家模型 | headless 截图三视角 + UV 探针 | 与 MC 标准形象一致，皮肤面朝向正确 |
| 四个生物模型 | headless 截图 + 贴图尺寸核对 | 结构与游戏一致，UV 无错位 |
| 姿态库 | 骨骼角度探针 + 每姿态截图 | 角度等于权威值，姿态可辨认 |
| 动画播放 | 探针读时间轴 | 循环/单次/淡入正确 |
| 预览窗口 | headless 逐项操作截图 | 全部控件可用 |
| 物品栏合成 | Rust 单测 + 离屏出帧 | 合成像素正确，帧流稳定 |
| 构建 | tsc/vite/cargo check/test | 全绿 |