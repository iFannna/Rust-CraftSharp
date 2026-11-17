# 系统托盘设置实现计划

## 目标

在设置面板的「系统设置」页新增可配置的系统托盘设置：四个鼠标键动作、右键菜单条目显隐与顺序；托盘菜单改为自绘窗口，文案随语言和窗口状态实时生成。

## 共识

### 设置页

- 系统设置页标题下先「基础设置」，再「系统托盘设置」。
- 页面底部保留唯一「恢复默认设置」，同时重置基础设置和托盘设置，沿用现有二次确认。

### 动作

- 动作集合与全局热键一致：无动作、打开菜单、切换设置面板、切换状态栏、切换物品栏、切换准星、切换桌面图标。
- 退出只作为右键菜单固定项，不进入动作下拉。

### 鼠标默认值

- 单击：切换设置面板。
- 双击、中键：无动作。
- 右键：打开菜单。

### 右键菜单

- 条目集合固定：设置面板、状态栏、物品栏、准星、桌面图标；不允许重复、不允许改名称。
- 单卡片列表编辑：拖动手柄、条目标题、显隐开关；隐藏项留在原位变淡。
- 退出固定在最底部，无手柄、无开关、不能隐藏。
- 默认可见：设置面板、状态栏、物品栏；准星、桌面图标默认隐藏。
- 默认顺序：设置面板、状态栏、物品栏、准星、桌面图标，退出在最后。
- 条目文案按当前状态动态生成「显示… / 隐藏…」。
- 不加分隔线。

### 行为

- 双击为「无动作」时，单击立即执行。
- 双击绑定了动作时，单击等待系统双击间隔确认后再执行；双击在间隔内触发双击动作。
- 菜单在光标处弹出，靠近屏幕边缘时回弹；选中立即执行并关闭，Esc、失焦、点击外部关闭。
- 允许隐藏所有进入设置的入口；再次运行程序时单实例直接显示设置面板作为兜底。
- 自绘菜单视觉沿用新版 popover：8px 圆角、1px 边框、6px 内边距、条目圆角 6、跟随应用深浅主题和全局字体字号。

### 配置

- 新增顶层 `tray` 配置节：
  - `clicks.single | double | middle | right`：鼠标动作。
  - `menu`：`{ id, visible }[]`，保存全部条目的顺序与显隐。
- 老配置缺字段时走默认值；菜单数组做去重、补全、未知项过滤。
- 系统页重置写入 `defaultConfig().system` 与 `defaultConfig().tray`。

## 运行时链路

1. Rust 托盘不再挂原生菜单，只保留图标。
2. 左/右/中键抬起时向主窗口发 `tray-pointer`，携带按键与屏幕物理坐标；双击事件忽略，由前端计时判定。
3. 主窗口读取 `tray` 配置：
   - 非左键动作立即执行。
   - 左键按「按需延迟」规则决定单击/双击。
4. 「打开菜单」在光标处弹出 `tray-menu` 窗口，菜单内容按配置顺序、显隐和实时状态生成；固定追加退出。
5. 菜单选中后执行动作；退出调用 Rust `exit_app`。
6. 动态状态来源：
   - 设置面板：窗口 `isVisible`。
   - 状态栏、物品栏：原生窗口状态。
   - 桌面图标：`IsWindowVisible(SysListView32)`。
   - 准星：配置。
   - 系统双击间隔：`GetDoubleClickTime`。
7. 单实例唤醒改为直接显示并聚焦设置面板，不再走切换。

## 涉及文件

- `apps/desktop/src/config/appConfig.ts`
- `apps/desktop/src/settings/sections/systemSection.tsx`
- `apps/desktop/src/settings/sections/system/trayControls.tsx`（新增：动作下拉与菜单编辑器）
- `apps/desktop/src/settings/options.ts`
- `apps/desktop/src/lib/tray.ts`（新增：点击判定、菜单构建、动作执行）
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/hud/slots/menu.ts`、`apps/desktop/src/windows/menu.tsx`
- `apps/desktop/src/i18n/locales/zh-CN.ts`、`en-US.ts`
- `apps/desktop/src-tauri/src/main.rs`、`singleinstance.rs`、`hud/window.rs`、`hud/inventory.rs`、`desktop.rs`
- `apps/desktop/src-tauri/capabilities/default.json`（新增 `tray-menu` 窗口）

## 验收

- 四个鼠标键按配置执行；双击留空时单击无延迟；绑定双击后单击等待双击间隔。
- 菜单顺序、显隐与设置页一致；隐藏项不出现在菜单；退出固定最后。
- 中英文切换后动作下拉、菜单编辑器、菜单文案同步更新。
- 菜单跟随应用深浅主题、字体与字号；屏幕边缘不越界。
- 隐藏所有设置入口后重新运行程序，设置面板直接显示。
- `npm run build` 与 `cargo check` 通过。
