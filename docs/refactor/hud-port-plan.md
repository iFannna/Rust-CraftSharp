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
- P1 已完成：副手槽渲染，22×22 原版贴图、右槽水平翻转、间距 7、命中区 20×20，窗口固定宽度 240 倍缩放
- P1 已验证：6x 副手槽场景框体与空槽逐像素一致，快捷栏与左右副手之间双向拖拽交换正常
- P1 未完成：物品栏、3D 玩家预览、设置面板
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

已修正：空气满格时隐藏 empty 背景，只画 full，和 WPF 一致。

副手槽场景（黄金图 `2560x1440-100-statusbar-offhand.png`）在 6x 下对比：容差 3 时差异 17495/509760 = 3.43%，全部落在图标内部，原因是 Chromium 与 WPF 的大倍数缩放算法不同；框体、空槽、状态区逐像素一致。证据见 `docs/refactor/diff-offhand-6x.png`。

采集缺口：4K 场景（9 倍缩放）里 WPF 窗口宽度 2160 超过当前屏幕，副手槽列没有渲染出来，`3840x2160-100-statusbar-offhand.png` 仍是纯核心容器，暂缺 4K 副手基准。

结论：整数倍可以做到逐像素一致；小数倍受 WPF 半像素布局影响，无法与整数倍同等对齐。当前 WPF 在 1920 下是 4.5x，改成整数倍会让 HUD 整体尺寸变化约 ±11%。

证据文件：

- `docs/refactor/canvas-6.png`
- `docs/refactor/diff-6.png`
- `docs/refactor/canvas-4.5.png`
- `docs/refactor/diff-4.5.png`

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
- 证据：`docs/refactor/icon-workbench.png`、`icon-lnk-shortcut.png`、`icon-lnk-target.png`

### P1 快捷栏交互契约

- 几何：`src/hud/layout.ts` 统一算出状态行、经验条、快捷栏位置；命中区是 20×20 基准外扩 2，图标区 16×16，选中框 24×23 且上沿在 `hotbarTop - scale`
- 状态机：`src/hud/hotbarInteraction.ts`，按下启动 150ms 定时，定时器触发后再移动超过 10 像素才进拖拽；未进拖拽的松开一律按点击处理，与 WPF 等价
- 数据：`src/hud/slotStore.ts`，键为 `hotbar_0` 到 `hotbar_8`，暂存 localStorage `craftsharp.slots.v1`，两个窗口用 storage 事件同步；迁移 settings.json 时只替换这一层
- 文件操作：`src/hud/slotActions.ts` + Rust `platform` 模块，命令是 `open_path`、`reveal_path`、`run_path_as_admin`、`path_exists`、`copy_to_clipboard`、`read_clipboard_paths`、`rename_path`
- 菜单：独立 `slot-menu` 窗口，`menu.html?items=` 传菜单项，点击后 emit `menu:select` 并关闭；失焦或 Esc 关闭，可以超出 HUD 边界
- 文件名：DOM 覆盖层，Unifont `8×scale`，距底 `50×scale`，阴影为文字色 50%，偏移 `0.53×scale`，2000ms 后 500ms 线性渐隐
- 自动配色：.NET 字符串哈希每个进程随机，这里改用 FNV-1a 稳定哈希，预设色表与原实现一致
- 缺失文件：图标回退屏障，选中时不显示文件名，打开时弹确认并可清空所有同路径格子
- 副手槽：全局索引 0 左、1 右，与快捷栏共用拖拽和菜单；选中框只画在主快捷栏，和 WPF 一致
- 窗口宽度固定为 240 倍缩放（副手槽列始终占位），隐藏副手槽时两侧是透明区域
- 长按判定同时看定时器和按下时间戳，后台窗口被节流时仍能按时进入拖拽
- 副手槽显隐暂时由 URL 参数 `?offhand=both|left|right` 控制，设置面板接入后改读配置
- 证据：`docs/refactor/hud-interaction-select.png`、`hud-context-menu.png`、`hud-drag-swap.png`、`hud-offhand-6x.png`

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
- hover 白色蒙版 50%，停留 300ms 后转绿色蒙版 44%
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
