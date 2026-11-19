# 动态壁纸与拼接/多屏实现计划

## 0. 范围与原则

- 动态壁纸、按显示器单独设置、跨屏拼接，以及目标显示器选择界面。
- 原生 Rust 实现，不移植 WPF，不使用 libmpv，也不为每块屏开 WebView。
- 已有静态壁纸保持现状，本轮只做增量。
- 运行时零新增 DLL；新增依赖仅限编译期的 `windows` 0.62（已随 Tauri/WebView2 进入依赖图）。

## 1. mcblock.top 接口现状

2026-11-19 实测：

| 接口 | 状态 | 说明 |
|---|---|---|
| `GET /api/wallpapers` | 公开 | `page`、`limit`、`sort=latest\|popular\|downloads`、`category=desktop\|mobile`、`type=static\|dynamic`、`search` |
| `GET /api/wallpapers/{id}` | 公开 | 详情，同时累加浏览数 |
| `GET /api/wallpapers/{id}/preview?size=800\|1920` | 公开 | WebP，最大 1920 宽 |
| `GET /api/wallpapers/{id}/download?resolution=original` | 需登录 | 未登录 401「下载壁纸需要登录」 |
| `POST /api/wallpapers/{id}/favorite` | 需登录 | 未登录 401 |
| `GET /api/auth/providers` | 公开 | `wechat`、`qq`、`credentials`（邮箱） |
| `GET /api/auth/csrf`、`/api/auth/session` | 公开 | NextAuth 标准端点 |
| `POST /api/auth/send-code`、`login-with-code`、`callback/credentials` | 登录 | 邮箱验证码或邮箱密码 |
| `GET /api/captcha` | 公开 | SVG 图形验证码 |
| `GET /api/site-messages/active` | 公开 | 站点公告 |
| `GET /api/notifications/unread-count` | 需登录 | 未登录 401 |
| `/api/feedbacks`、`/api/analytics/track`、`/api/chat`、`/api/agent/chat` | 非壁纸功能 | 不使用 |

数据规模：全部 946，电脑/平板 590，手机 356；动态共 11（电脑 10、手机 1）。公共接口没有视频地址，动态视频与高清原图全部需要登录。

顺带发现：站点排序值是 `latest / popular / downloads`。当前静态实现用的 `hot` 服务端并不识别，实际退化为最新；下次改动时把它改成 `popular`。

## 2. 关键决策

| 项 | 方案 | 理由 |
|---|---|---|
| 动态解码 | Media Foundation Source Reader + D3D11 | 系统硬解，零额外运行时，内存和启动成本最低 |
| 动态渲染 | D3D11 Video Processor + DXGI 交换链 | 裁剪、缩放、拼接一次完成，无撕裂 |
| 宿主 | WorkerW 子窗口 | 在桌面图标之下、普通窗口之上，天然不可交互 |
| 拼接动态 | 一次解码，多次 Blit | 多屏严格同步，解码开销只有一份 |
| 独立动态 | 每屏一路解码 | 各屏内容独立 |
| 登录 | 内嵌 mcblock.top 登录窗口 + CookieManager 读取会话 | 直接复用站点登录（邮箱/验证码/扫码），不处理密码与验证码逻辑 |
| 凭据保存 | 仅保存 NextAuth 会话 Cookie，DPAPI 加密 | 不落密码；WinHTTP 请求时带 Cookie |
| 多屏 UI | 只做壁纸目标与拼接，不复制系统显示设置 | 不改分辨率/缩放/显示模式，风险与代码量都最小 |
| 拼接裁片 | 按拓扑指纹 + 变换缓存 | 只在显示器或缩放变化时重算 |

## 3. 动态引擎

- 用 D3D11 设备创建 Source Reader，启用硬解与 D3D 管理器；只选视频流，不选音频。
- 帧按时间戳推进；EOS 后回到 0 循环，复用 reader，不重建管线。
- 每帧通过 VideoProcessorBlt 把源画面写入交换链后台缓冲，`Present(1, 0)` 垂直同步。
- 独立模式：每屏一个宿主窗口、一条交换链、一个 reader。
- 拼接模式：一个宿主窗口覆盖虚拟桌面，一个 reader，按每屏目标矩形做多次 Blit；源矩形由拼接变换统一计算。
- 遮挡：前台窗口完整覆盖该路时暂停取帧；桌面（Progman/WorkerW）不算遮挡；恢复后继续。
- 自愈：静态壁纸变化会重建 WorkerW，检测到宿主失效后在当前 WorkerW 原位重建，不重设静态壁纸。
- 帧率跟随视频，不额外插帧；空闲暂停时 CPU/GPU 归零。

## 4. 多屏与拼接

显示器模型：

- 设备路径来自 `IDesktopWallpaper`，作为稳定 key；矩形为物理像素，按左到右排序编号。
- 每屏条目：`{ id, type, localPath, previewPath }`；拼接条目独立一份。

模式：

- `sync`：所有在场显示器同一张图，沿用现有行为。
- `independent`：逐屏指定壁纸，未指定的屏保持现状。
- `span`：一张宽图覆盖虚拟桌面联合矩形。

拼接数学：

- 源矩形：`cover` 基准乘以 1–3 倍缩放，中心加归一化偏移，钳制在源图内。
- 静态：按每屏物理分辨率裁片输出 JPG，缓存键 `topologyFingerprint|zoom|offsetX|offsetY`。
- 动态：同一源矩形直接作为 VideoProcessor 的源裁剪框，所见即所得。
- 预览浮层与最终结果共用同一套计算。

拓扑变化：`WM_DISPLAYCHANGE`、`WM_DPICHANGED` 去抖 800ms 后重排；拔掉的屏跳过但保留配置，插回自动恢复。

## 5. 登录与取图

- 「登录 mcblock.top」打开一个远程 WebView 窗口，直接在站点页面完成登录。
- 登录完成后通过 WebView2 `CookieManager` 读取域下 Cookie，取出 NextAuth 会话令牌，DPAPI 加密写入配置目录；不保存邮箱密码。
- Rust 下载请求带会话 Cookie；登录态生效时优先 `download?resolution=original`，未登录时静态退回 1920 预览。
- 会话过期：动态入口变为禁用并提示重新登录；静态不受影响。
- 不自行拼装邮箱验证码与图形验证码流程，站点改版时只影响登录窗口。

## 6. 数据与文件

配置扩展：

```ts
interface WallpaperConfig {
  mode: "sync" | "independent" | "span";
  currentId: string;
  title: string;
  type: "static" | "dynamic" | "none";
  localPath: string;
  monitors: Record<string, { id: string; type: "static" | "dynamic"; localPath: string; previewPath: string }>;
  span: { id: string; type: "static" | "dynamic"; localPath: string; previewPath: string } | null;
  transforms: Record<string, { zoom: number; offsetX: number; offsetY: number }>;
}
```

旧配置迁移：现有单图字段直接作为 `sync` 状态，其余字段补默认值。

```
src-tauri/src/wallpaper/
  layout.rs       显示器快照、目标计划、差异比较
  span.rs         源矩形、静态裁片与缓存
  dynamic/
    mod.rs        实例调度与热切换
    window.rs     WorkerW 宿主与交换链
    reader.rs     Source Reader、D3D11 渲染与循环
  watch.rs        显示变更、遮挡、宿主存活
```

```
src/settings/wallpaper/
  monitors.tsx    模式切换与显示器选择
  spanCrop.tsx    拼接缩放/偏移预览
```

新增命令保持少而整：`wallpaper_login`、`wallpaper_session`、`wallpaper_apply_layout`。静态单图的应用命令继续复用。

## 7. 实施顺序

1. 多屏模型、显示器选择浮层、静态独立与拼接（不依赖登录，可立即验收）。
2. 内嵌登录与凭据存储，下载改走原图（登录后）。
3. 动态引擎单屏独立播放。
4. 动态多屏独立与跨屏拼接。
5. 显示变更、遮挡暂停、WorkerW 自愈与性能收尾。

## 8. 验证

- 单测：拼接源矩形、拓扑指纹、配置迁移、Cookie 解析。
- 静态多屏：真实双屏下逐屏设置、拼接接缝、拔插恢复。
- 动态：循环无黑帧、切屏同步、遮挡暂停、WorkerW 重建自愈、长时间挂机内存稳定。
- 性能目标：单路 1080p 硬解常驻内存约 30–50MB，遮挡暂停后接近空闲；无额外 DLL。
- 登录失效与网络失败都有明确提示，不阻塞静态壁纸。

## 9. 风险

- 登录依赖站点 NextAuth Cookie；站点改版可能失效，但不会影响静态。
- 公共接口仍限 1920；拼接不登录会有放大，登录后走原图。
- Media Foundation 代码量集中在渲染管线；先做单屏跑通，再扩多屏。

## 10. 实施进度

- [x] 配置扩展：`mode`、`monitors`、`span`、`transforms`，旧单图配置自动兼容
- [x] 显示器枚举与按屏设置，`CLSCTX_ALL` 创建桌面壁纸接口（部分系统仅本地服务注册）
- [x] 独立与同步模式静态壁纸
- [x] 跨屏拼接裁片、缓存与拓扑指纹
- [x] 内嵌 mcblock.top 登录窗口、WebView2 CookieManager 读取会话、DPAPI 加密保存
- [x] 登录后原图/视频下载，未登录静态退回 1920 预览
- [x] 模式切换、显示器选择、拼接裁剪浮层、登录状态与提示
- [x] Media Foundation 硬解 + D3D11 Video Processor 动态渲染
- [x] 遮挡暂停、WorkerW 失效自愈、显示拓扑跟随
- [x] 列表排序改为站点支持的 `popular`
- [x] 动态管线离屏冒烟：真实视频连续渲染 49 帧后正常停止

待真机验收：

- 实际桌面上的静态独立/拼接接缝
- 登录窗口与真实账号的会话读取
- 动态视频在各显示器上的常驻表现与遮挡暂停
- 静态拼接在显示器热插拔后需要重新点击应用（动态会自动跟随拓扑）
