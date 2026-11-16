# 外观页补齐与调试页实施计划

## 目标

设置面板外观页按老 WPF 版补齐全部功能，并把暂放外观页的实体 3D 入口迁到新的「调试」页。

## 老版基线

外观页四项，顺序与老版一致：

1. 图标：显示当前系统托盘图标，点击打开图标选择窗口
2. 主题：跟随系统 / 暗色 / 亮色
3. 字体：跟随系统 / 微软雅黑 / 像素字体 / Unifont / 宋体 / 楷体 / 黑体
4. 字体大小：10 / 12 / 14 / 16 / 18 / 20

底部「恢复默认设置」重置本页配置。旧版「图标样式（默认/像素/简约/写实）」已废弃，不做。

图标选择窗口按老版分类：方块（全部/建筑/染色/功能/自然/红石）、物品（全部/战斗/食物/原材料/刷怪蛋/工具），另有默认应用图标。图标源用 26.3 的官方方块与物品贴图，分类来自同名 `data/categories.json`。

## 方案

- 图标选择用设置窗口内的模态对话框，不另开 WebView 窗口。理由：主题、字体、缩放自然继承，免去独立窗口的创建、定位与能力配置；交互与老版弹窗等价。
- 贴图用 `import.meta.glob` 打包 32px 预览，`image-rendering: pixelated` 保持像素清晰；列表懒加载，不影响设置页首屏。
- 选中的图标在浏览器端绘制成 32x32 PNG，经命令交给 Rust：立即替换托盘图标，并把 PNG 写到应用配置目录 `tray-icon.png`。Rust 创建托盘前先读该文件，启动即恢复，不出现默认图标闪换。
- 配置只记录图标 id（`block/xxx.png`、`item/xxx.png`，空串为默认图标），像素数据由文件持久化，两者职责不重复。
- 恢复默认设置时同时清掉托盘图标文件并回到应用默认图标。
- 调试页放「默认皮肤、模型类型、自定义皮肤（打开 3D 预览）」三行，位于导航「关于」下方；复用现有 player 配置，不新增字段。
- 字体「跟随系统」使用 CSS 系统字体栈，配置值 `system`。

## 文件

- `apps/desktop/src/config/appConfig.ts`：`appearance.trayIcon`、`UIFont` 增加 `system`
- `apps/desktop/src/settings/fonts.ts`：系统字体栈
- `apps/desktop/src/settings/trayIcons.ts`：贴图注册、分类、32px 渲染、写系统图标
- `apps/desktop/src/settings/components/trayIconPicker.tsx`：图标选择对话框
- `apps/desktop/src/settings/sections/appearanceSection.tsx`：图标行，移除皮肤行
- `apps/desktop/src/settings/sections/debugSection.tsx`：调试页
- `apps/desktop/src/settings/index.tsx`：调试导航
- `apps/desktop/src/settings/settings.css`：图标行与对话框样式
- `apps/desktop/src/i18n/locales/{zh-CN,en-US}.ts`：新增与迁移文案
- `apps/desktop/src-tauri/src/main.rs`：`set_tray_icon` 命令与启动恢复
- `apps/desktop/vite.config.ts`：补入缺失的实体预览页构建入口（调试页按钮依赖）

## 进度

- [x] 配置与字体
- [x] 托盘图标资源与 Rust 命令
- [x] 图标对话框与外观页
- [x] 调试页与导航
- [x] 构建校验
