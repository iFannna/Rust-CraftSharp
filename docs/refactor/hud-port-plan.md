# CraftSharp 重构需求与迁移计划

## 0. 当前进度

- 新项目根目录：`D:\develop\code\rust\CraftSharp`
- WPF 项目只保留黄金图采集代码，作为视觉基准
- `assets` 已原样复制到新项目，后续新项目以内置资源为准
- P0 已完成：应用内 `--golden-capture` 采集模式，输出到 `docs/refactor/golden`
- P0 已覆盖：状态栏、BOSS 条、物品栏、准星，4 个分辨率与 DPI 场景
- P1 已跑通：`apps/desktop`，Tauri 2 + React + Vite，状态栏 Canvas 渲染器
- P1 已验证：生命、饥饿、空气、护甲、伤害吸收、经验条、快捷栏和选中框使用原版 PNG 正常渲染
- P1 已验证：独立 HUD 窗口透明、无边框、置顶、贴主屏工作区底部居中，尺寸按当前缩放公式计算
- P1 已加入：快捷栏图标层，文件图标走 HighQuality，占位图走 NearestNeighbor，位置按原 slot 内边距
- P1 已完成：真实文件图标提取，Rust 侧 `slot_icon` 命令返回 Data URL，图片直读、其余走 Shell 大图标、文件丢失回退屏障
- P1 已验证：exe、文件夹、图片、dll、文件丢失、.lnk 快捷方式（含目标图标开关）在画布上显示正确
- P1 已完成：快捷栏交互层，滚轮回绕、1-9、Enter、Q、单击与双击模式、hover、长按拖动交换、文件拖入、右键菜单、文件名 2000ms 渐隐
- P1 已验证：点击选中与文件名、滚轮首尾回绕、数字键、hover 规则、拖拽交换、剪切半透明、菜单删除/剪切/粘贴、Q 丢弃、打开命令
- P1 已完成：副手槽渲染，22×22 原版贴图、右槽水平翻转、间距 7、命中区 20×20，窗口宽度按可见副手槽列收缩
- P1 已验证：6x 副手槽场景框体与空槽逐像素一致，快捷栏与左右副手之间双向拖拽交换正常
- P1 已修复：格子图标误用状态图标 9 像素，改为按格子 16 MC 像素绘制并等比居中，任意缩放都正确
- P1 已完成：物品栏渲染，15 种容器样式、坐标 JSON 定位格子、图标、hover 蒙版、灰色蒙版、窗口显隐与位置记忆
- P1 已加入：物品栏交互，单击/双击打开、长按拖拽交换、Shift 批量移动、中键分发、Q 丢弃、右键菜单
- P1 已完成：拖入悬浮反馈、图标后台解码与缓存、首次交互预热、中键分发手势对齐原版
- P1 已验证：物品栏 6x 与黄金图逐像素一致，差异只在图标内部抗锯齿
- P1 已完成：物品栏 Tooltip，九宫格背景与边框、Unifont 文本、自动换行、右侧显示超界翻转
- P1 已完成：准星与攻击指示器，屏幕居中、鼠标穿透、进度裁剪；6x 与黄金图逐像素一致
- P1 已完成：设置面板，6 个分区（系统、外观、HUD、物品栏、快捷键、关于），统一配置读写，窗口 1080×720 无边框
- P1 已完成：全局热键，Win32 RegisterHotKey，四项默认 Ctrl+Alt+S/H/E/C
- P1 已调整：移除卡片式主界面，改为系统托盘菜单 + 全局热键作为入口，主窗口只留隐藏宿主
- P1 已完成：统一配置，`src/config/appConfig.ts`，字段对齐 AppSettings，兼容旧物品栏配置迁移
- P1 已重做：设置面板视觉，按原版 Fluent 风格实测截图对齐，深色 #202020、卡片 #2D2D2D、系统蓝 #0078D4、微软雅黑 14、每项一张卡片
- P1 已修复：设置窗口拖动抖动与始终置顶，取消透明窗与 topmost，改为不透明可调大小并进入任务栏
- P1 已修复：热键事件负载从组合键字符串改为下标映射，全局热键实测可切换窗口
- P1 已修复：状态栏与物品栏拖动抖动，位置回写在停止拖动后落盘，忽略自身 setPosition 回声，拖动时不再重算尺寸或重载图标
- P1 已修复：恢复的窗口位置超出当前工作区时夹回屏幕，完全在屏幕外则回到默认位置
- P1 已补齐：热键注册失败项写入共享存储，设置面板提示被占用的组合键
- P1 已修复：状态栏与物品栏改为自绘拖动，按指针位移逐帧 setPosition，修掉原生拖动结束后的偏移
- P1 已补齐：设置面板下拉框改为自绘 Fluent 菜单，选中项左侧蓝条，贴边自动翻转与回收
- P1 已补齐：系统页记住窗口位置、窗口大小与选中页，恢复时夹回工作区
- P1 已整理：HTML 入口统一到 `pages/`，窗口引导到 `src/windows/`，共享工具到 `src/lib/`，HUD 按状态栏/槽位/物品栏/提示/准星/BOSS 分子目录；导入统一走 `@/` 与 `@assets/` 别名
- P1 已完成：BOSS 血条窗口，四层贴图叠加、Unifont 逐字符居中、名称行高对齐原版、顶部居中、按启用项显隐
- P1 已完成：BOSS 血条设置分区，新增/删除/启用、名称、颜色、分段、数据映射、自定义数值
- P1 已完成：系统指标命令 `system_metrics`，电池、内存、CPU 走 Win32，GPU 走 PDH 3D 引擎占用，1 秒采样
- P1 已补齐：HUD 像素级穿透，画布不透明区域合并成窗口区域 `SetWindowRgn`，透明像素不再接收鼠标；顶层窗口过程方案对 WebView 子窗口无效，已弃用
- P1 已修复：窗口拖动改为 Rust 侧按物理像素跟随系统光标，每 4ms 一次 `SetWindowPos`，不再走前端指针位移，修掉 DPI 取整抖动；拖动期间不回写配置，避免写配置触发窗口回位
- P1 已重做：设置面板按原版 Accordion 结构，HUD 合并为一页，卡片展开 200ms、收起 150ms，下拉菜单淡入，导航与开关补过渡
- P1 已补齐：HUD 元素配置，生命、饥饿、空气、护甲、吸收、经验条各自支持显隐、数据映射、自定义当前值与最大值；状态栏布局按显隐重力收拢
- P1 已补齐：准星置顶、攻击指示器数据映射与自定义进度、状态栏记住位置、记住卡片状态
- P1 已补齐：设置面板字体与字号，原版 6 种字体与 10-20 号字号；开机自启写入 HKCU Run；局部快捷键丢弃与打开物品栏
- P1 已补齐：元素图标样式，生命/伤害吸收 6 种、饥饿 2 种、经验条普通与跳跃，设置面板内切换并即时预览
- P1 已修复：状态栏行间距按 WPF 的 Margin 规则重算，行与行间距为 1 基准像素，不再按 -1 的水平图标间距计算；隐藏元素后按 StackPanel 底部堆叠真实下落，最下面一项仍保留自己的下边距
- P1 已修复：状态栏窗口尺寸跟随可见内容，副手槽隐藏时不再保留两侧占位；元素与副手槽显隐时窗口按底边和核心容器锚定一次改完位置与尺寸，隐藏后上方内容向下填补，显示时向上撑开
- P1 已修复：元素显隐闪烁的根因是 wry 在 `WM_SIZE` 里重设 WebView 尺寸（`webview2/mod.rs` 的 `parent_subclass_proc`），Chromium 要重建合成面并重排，新内容晚一到三帧才到。现在 WebView 固定在最大内容尺寸、永不重排，窗口矩形变化只是裁剪：画布按 `maxLayout` 尺寸绘制、内容贴左上，Rust 侧 `hudview` 拦掉 `WM_SIZE` 并用 `set_bounds` 把视图钉死一次，`set_window_bounds` 只改窗口矩形
- P1 已调整：命中区域始终在画布坐标上计算，画布与窗口左上角重合，不再需要按偏移换算或平移已有区域
- P1 已调整：文件名覆盖层按内容宽高定位，画布比窗口大时仍然贴内容底边居中
- P1 已调整：状态栏不再把恢复的位置夹回工作区，可以拖到屏幕边缘之外；位置记录附带内容高度，换缩放比例时按底边还原
- P1 已补齐：伤害吸收多行，每行 10 个向上堆叠，行距为 1 减行数偏移，最多减 7，负间距时按原版层叠绘制顺序从最后一个槽位开始画
- P1 已补齐：生命值动画，数值变化时容器闪烁 200ms、停 100ms、再闪烁 200ms，掉血位置叠加闪烁图标；空气值减少时 bursting 200ms；饥饿值饱和度按自定义值叠加
- P1 已调整：元素数值判定与原版一致，自定义值关闭时一律走数据映射，数据映射开关只控制设置面板的映射来源展开
- P1 已补齐：单实例，命名互斥体 `Local\CraftSharp.SingleInstance` 保证只跑一份，第二次启动通过命名事件唤醒已有实例打开设置后直接退出
- P1 已补齐：桌面图标显隐，`Ctrl+Alt+D` 查找 Progman 下的 SysListView32 并切换可见性，设置面板快捷键页加入对应项
- P1 未完成：3D 玩家预览、壁纸引擎、皮肤上传
- 未实测项：右键菜单的打开位置、管理员运行、重命名会真的动桌面文件或弹窗；原生文件拖入需要从资源管理器拖，未自动化。本轮只验证了打开命令与路径判断
- 图标链路实测：`SHGFI_ICON + SHGFI_LARGEICON + SHGFI_USEFILEATTRIBUTES` 与不带 `USEFILEATTRIBUTES` 结果逐字节相同，.lnk 得到带角标的快捷方式图标
- 图标已知差异：Chromium 不能解码 TIFF，`.tif/.tiff` 会回退占位图；其余原版支持的图片格式都能直读
- 小数倍对齐：4.5x 在最优对齐下差异 10.9%，来自 WPF 自身的小数布局取整，整数倍 6x 为 0%
- 已知问题：主预览窗口在多窗口启动时会被放到屏幕外 -25600，HUD 窗口位置正常

首次构建与运行：

```powershell
cd D:\develop\code\rust\CraftSharp\apps\desktop
npm install
npm run build
CARGO_NET_OFFLINE=true npm run tauri dev
```

构建注意：全局 `CARGO_HOME/config.toml` 写死了 `127.0.0.1:7897` 代理。代理未启动时，cargo 会直接失败；用 `--config 'http.proxy=""'` 拉取依赖，依赖齐了之后用 `CARGO_NET_OFFLINE=true` 构建和启动，不改全局配置。

### P1 像素对齐结论

对比对象是 WPF 黄金图和 Canvas 输出。黄金图已按当前机器环境重新采集，本节数字都基于新基准。

| 缩放 | 画布尺寸 | 比较区域 | 差异像素 | 差异占比 | 结论 |
|---|---|---:|---:|---:|---|
| 6x | 1440×354 | 1092×222 | 0 | 0.00% | 整数倍逐像素一致 |
| 4.5x | 1080×266 | 819×200 | 约 19900 | 10.9% | 半像素布局取整不同，最优对齐 dx=131 dy=1 |

物品栏（`2560x1440-100-inventory.png`）在 6x 下 1056×996 全画布比较：差异大于 8 的像素 250 个，占 0.024%，全部在图标内部；容器背景、格子位置、空槽逐像素一致。玩家预览区域两边都是黑色占位。

已修正：空气满格时隐藏 empty 背景，只画 full，和 WPF 一致。

快捷栏图标区修正后（6x，核心区 1092×354）与黄金图比较：容差 8 时差异 528 像素，0.14%，全部在图标内部抗锯齿，框体、空槽、图标位置逐像素一致。

副手槽场景（黄金图 `2560x1440-100-statusbar-offhand.png`）在 6x 下对比：容差 3 时差异 17495/509760 = 3.43%，全部落在图标内部，原因是 Chromium 与 WPF 的大倍数缩放算法不同；框体、空槽、状态区逐像素一致。证据见 `docs/refactor/evidence/diff-offhand-6x.png`。

采集缺口：4K 场景（9 倍缩放）里 WPF 窗口宽度 2160 超过当前屏幕，副手槽列没有渲染出来，`3840x2160-100-statusbar-offhand.png` 仍是纯核心容器，暂缺 4K 副手基准。

结论：整数倍可以做到逐像素一致；小数倍受 WPF 半像素布局影响，无法与整数倍同等对齐。当前 WPF 在 1920 下是 4.5x，改成整数倍会让 HUD 整体尺寸变化约 ±11%。

证据文件：

- `docs/refactor/evidence/canvas-6.png`
- `docs/refactor/evidence/diff-6.png`
- `docs/refactor/evidence/canvas-4.5.png`
- `docs/refactor/evidence/diff-4.5.png`

重新采集基线时，从 WPF 仓库根目录执行：

```powershell
dotnet run --project .\CraftSharp.csproj -- --golden-capture D:\develop\code\rust\CraftSharp\docs\refactor\golden
```

### P1 图标提取契约

- 命令：`slot_icon(path, showTargetIcon) -> string | null`，返回 Data URL，路径无效或提取失败返回 `null`
- 图片文件（png/jpg/jpeg/bmp/gif/tiff/webp）：读原始字节直接给浏览器解码，不预缩放，缩放交给 Canvas 的 HighQuality
- 其余文件与文件夹：`SHGetFileInfoW` 大图标 32×32，Rust 转 RGBA 后手写 PNG 编码，不引入图像编码依赖
- `.lnk` 且 `showTargetIcon` 为真：`IShellLinkW` 解析目标路径后取目标图标；为假直接用快捷方式自身图标（带系统角标）
- 缓存键为「开关 + 路径」，失效条件是文件大小与修改时间变化；前端按同一键缓存 Promise
- 返回 `null` 时前端回退 `barrier.png` 并 `smooth=false`，对应 WPF 的 NearestNeighbor 占位图
- 证据：`docs/refactor/evidence/icon-workbench.png`、`icon-lnk-shortcut.png`、`icon-lnk-target.png`

### P1 快捷栏交互契约

- 几何：`src/hud/statusbar/layout.ts` 统一算出状态行、经验条、快捷栏位置；命中区是 20×20 基准外扩 2，图标区 16×16，选中框 24×23 且上沿在 `hotbarTop - scale`
- 图标尺寸：`layout.slotSize` 是格子图标边长（16 MC 像素），与状态行 `iconSize`（9 MC 像素）分开；绘制走 `drawUniform` 等比居中，对应 WPF 的 `Stretch="Uniform"`，非正方形图片会留边而不是被拉伸
- 状态机：`src/hud/statusbar/interaction.ts`，按下启动 150ms 定时，定时器触发后再移动超过 10 像素才进拖拽；未进拖拽的松开一律按点击处理，与 WPF 等价
- 数据：`src/hud/slots/store.ts`，键为 `hotbar_0` 到 `hotbar_8`，暂存 localStorage `craftsharp.slots.v1`，两个窗口用 storage 事件同步；迁移 settings.json 时只替换这一层
- 文件操作：`src/hud/slots/actions.ts` + Rust `platform` 模块，命令是 `open_path`、`reveal_path`、`run_path_as_admin`、`path_exists`、`copy_to_clipboard`、`read_clipboard_paths`、`rename_path`
- 菜单：独立 `slot-menu` 窗口，`menu.html?items=` 传菜单项，点击后 emit `menu:select` 并关闭；失焦或 Esc 关闭，可以超出 HUD 边界
- 文件名：DOM 覆盖层，Unifont `8×scale`，距底 `50×scale`，阴影为文字色 50%，偏移 `0.53×scale`，2000ms 后 500ms 线性渐隐
- 自动配色：.NET 字符串哈希每个进程随机，这里改用 FNV-1a 稳定哈希，预设色表与原实现一致
- 缺失文件：图标回退屏障，选中时不显示文件名，打开时弹确认并可清空所有同路径格子
- 副手槽：全局索引 0 左、1 右，与快捷栏共用拖拽和菜单；选中框只画在主快捷栏，和 WPF 一致
- 窗口宽度只包含可见的副手槽列，核心容器始终 182 倍缩放
- 长按判定同时看定时器和按下时间戳，后台窗口被节流时仍能按时进入拖拽
- 副手槽显隐暂时由 URL 参数 `?offhand=both|left|right` 控制，设置面板接入后改读配置
- 证据：`docs/refactor/evidence/hud-interaction-select.png`、`hud-context-menu.png`、`hud-drag-swap.png`、`hud-offhand-6x.png`、`hud-icons-6x.png`、`diff-icons-6x.png`

### P1 物品栏契约

- 入口：`inventory.html` + `src/inventory.ts`，独立窗口 `inventory`，默认隐藏，桌面上由工作台按钮或后续全局热键显隐
- 样式：`src/hud/inventory/styles.ts` 静态导入 15 张容器图与 14 份坐标 JSON；`tab_inventory.png` 没有独立坐标，回退到 `inventory.json`，与原实现一致
- 布局：`src/hud/inventory/layout.ts` 按容器图片原始像素乘缩放，格子位置直接取自 JSON 的 x/y/width/height；`player` 坐标不生成格子
- 渲染：`src/hud/inventory/renderer.ts`，背景 `NearestNeighbor` 铺满，图标 16 MC 像素等比居中，hover 白色 50% 与绿色 44% 用 `fillRect` 叠在格子上
- 交互：`src/hud/inventory/interaction.ts`，hover 250ms 转绿，点击打开跟随单击/双击配置（双击阈值 500ms），长按 150ms 加 10 像素进入拖拽交换
- Shift 批量：从快捷栏与背包互换首个空位，装备、合成、副手移到背包首个空位；扫过已填充的格子会继续搬运，与原实现的扫格行为一致
- 中键分发：按住中键扫过空格子会复制同一文件，源格子保留
- Q 丢弃：按下时丢弃当前悬浮格子，按住扫过其他格子继续丢弃，松开重置
- 数据：共享模式复用 `craftsharp.slots.v1`，独立模式写 `craftsharp.styleSlots.v1`，按样式隔离；快捷栏格子与 HUD 共用同一份数据
- 配置：`src/hud/inventory/config.ts` 暂存 localStorage，字段对齐 `AppSettings.Inventory`；锁定位置默认开启，未锁定时按住容器空白拖动窗口
- 灰色蒙版：独立 `overlay` 窗口，覆盖主屏，背景黑 75%，`setIgnoreCursorEvents` 鼠标穿透，显隐与物品栏联动
- 窗口：打开时按记住的位置恢复，无效则居中；位置变化即写入配置
- 未实现：Tooltip 窗口、3D 玩家预览、灰底联动隐藏状态栏、全局热键、设置面板
- 证据：`docs/refactor/evidence/inventory-6x.png`、`diff-inventory-6x.png`、`inventory-hover-green.png`

### P1 BOSS 血条契约

- 入口：`pages/bossbar.html` + `src/windows/bossbar.ts`，窗口 `bossbar`，默认隐藏，透明无边框、不进任务栏
- 位置：贴主屏顶部水平居中，宽度固定 182 倍缩放，不记忆位置、不可拖动
- 布局：名称行占 16/3 基准像素，名称上边距 3、下边距 1、条高 5、条间距 4；首条顶部在 9.33 基准像素
- 绘制：四层叠加，底层背景、分段背景、进度、分段进度；进度按百分比裁剪宽度，图标用 NearestNeighbor
- 名称：Unifont `8×scale` 逐字符绘制，字间距 `1×scale`，整体水平居中，黑色阴影偏移 `0.53×scale`
- 数值：自定义值优先，取 `current/100`，与原版一致；否则走数据映射，最后回退 100%
- 数据映射：Rust `system_metrics` 返回 0-1 的电池、内存、CPU、GPU 占用；CPU 用 GetSystemTimes 差值，GPU 用 PDH `GPU Engine` 3D 引擎累加后截断
- 刷新：有数据映射时每秒刷新一次，配置变化立即重算尺寸、位置与显隐
- 验证：6x 画布 1092×196 与黄金图对齐后差异 2.2%，全部在文字字形；血条与分段部分逐像素一致；4.5x 差异 8.6%，9x 差异 7.3%，后两者来自 WPF 文本行高按缩放产生的 1-3 像素出入
- 证据：`docs/refactor/evidence/bossbar-canvas-6x.png`、`bossbar-canvas-4.5x.png`、`bossbar-canvas-9x.png`、`settings-bossbar.png`

### P1 设置面板与桌面外壳契约

- 统一配置：`src/config/appConfig.ts`，键 `craftsharp.config.v1`，分区 system、appearance、statusBar、hotbar、inventory、hudElements、bossBars、hotkeys、player；旧 `craftsharp.inventory.v1` 首次启动自动迁移
- 窗口：`main`、`hud`、`inventory`、`overlay`、`settings`、`crosshair`、`tooltip`、`bossbar`，除 main 外全部无边框透明；main 是隐藏宿主，只负责初始化与托盘事件，不再显示界面
- 页面入口：`apps/desktop/pages/*.html`，窗口引导在 `src/windows/`，设置是唯一 React 应用入口 `src/settings/index.tsx`
- 窗口控制：`src/lib/windowControls.ts`，显隐与配置持久化集中在这里，主界面、设置面板、热键共用
- 设置面板：`src/settings/`，六个分区，左栏导航加右侧滚动内容，无边框自绘标题栏；所有修改立即写配置，窗口显隐联动走 windowControls
- 折叠卡片：`components/accordion.tsx`，HUD 与物品栏按原版分成可折叠卡片，头部 56 高，内容区高度动画，卡片状态跟随“记住卡片状态”
- HUD 页：状态栏、快捷栏、生命值、饥饿值、空气值、护甲值、伤害吸收、经验条、准星、攻击指示器、BOSS 血条；元素配置写在 `hudElements.elements`
- 显隐重力：`computeLayout` 接受显隐配置，隐藏元素后上方行下落，快捷栏与经验条也可隐藏，窗口尺寸随之重算
- 像素穿透：`src-tauri/src/hitmask.rs` + `src/lib/hitMask.ts`，画布 alpha 合并成矩形后 `SetWindowRgn`；文件名文字矩形单独并入形状，拖动期间临时恢复整窗形状避免图标被裁剪
- 拖动：物理像素位移，缩放系数从 Tauri scaleFactor 读取，拖回逻辑坐标后落盘；拖动开始立即放开整窗区域，指针移出可见像素仍能收到事件
- 准星：`src/hud/crosshair/layout.ts` 与 `src/hud/crosshair/renderer.ts`，整屏透明窗口 + 鼠标穿透，准星 15×15、攻击指示器 16×4/16×16，间距 1 MC 像素，进度默认 100%
- 准星像素验证：6x、进度 50% 时内容裁剪 96×102，与黄金图逐像素一致，差异 0
- Tooltip：独立窗口，九宫格边框 3 MC 像素、内边距 3、字号 8、最大宽 150、阴影为文字色 50% 偏移 0.53；显示在格子右侧，超右翻转、超上下贴边
- 热键：Rust `src-tauri/src/hotkeys.rs` 用 RegisterHotKey 加独立消息线程，命令 `register_hotkeys(actions)`，事件 `craftsharp-hotkey`；前端 `src/lib/hotkeys.ts` 监听并调用窗口开关
- 入口：系统托盘菜单（打开设置、状态栏、物品栏、准星、退出），左键托盘打开设置；主窗口隐藏且不进任务栏
- 目录：`src/config` 统一配置，`src/lib` 热键与窗口控制，`src/hud/{shared,statusbar,slots,inventory,tooltip,crosshair,bossbar}` 按职责拆分，`src/windows` 只做窗口引导
- 宿主：`src/App.tsx` 无界面，启动恢复窗口显隐、监听托盘动作、按配置决定是否自动打开设置
- 设置面板视觉：对齐原版 WPF-UI Fluent，深色底 #202020、卡片 #2D2D2D、强调色 #0078D4、微软雅黑 14、220 侧栏加 Segoe Fluent 图标、每项独立卡片、40×20 开关；亮色 #F3F3F3 底加白卡片，主题只作用于设置面板
- 设置窗口：不透明、`decorations: false`、可调整大小（最小 720×480）、不置顶、进任务栏，标题栏自绘最小化/最大化/关闭，关闭只隐藏
- 已验证：设置面板三个分区截图、准星逐像素、Tooltip 渲染、物品栏样式热切换（漏斗 705×533）、配置跨窗口传播、热键命令返回空失败列表
- 已验证：全局热键真实按键切换设置窗口；设置面板深色与浅色主题、热键输入捕获与即时重注册
- 未实测：托盘图标在系统托盘区的实际展示与菜单点击（UIA 查不到，Windows 11 默认收进溢出区）、真实窗口拖动与缩放、开机自启注册表写入
- 已实测：窗口区域为复杂区域，四角与空白处不在区域内（`GetWindowRgn` 返回 COMPLEXREGION，`PtInRegion` 为假）
- 已验证：状态栏行间距重写后，6x 状态行区域与黄金图差异 0 像素；伤害吸收 6 行场景画布 1440×474，饱和度与半心位置正确，证据 `docs/refactor/evidence/statusbar-multirow-6x.png`
- 已验证：窗口尺寸跟随内容，默认无副手槽时画布 1092×354，只开左副手槽时 1266×354，核心容器位置与黄金图状态行仍为 0 差异
- 未实测：真实桌面上的点击穿透手感与窗口拖动，按用户要求不再启动可见窗口做交互测试
- 原版基线：`docs/refactor/evidence/wpf-settings-*.png`，8 个页面离屏采集
- 证据：`docs/refactor/evidence/hud-icon-styles.png`、`settings-hud-v4.png`、`settings-hud-light-v4.png`、`settings-inventory-v4.png`、`settings-hotkeys-v4.png`、`settings-appearance-v4.png`、`hud-visibility.png`、`settings-v3-system.png`、`crosshair-6x.png`、`tooltip-6x.png`、`settings-bossbar.png`

## 1. 目标

- 从 .NET 8 + WPF 迁移到 Tauri 2 + Rust + Web UI
- 目标平台 Windows、macOS、Linux，先以 Windows 为主
- 动态壁纸最终全平台，但第一阶段只实现 Windows
- Minecraft 启动器是后续功能，不参与本轮架构
- 设置面板按常规现代 UI 实现，功能对齐即可

## 2. 硬性需求

- HUD 与设置面板是当前产品的核心，HUD 的显示与交互优先级最高
- HUD 必须复刻当前 WPF 项目的显示逻辑，不按 MC 原版重新设计
- 直接使用仓库 `assets` 中从原版 MC jar 解压的图片、字体、UV、坐标 JSON
- 不重画、不替换、不重新压缩、不用系统图标替代原版资源
- 保持坐标、间距、绘制顺序、缩放、图标变体、回退规则、动画和交互一致
- 视觉基准是当前 WPF 版本，不是 MC 原版文档
- 新栈只替换执行层，不改变画什么、画在哪、什么时候画
- 验收方式是黄金图逐像素对比加交互脚本，设置面板只做功能验收

## 3. 当前缩放规则（必须保留）

当前 `ScaleService` 使用逻辑屏幕宽度计算：

```text
scaleFactor = 逻辑屏宽 / 2560 * 6
```

实际结果：

| 场景 | 逻辑宽度 | scaleFactor |
|---|---:|---:|
| 1920 物理，100% | 1920 | 4.5 |
| 2560 物理，100% | 2560 | 6 |
| 2560 物理，150% | 1706.7 | 4 |
| 3840 物理，100% | 3840 | 9 |
| 3840 物理，200% | 1920 | 4.5 |

当前是小数倍缩放，配合 `NearestNeighbor`、`UseLayoutRounding`、`SnapsToDevicePixels` 使用。若要和当前版本逐像素一致，新渲染器必须复现同一公式；改成整数倍属于产品变更，需要单独确认。

## 4. 技术栈

- 壳：Tauri 2
- 后端：Rust workspace
- HUD：Canvas 2D 渲染，直接绘制现有 PNG，不使用 DOM 拼像素 HUD
- 设置：DOM + 现代组件
- 3D 皮肤：three.js + skinview3d，参数对齐现有 HelixToolkit 模型
- 壁纸：平台层 trait，Windows 先实现，视频后端保持可替换
- 平台能力：Windows、macOS、Linux 各自实现，未实现平台返回不支持

## 5. 分层

- `crates/hud-spec`：布局常量、坐标、资源映射、交互状态机
- `crates/platform`：窗口、热键、托盘、文件图标、拖放、显示器、DPI
- `crates/wallpaper`：壁纸引擎，Windows 先行
- `crates/launcher`：启动器预留，暂不实现
- `apps/desktop`：Tauri commands、events、窗口生命周期
- `ui`：HUD Canvas 与设置界面

## 6. HUD 元素清单

| 元素 | 主要文件 | 关键资源 | 关键规则 |
|---|---|---|---|
| 状态栏壳 | `windows/statusbar/StatusBarWindow.xaml.cs`、`.xaml` | 无 | 核心宽度 182 基准；五列布局；底部居中；隐藏组件后上方组件下落 |
| 生命值 | `StatusBarWindow.Hearts.cs` | heart 47 个变体 | 9x9；`maxValue/2` 槽位；container/half/full 三层；间距 -1 基准；闪烁 1000ms 两次 |
| 饥饿值 | `StatusBarWindow.Food.cs` | food 8 个 | 9x9；右对齐；empty/full/half；饱和度叠加在上方 |
| 空气值 | `StatusBarWindow.Air.cs` | air 3 个 | 9x9；右对齐；只有 full/empty；减少时 bursting 1000ms |
| 护甲值 | `StatusBarWindow.Armor.cs` | armor 3 个 | 9x9；左对齐；empty/full/half |
| 伤害吸收 | `StatusBarWindow.Absorbing.cs` | heart/absorbing | 每行 10 个；上限 1024；最多 52 行；行间距随行数递减，最多减 7 |
| 经验条 | `StatusBarWindow.ExpBar.cs` | experience_bar 4 个 | 182x5；按百分比裁剪；普通条与跳跃条两种样式 |
| 快捷栏 | `StatusBarWindow.Hotbar.cs` | hotbar 3 个 | 182x22；格子 16、间距 4、边距 3；选中框 24x23；副手槽 22x22；副手间距 7 基准 |
| 准星 | `windows/crosshair/CrosshairWindow.*` | crosshair 4 个 | 15x15 屏幕居中；攻击指示器 16x4/16x16；间距 1 基准；100% 时只显示 full |
| BOSS 血条 | `windows/bossbar/BossBarWindow.*` | boss_bar 22 个 | 182x5；7 种颜色；4 种分段；四层叠加；Unifont 8px 逐字符；1 秒刷新 |
| 物品栏 | `windows/inventory/InventoryWindow.*` | 15 种容器图 + 14 个坐标 JSON | 176x166 基准；格子由 JSON 定位；hover 白色 50%，长按 300ms 转绿色；灰色蒙版默认 75% |
| Tooltip | `windows/inventory/InventoryTooltipWindow.*` | tooltip 2 个 | 84x84 九宫格，边框 3；内边距 3；Unifont 8；最大宽度 150 |
| 3D 玩家预览 | `windows/inventory/PlayerPreviewControl.*` | 皮肤 + UV JSON | 模型高 32；显示高 58；上下边距 6；身体偏航 ±45°，俯仰 ±10°，头部额外 ±10° |
| 皮肤预览 | `windows/skinpreview/SkinPreviewWindow.*` | 皮肤 + UV JSON | 透视相机；拖拽旋转；wide/slim 两套 UV |

## 7. 交互规则

### 快捷栏

- 滚轮循环切换选中，范围是主快捷栏 0-8，首尾回绕；未选中时第一次滚动选中第一格
- 数字键 1-9 直接选中对应格子
- Enter 打开当前选中文件，空格子则清除选中
- Q 丢弃当前选中格子
- 单击或双击模式可配置；双击模式下先选中再点一次才打开
- 长按 150ms 后移动超过 10 像素进入拖拽，落点在另一格则交换内容；Shift 批量移动与中键分发只在物品栏
- hover 在无选中或悬停的就是选中格时显示选中框
- 文件拖入格子后写入数据并刷新图标
- 右键菜单：打开、打开位置、管理员运行、复制路径、剪切、复制、粘贴、删除、重命名
- 选中后显示文件名，2000ms 后 500ms 渐隐；颜色支持自动和自定义，阴影为文字色 50%

### 物品栏

- 格子坐标来自 `assets/minecraft/textures/gui/container/coordinate/*.json`
- 支持 15 种容器样式，格子数量从 37 到 90 不等
- `player` 坐标区域渲染 3D 玩家预览，不创建普通格子
- hover 白色蒙版 50%，停留 250ms 后转绿色蒙版 44%
- 支持 Tooltip、灰色蒙版、打开时隐藏状态栏
- 支持共享数据或每种样式独立数据
- 支持窗口拖动、锁定、记忆位置
- 双击判定阈值 500ms
- Shift 批量移动、Q 丢弃、中键分发、拖拽交换
- 文件丢失时显示占位图，确认后清理所有同路径格子

## 8. 共享服务

| 服务 | 职责 |
|---|---|
| `SlotDataService` | 格子数据，持久化到 `settings.json` 的 `Slots` 与 `StyleSlots` |
| `SlotIconService` | 图标加载、渲染模式、占位图、快捷方式目标图标 |
| `SlotDragService` | 长按检测、拖动状态、格子内容交换 |
| `SlotClipboardService` | 剪切、复制、粘贴状态 |
| `SlotContextMenuService` | 右键菜单与文件操作 |
| `SlotFileValidator` | 文件丢失与恢复检测 |
| `DataMappingService` | BatteryLevel、MemoryUsage、CpuUsage、GpuUsage |
| `FontService` | YaHei、Pixel、UniFont、SongTi、HeiTi、KaiTi |
| `ScaleService` | 按逻辑屏宽计算小数倍缩放 |
| `ThemeService` | 系统、浅色、深色主题 |
| `LocalizationService` | zh-CN、en-US 资源切换 |
| `IconExtractor` | Windows Shell 图标、快捷方式、图片缩略图；已落到 `src-tauri/src/icons`，`slot_icon` 命令返回 Data URL |
| `ImageService` | BitmapImage 加载与尺寸读取 |
| `HotkeyService` | 全局热键注册与冲突处理 |

## 9. 配置与设置

`AppSettings` 顶级分组：

- `System`：语言、自启动、默认打开面板、设置窗口位置与大小、导航记忆
- `Appearance`：主题、字体、字号、应用图标
- `Inventory`：显隐、锁定、位置、灰色蒙版、点击模式、样式、共享数据、hover、Tooltip
- `StatusBar`：显隐、锁定、位置
- `Hotbar`：副手槽、显隐、点击模式、hover、目标图标、文件名颜色
- `HudElements`：每个 HUD 元素的显隐、图标样式、数值映射、自定义值
- `BossBars`：每个 BOSS 条的名称、颜色、分段、数值映射
- `Player`：皮肤路径、皮肤类型、默认皮肤
- `Hotkeys`：桌面图标、设置、状态栏、准星、物品栏、丢弃、打开物品栏
- `Slots` / `StyleSlots`：格子数据
- `Wallpaper`：壁纸配置，单独迁移
- `Version`：配置版本

设置面板：system、appearance、wallpaper、skin、hud、inventory、hotkey、about。使用常规现代组件，不纳入像素级还原和黄金图范围。

## 10. 资源清单

- 纹理总数 2051
- heart 47，food 8，armor 3，air 3，experience_bar 4，crosshair 4，hotbar 3，boss_bar 22，tooltip 2
- 容器图 15 张，坐标 JSON 14 个，格子数 37 到 90
- entity 20，item 793，block 1113
- 字体：`unifont-16.0.04.ttf`、`zpix.ttf`
- 语言：`Strings.zh-CN.xaml`、`Strings.en-US.xaml`
- 皮肤 UV：`assets/minecraft/textures/entity/player/uv/wide.json`、`slim.json`
- 资源保持原格式与像素尺寸，不用重新压缩或重新采样

## 11. Windows 平台集成

- 透明无边框置顶窗口
- 从 Alt+Tab 隐藏
- 鼠标穿透与临时可交互切换
- 原生文件拖放与拖拽缩略图
- 全局热键
- 系统托盘与单实例
- 每显示器 DPI 感知
- Shell 打开文件、打开位置、管理员运行
- 删除到回收站
- 壁纸 WorkerW、`IDesktopWallpaper`、视频后端
- 硬件传感器：电池、CPU、内存、GPU

这些能力统一放在平台层，不进入 HUD 渲染逻辑。

## 12. 迁移顺序

1. P0：冻结资源与规格，建立黄金图采集工具
2. P1：状态栏壳、生命、饥饿、空气、护甲、吸收、经验条、快捷栏
3. P2：准星、攻击指示器、BOSS 血条
4. P3：物品栏、Tooltip、3D 玩家预览
5. P4：皮肤预览、设置面板
6. P5：Windows 壁纸引擎
7. P6：macOS、Linux 的 HUD、设置、静态壁纸
8. 启动器后续单独排期

## 13. 黄金图验收

采集维度：

- 分辨率：1920、2560、3840
- DPI：100%、125%、150%、200%
- 缩放：1920 的 4.5、2560 的 6、2560@150% 的 4
- 主题：浅色、深色
- 语言：zh-CN、en-US
- 图标样式：默认、hardcore、poisoned、withered、frozen、vehicle、absorbing
- 数据状态：0、半满、满、超上限、文件丢失
- 布局：单屏、多屏、任务栏位置变化

HUD 逐像素差异目标为 0。设置面板只验证功能和布局，不做像素对比。

交互脚本至少覆盖：

- 滚轮首尾回绕
- 数字键 1-9
- Enter 打开
- Q 丢弃
- Shift 点击与长按移动
- 中键复制与分发
- 拖拽交换
- 单击与双击模式
- 文件丢失与恢复
- 物品栏样式切换与共享数据切换

## 14. 待确认

- 缩放：保持当前小数倍以逐像素一致，还是改为整数倍
- HUD 范围：仅主屏（当前行为），还是每屏独立
- 设置面板：保持 Fluent 风格，还是改成 MC 像素风
- 动态壁纸视频后端：WebView 播放、mpv 子进程、原生解码，先做原型对比
- 资源分发：安装包继续内置从 jar 解压的资源，保持现有方式

## 15. 原生状态栏（当前实现）

- 状态栏不再由 WebView2 渲染，改为 Rust 原生分层窗口，机制在 `src-tauri/src/hud`
- `UpdateLayeredWindow` 一次调用同时提交预乘 BGRA 位图、窗口尺寸和位置，窗口跟随可见元素变化时不存在中间帧
- `hud` WebView 窗口改为隐藏控制器，只负责把配置、格子数据推给 `hud_apply`，并处理 `hud-open`、`hud-drop`、`hud-swap`、`hud-menu`、`hud-files`、`hud-moved` 事件
- 系统指标采集、数值映射、生命闪烁、空气破裂、文件名标签计时迁到 Rust，用 `SetTimer` 驱动
- 透明像素即穿透，不再需要 hit mask；命中测试沿用原 drop 矩形规则
- 交互：长按 150ms 且移动超过 10px 开始拖拽，滚轮 2 到 10 回绕，右键弹出菜单窗口，文件拖放按落点入槽；未锁定时按住空白区域拖动窗口
- 窗口几何锚定：底边固定，核心容器水平中心固定，尺寸变化不跳位
- 已验证：启动自动绘制、元素显隐后窗口高度跟随且底边不动、PNG 与 Shell 图标绘制、整体显隐命令
- 待验证：真实鼠标的长按拖拽与右键菜单、文件拖放入口、HiDPI 多屏切换

## 16. 窗口交互补全

- 文件拖放统一走 OLE：`src-tauri/src/dragdrop.rs` 实现 `IDropTarget` 并调用 `IDropTargetHelper`，缩略图与复制/禁止光标由系统绘制
- 拖放目标必须注册到 WebView2 的子窗口：wry 就是用 `EnumChildWindows` 逐个接管子窗口的，只注册顶层窗口收不到任何拖放事件；本次按同样方式枚举子窗口注册，坐标与缩略图仍以顶层窗口为基准
- 状态栏按布局下发 9 个快捷栏加副手的接受区域；物品栏由页面把格子矩形（客户区物理像素）下发给 `set_drop_zones`，区域按窗口标签共享，注册前到达也会保留
- 落点事件 `file-dropped` 携带窗口、格子 id、路径与客户区坐标，状态栏和物品栏各自写自己的格子
- 落点为空时只显示缩略图和禁止光标；注册前先撤掉 wry 的目标，WebView 不会自己打开拖入的文件
- 缩略图助手的方法顺序必须按 shobjidl.h：DragEnter、DragLeave、DragOver、Drop、Show。写成 DragEnter、DragOver、DragLeave 会让每次 DragOver 实际调用 DragLeave，图像刚出现就被收掉，表现就是「拖拽时没有缩略图」
- 拖出到桌面或资源管理器：拖动图标离开格子区域就转为系统拖放，`SHCreateDataObject` 提供 CF_HDROP，`IDragSourceHelper` 提供图标预览。只提供复制，原路径文件不动；交接瞬间先把格子图标清空，落点放下一份副本后清空数据，取消则把图标还回格子
- 拖出判定范围是快捷栏整行含副手加 2 MC 像素余量，物品栏是全部格子的外接矩形加 4 像素；鼠标离开格子区域立刻接管，不用先穿过状态行或容器边框
- 拖动浮层是独立的置顶鼠标穿透小窗口（`hud/dragicon.rs`），只装一枚图标并跟随光标；状态栏窗口仍然只按可见元素计算尺寸，浮层不会被窗口边界裁掉，也不需要收拢停在边缘
- 浮层显示后必须 `SetWindowPos(HWND_TOPMOST)` 提到置顶窗口带最前：不带激活的显示会落在最底下，被同样置顶的状态栏盖住
- 物品栏从交接开始到拖放结束前，该格子不参与图标刷新（`dragOutSlot`），否则拖动过程中刷新会把它闪回一帧
- 拖出是否按住用两个来源判断：OLE 传入的 grfKeyState 与发起时的全局键态，任一显示按住就继续，避免某个线程读到过期键态导致拖拽刚开始就被取消
- 拖拽助手由 `CLSID_DragDropHelper` 创建，接受与拖拽图像是两个 IID：`IDropTargetHelper` 为 4657278B，`IDragSourceHelper` 为 DE5BF786；用同一个 GUID 取两个接口会拿到空对象，拖出时没有跟随图标
- 窗口显隐关闭 DWM 过渡：`DWMWA_TRANSITIONS_FORCEDISABLED` 是属性 3，属性 2 是 `DWMWA_NCRENDERING_POLICY`，写成 2 会让 DWM 停止绘制非客户区，设置面板出现白边且过渡动画照旧
- 局部快捷键：任何应用窗口聚焦时 E 开关物品栏、ESC 关闭物品栏，输入框内不触发；状态栏在原生输入里认 E
- 拖动手感：早于长按的移动不再取消长按；移动超过阈值后松开不算点击，不会误开文件；落点交换先在原生侧交换图标缓存，避免源格闪回；拖动时目标格显示选中框
- 已验证：8 个窗口含子窗口共 40 多个拖放目标全部注册成功；物品栏下发 46 个区域、状态栏下发 9 个；按区域中心模拟落点后 `file-dropped` 分别写入 `craftsharp.styleSlots.v1` 与 `craftsharp.slots.v1`；拖拽图像与拖拽助手随数据对象一起创建；DWM 属性 3 写入成功
- 待验证（需要真实鼠标手测）：拖拽经过时缩略图与光标的实际观感、拖出到资源管理器是否复制一份并清空格子、物品栏首次显示的动画是否彻底消失

## 17. 拖入反馈与图标性能

- 拖入悬停：`dragdrop` 记录每个目标当前命中的区域，只在变化时经 `set_hover_handler` 回调；快捷栏在原生层写入 `drop_hover` 并优先于选中显示选中框，物品栏接收 `drag-hover` 事件画白色蒙版，DragLeave/Drop 清除
- 物品栏的清除延迟 60ms：WebView2 子窗口之间切换会先离开再进入，立即清会闪一帧
- 悬停效果关闭时不显示拖入高亮
- 图标解码后台化：`icons` 统一按「路径 + 修改时间 + 目标尺寸」缓存，同一 key 只解码一次；图片等比缩放居中输出固定方块，超过 4 倍缩小时改用 Triangle 滤波
- 状态栏图标在后台线程解码，完成后经 `run_on_main_thread` 按 key 安装；交换格子时 key 跟随交换仍能对应；新图标就绪前保留旧图标，不闪空
- 物品栏 `slot_icon` 改为 async + `spawn_blocking`，返回目标尺寸的 Data URL，原图不再整份过 IPC，也不在 WebView 里全尺寸解码；尺寸取格子宽度，上限 128
- 拖拽图像复用同一份解码缓存，不再单独全尺寸解码
- 首次交互卡顿：Unifont 改为后台预解析后交给窗口线程，第一次显示文件名不再解析 12MB 字体；系统指标改由后台线程每秒采集再投递回窗口线程，首次 GPU PDH 枚举不再占用消息循环；`system_metrics` 命令同样改为 async
- Tooltip 窗口启动后预热一次（8×8 透明、屏幕外显示后隐藏），首次悬停不再现创建合成层
- 中键分发按原版语义：中键按在有文件的格子拿起副本，源格图标保留；按住左键扫过空格每格复制一次；左键抬起补一次落点复制并结束；中键抬起不结束；分发期间右键被吞，左键不再起长按；中键的 mousedown 与 auxclick 阻止浏览器默认行为
- 已验证：cargo test 6 项通过；前端 tsc 与 vite build 通过；CDP 真实鼠标事件下「中键+左键扫格」与「中键点一下再左键点空格」都只复制到空格且源格保留
- 待验证（真实鼠标）：拖入高亮观感、500KB 图片拖入与剪切粘贴手感、首次悬停与选中是否还卡
- 拖出后落回原格子：Drop 目标记录来源窗口与 zone，落点与来源完全一致时按取消处理，不写回也不清空；`begin_file_drag` 返回 `dropped`、`window`、`zone`、`sameSource`，快捷栏与物品栏据此还原图标
