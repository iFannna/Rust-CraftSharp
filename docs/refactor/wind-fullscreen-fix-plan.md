# Win+D 全屏游戏失效修复计划

## 问题

CraftSharp 运行时，若有全屏窗口（如 Slay the Spire 2，无边框全屏 popup）且其当前台，Win+D 与任务栏"显示桌面"无法最小化该全屏窗口；关掉 CraftSharp 则正常。普通窗口场景不受影响。

## 根因（已用真实按键对照确认）

`hud/win32.rs::set_desktop_owner` 把 HUD 顶层窗口的所有者设成 `SHELLDLL_DefView`（Progman 的子窗口）。用子窗口当所有者会让 Explorer 的"显示桌面"最小化逻辑在全屏窗口前台时卡死。

真实 Win+D 三组对照（游戏 = Slay the Spire 2）：

| 条件 | 游戏能否被最小化 |
| --- | --- |
| CraftSharp 运行，所有者=DefView | 不能（必坏）|
| CraftSharp 运行，所有者临时清 0 | 能 |
| CraftSharp 停止 | 能 |
| CraftSharp 运行，所有者=Progman | 大部分能，偶尔不能；HUD 不闪留存 |

注意：keybd_event 模拟的 Win+D 与真实按键不等价（模拟触发不了对全屏游戏的真正最小化），验证必须用真实按键。游戏最小化后会自己弹回全屏，延迟快照常读到还原态，以用户实时观察为准。

## 约束（不可破坏）

- HUD 在 Win+D / 任务栏显示桌面时不闪、留在桌面层（图标之上、普通应用之下）。
- 不用守护定时器做 Show-Desktop 层级切换（已验证会闪）。
- 不做 SetParent 到 Progman 的 WS_CHILD 分层窗口（本机不渲染）。

## 修复步骤

### 步骤 1（主修复）：所有者 DefView -> Progman

`hud/win32.rs::set_desktop_owner`：所有者直接用 `desktop_window()`（`GetShellWindow()` = Progman，顶层 shell 窗口），不再查找 DefView 子窗口。保留 `WS_EX_NOACTIVATE` 与 `park_desktop`（HWND_BOTTOM）。更新注释说明 DefView 子窗口所有者会挡全屏 Win+D。

影响调用方：`hud/window.rs:117`、`hud/bossbar.rs:64`、`hud/crosshair.rs:88`（统一生效）。

验证：`cargo check` 通过；重启应用加载新构建；请用户在全屏游戏上多次真实 Win+D，确认游戏能最小化露出桌面，且 HUD/准星不闪留存。

### 步骤 2（备选，仅当步骤 1 后仍偶发失效）：处理 repark 钩子

`hud/input.rs:128 foreground_event` 每次前台变化都调 `repark_desktop_windows()`，对 HUD 连发 `SetWindowPos(HWND_NOTOPMOST)` + `SetWindowPos(HWND_BOTTOM)`。Win+D 最小化全屏游戏时前台切换触发 repark，其 Z 序操作偶尔与 shell 最小化流程撞车，疑似"偶尔不行"的诱因。

先验证去掉/弱化 repark 是否影响不闪与桌面层归位，再决定删除或改为仅在必要时置底。所有者 trick 本身应让 HUD 稳待桌面，repark 可能多余。

## 进度

- [x] 根因确认（真实按键对照）
- [x] Progman 所有者外部验证（不闪保住、大部分修复）
- [x] 步骤 1：改 set_desktop_owner 为 Progman，cargo check 通过，tauri dev 热重载生效，HUD 所有者实测为 Progman
- [x] 步骤 2：repark 暂不处理——用户接受偶发失效（疑似系统侧），影响不大，先提交主修复
- [ ] 更新记忆（window-layering / windows-desktop-layer）

## 结论

主修复落地：所有者 DefView -> Progman，全屏游戏 Win+D 大部分恢复，HUD 不闪留存保住。残留"偶尔不行"用户判定影响不大、疑似系统侧，暂不处理 repark。

另注：CraftSharp 的设置窗口关闭后整个进程会退出（原生 HUD 窗口不属于 Tauri webview 窗口，撑不住进程），验证时需保持设置窗口开启。此为独立现象，不在本修复范围。