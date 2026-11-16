# 设置面板与弹窗 UI 统一实施计划

## 已确认

- 视觉方向：先做 B，直接采用 shadcn/ui 中性风；实际效果不满意再回 A（Fluent 暗色紧凑）。
- 标题栏：macOS 使用原生红绿灯置左，Windows / Linux 保持右侧自绘。
- 字体：只内置 Unifont，其余选项使用跨平台系统字体栈。
- 本批范围：只做视觉，不改平台能力、菜单动作和业务逻辑。

## 目标

- 设置窗口、图标选择、重命名、确认框、右键菜单、3D 预览侧栏使用同一套颜色、间距、圆角、控件和动效。
- 暗色 / 亮色、中英文、字号设置在以上窗口全部生效。
- 清除 Windows 专用图标字形和 Windows 专用字体依赖，保证三端可渲染。
- HUD 与物品栏保持像素皮肤，不引入 Tailwind 和全局重置。

## 非目标

- 不补 Linux / macOS 的平台能力实现。
- 不改右键菜单的文案与动作集合。
- 不改配置结构、窗口位置记忆、HUD 渲染逻辑。

## 技术方案

- Tailwind 3.4 + shadcn/ui（new-york 风格，neutral 基色），组件源码放在 `src/ui`。
- 主题使用 shadcn 的 CSS 变量，`dark` 类挂在文档根节点。
- 独立 Tauri 窗口不使用 shadcn 的模态 Dialog，复用同一套卡片、按钮、输入和颜色令牌。
- 3D 预览侧栏按同一套令牌重绘，保留原生 select / range 与现有 Three.js 逻辑，不改渲染链路。
- 控件尺寸跟随 shadcn 默认桌面密度：按钮和输入 36px，卡片圆角 8px，正文 14px；字号设置仍可整体放大缩小。
- 现有 `controls.tsx` 的对外 API 保持不变，内部换成 shadcn 封装，避免一次性改动 7 个分区。

## 阶段

1. 试点：工程接入、主题根、标题栏、共享控件、外观页、图标选择弹窗；产出暗色与亮色预览。
2. 设置面板全量：系统、HUD、物品栏、快捷键、关于、调试 6 页；折叠卡片与表单行统一。
3. 独立窗口：重命名、确认框、右键菜单、3D 预览侧栏。
4. 清理：删除旧 CSS、扫描 Segoe 字形、补跨平台字体栈。

## 文件

- `apps/desktop/package.json`、`tailwind.config.ts`、`postcss.config.js`、`components.json`
- `apps/desktop/src/ui/styles.css`：Tailwind 入口、shadcn 变量、基础层
- `apps/desktop/src/ui/components/*`：shadcn 组件
- `apps/desktop/src/ui/lib/utils.ts`：`cn`
- `apps/desktop/src/ui/app/*`：ThemeRoot、TitleBar、FieldRow、DialogFrame
- `apps/desktop/src/settings/index.tsx`：窗口壳
- `apps/desktop/src/settings/components/*`：控件封装
- `apps/desktop/src/settings/sections/*`：各设置页
- `apps/desktop/src/settings/fonts.ts`：跨平台字体栈，仅保留 Unifont
- `apps/desktop/pages/rename.html`、`menu.html`、`entity-preview.html`：后续改 React 入口
- `apps/desktop/src-tauri/src/platform/*`：后续删除原生确认框入口

## 验收

- `npm run build` 通过。
- 暗色 / 亮色、中文 / 英文、字号 10-20、缩放 100% / 125% / 150% 逐项检查。
- 图标选择、下拉、开关、快捷键录制、恢复默认行为不变。
- HUD 页面不加载 Tailwind，像素皮肤无变化。
- Linux / macOS 的实际冒烟由用户或 CI 完成。

## 当前结果

- 已接入 Tailwind 3.4 + shadcn/ui new-york neutral，仅保留 button、input、select、switch、checkbox、accordion 六个组件。
- 设置窗口壳、侧栏、标题栏、共享控件、全部 7 个设置页、图标选择弹窗已切到中性风。
- 重命名、确认框、右键菜单改为 React 独立窗口，共用 ThemeRoot、Button、Input、颜色令牌和字体栈。
- 确认框替换了原生 MessageBoxW，Rust 里的 `confirm_dialog` / `alert_dialog` 已删除。
- 3D 预览侧栏按同一套令牌重绘，保留原生 select / range 和现有 Three.js 逻辑，避免改动渲染链路。
- 导航和窗口按钮改用 lucide SVG，移除 Segoe 专用字形。
- 字体只内置 Unifont，其余使用跨平台系统字体栈；Windows 专用字体选项改名为无衬线 / 衬线 / 楷体 / 黑体；旧 `pixel` 配置读取时迁移为 `system`。
- 已验证：暗色 / 亮色、中文 / 英文、字号 20、字体切换、下拉、开关、图标选择与 Esc 关闭、构建和 cargo check 通过。
- 当前体积：settings JS 598.78 kB（gzip 142.62 kB），CSS 28.57 kB（gzip 6.15 kB）。
- macOS：当前三端都使用右侧自绘按钮。原生红绿灯要等 macOS 窗口配置（Overlay / hiddenTitle）一起接入，避免现在出现无按钮窗口。

## 窗口壳统一

- 标题栏统一为 32 高的 Windows 标准，三个按钮 `46×32` 满高贴边，图标统一 16；悬停与配色不变。
- 窗口分两类：展示框（设置、图标选择、3D 预览）三键齐全、可缩放、进任务栏；对话框（确认、提示、重命名）只有关闭键、固定尺寸、进任务栏、置顶。
- 新增 `ui/window-frame.tsx`，统一标题栏、缩放边缘与窗口操作；设置面板一并切到该外框。
- 图标选择从设置面板内嵌 Dialog 改为独立展示窗口，经 `dialog:result` 返回结果；选中即应用并关闭，关闭或 Esc 取消。
- 对话框与展示框都改为整窗外框，去掉透明留白和浮动卡片；窗口标题按当前语言传给任务栏。
- 3D 预览去掉系统标题栏，换成同一套自绘标题栏与缩放边缘，关闭改为隐藏，保留托盘再次打开。
- 删除 `ui/components/dialog.tsx`、`settings/components/appIconPicker.tsx` 和 `@radix-ui/react-dialog` 依赖。
- 权限补齐 `confirm-dialog`、`app-icon-picker`、`entity-preview`。
- `tsc --noEmit` 与 `vite build` 通过；真实窗口冒烟留给用户。

## 滚动条统一

- 共享 `ui/scrollbar.css`：10px 细条、透明轨道、圆角滑块，轨道上下留 8px，隐藏上下箭头与交汇方块；React 窗口和 3D 预览页引同一份。
- 所有滚动容器加 `scrollbar-gutter: stable`，滑块显隐不再改变内容宽度，折叠展开不会引起横向重排。
- 两种可见模式：`ui-scroll` 常驻，用于图标选择分类/网格和下拉列表；`ui-scroll-auto` 默认隐藏滑块，滚动或鼠标进入右侧 24px 时立即显示，停止 1.2 秒后用 0.6 秒缓慢淡出。
- 自动隐藏由 `ui/scrollbars.ts` 统一处理，委托 wheel、pointermove 与 scroll 事件，通过 CSS 变量逐帧改变滑块透明度实现淡出，3D 预览页同样接入。
- 设置面板内容区、确认框长文本、3D 预览控制栏使用自动隐藏；下拉列表自带的上下翻页按钮已删除，面板宽度固定为触发器宽度，避免和下拉框对不齐。

## 设置面板流式布局

- 内容区去掉固定 `max-w-3xl`，改为最宽 1120 并在主区域居中；内边距按窗口宽度在 20–40px 之间平滑变化。
- 侧栏保持 224px 图标加文字，不做折叠。
- 所有分区统一单列，按 HUD 页面这种满宽卡片排布，不再分成两列。
- 设置行保持标签与控件左右排布；控件最多占 55% 且可收缩，窄窗口下长描述换行而不是撑破卡片。
- 下拉最小宽度 140，文本框、数字框、快捷键输入都加了最大宽度限制。
- Boss 血条字段网格改为 `auto-fit`，卡片宽度不足时自动降为一列，名称过长会截断。
- 修复折叠卡片在关闭“记住卡片状态”后无法展开的问题，关闭记忆时仍在当前会话内生效。
- 窗口尺寸记忆与业务行为不变。

## 窗口动效与分屏

- 启动时只对 main、HUD、离屏渲染禁用 DWM 过渡，设置面板、3D 预览、图标选择和对话框保留系统最大化/最小化动画。
- 托盘隐藏设置面板与 3D 预览时先启动系统最小化动画，任务栏按钮立即移除，动画结束后再隐藏窗口；显示时先恢复任务栏按钮，再 `show` / 按需 `unminimize` 并聚焦，不再使用 `AnimateWindow` 淡入淡出。
- 最大化按钮上覆盖一块 46×32 的透明原生子窗口，按 DPI 缩放，窗口过程返回 `HTMAXBUTTON`，Windows 11 悬停时弹出原生分屏布局；最大化时隐藏覆盖层，还原后重新对齐。
- 托盘左键直接由 Rust 切换设置窗口：可见时先最小化再隐藏，隐藏或最小化时显示、恢复并聚焦；菜单“打开设置”始终打开或聚焦。整个切换不依赖前端事件链路。
- 覆盖层接管鼠标，悬停态由 Rust 直接向页面写入 `caption-max-hover` 类，避开事件总线与 React 状态更新带来的延迟；悬停期间每 120ms 检查一次光标是否仍在按钮上，避免非客户区没有离开消息时样式残留。
- 点击同时处理覆盖层客户区消息和父窗口非客户区消息，统一发送 `SC_MAXIMIZE`，并用 300ms 去重。
- 覆盖层监听父窗口的 `WM_SIZE`、`WM_DPICHANGED`、`WM_SHOWWINDOW`，窗口缩放、跨屏和显隐后都重新定位。
- 分屏布局要求窗口最小宽度足够小才能嵌入窄分区；当前设置窗口最小 720，半屏可用，更窄的分区受限。

## 清理

- 已删除不再引用的 `settings.css`、`windows/rename.ts`、`windows/menu.ts`。

## 进度

- [x] 方案对齐
- [x] 试点
- [x] 设置面板全量
- [x] 独立窗口
- [x] 窗口壳统一
- [x] 滚动条统一
- [x] 设置面板流式布局
- [x] 窗口动效与分屏
- [x] 清理
