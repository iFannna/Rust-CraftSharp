# 静态壁纸实现计划

## 0. 范围

- 本轮只做静态壁纸：浏览、预览、应用、下载。
- 动态壁纸、按显示器单独设置、跨屏拼接、显示器设置弹窗全部不做；配置与代码结构留出扩展位。
- 壁纸源继续使用 `https://mcblock.top`。
- 取图定案：使用公共预览接口，最大 1920 宽；原图接口需要登录，本轮不接账号。
- 仅 Windows 实现；其他平台返回「当前平台未实现」。

## 1. 现状与实测

旧 WPF 静态链路可拆成四段：列表分页、预览窗口、下载缓存、按显示器设置壁纸。可复用的是逻辑，不是代码。

2026-11-18 实测 mcblock.top：

- 列表：`GET /api/wallpapers?category=desktop&page=1&limit=20&sort=latest&type=static`
- 详情：`GET /api/wallpapers/{id}`，不再返回 `originalUrl`
- 预览图：`GET /api/wallpapers/{id}/preview?size=1920`，WebP，实测上限 1920×1075
- 原图：`GET /api/wallpapers/{id}/download` 返回 401「下载壁纸需要登录」
- 响应无 `Access-Control-Allow-Origin`，前端不能直接 fetch，API 请求必须走 Rust
- 列表图是相对路径，Rust 拼接 `https://mcblock.top` 后返回给前端
- 当前共有 590 张静态、10 张动态；分页字段 `page/limit/total/totalPages/hasNext/hasPrev`

旧版关键逻辑保留：

- 强制 Fill：直接写注册表 `HKCU\Control Panel\Desktop` 的 `WallpaperStyle=10`、`TileWallpaper=0`；
  不能调用 `IDesktopWallpaper.SetPosition`，Win11 会异步改回 Fit 导致黑边
- 优先 `IDesktopWallpaper` 按显示器设置；COM 不可用降级 `SystemParametersInfoW`
- 下载失败重试；本地按壁纸 id 缓存；应用成功后清理未引用缓存
- 卡片 10/16 比例、悬浮放大、动态角标、底部标题、加载与失败态、2 秒 Toast

## 2. 关键决策

| 项 | 方案 | 理由 |
|---|---|---|
| HTTP | WinHTTP 原生调用 | 零新依赖，系统 TLS 与代理，体积最小 |
| JSON | serde_json | 已有依赖 |
| 图片转换 | image crate WebP→JPEG | 已有依赖；jpg/png/bmp 对 IDesktopWallpaper 最稳 |
| 应用范围 | 应用到全部显示器，同图 | 第一版不做多屏 UI；与系统「同步」行为一致 |
| 预览 | 设置页内浮层，不开独立窗口 | 共享列表状态，少一个窗口与权限，代码更轻 |
| 缩略图 | WebView 直接加载远端 URL | 无 CORS 限制（img 不受影响），浏览器自行解码 |
| 下载 | 原生保存对话框 + JPEG | 保留旧版「另存为」，修正旧版 PNG 过滤器的错误 |
| 启动 | 不重排壁纸 | Windows 持久化壁纸；静态无 WorkerW 需要重建 |
| 配置 | 最小字段，预留 type | 以后接动态时只加字段，不改现有结构 |

## 3. 页面行为

导航顺序与旧版一致：系统、外观、壁纸、皮肤、HUD、物品栏、快捷键、关于。

壁纸页从上到下：

1. 标题「壁纸设置」
2. 筛选：全部 / 静态 / 动态；排序：最新 / 最热 / 下载量
3. 壁纸网格：`repeat(auto-fill, minmax(200px, 1fr))`，卡片 16/10，随窗口宽度自适应
4. 分页：上一页、第 x / y 页、下一页

卡片：

- 缩略图 800 宽，懒加载；加载中骨架，失败显示占位与「加载失败」
- 动态壁纸左上角「动态」角标
- 底部渐变条显示标题
- 悬浮或键盘聚焦时图片放大 1.06，显示「查看图片 / 设为壁纸」
- 点击卡片或 Enter 打开预览
- 动态壁纸保留浏览与预览，「设为壁纸」「下载」禁用并提示「动态壁纸暂不支持」

预览浮层：

- 顶部：标题、分辨率、关闭
- 中部：图片，滚轮缩放，放大后可拖拽，双击或「适应窗口」复位
- 底部：上一张、下一张、适应窗口、缩小、放大、下载、设为壁纸
- Esc 关闭，方向键切图
- 应用按钮在处理中显示「设置中...」并禁用

状态：

- 首次加载与翻页：内容区居中加载指示，工具栏保持可用
- 失败：居中错误文案 + 重试
- 成功：Toast「壁纸已设置」，2 秒自动消失
- 下载完成：Toast「下载完成」
- 失败：Toast 显示具体原因

## 4. 数据与配置

配置新增顶层分组：

```ts
interface WallpaperConfig {
  currentId: string;
  title: string;
  type: "static" | "none";
  localPath: string;
}
```

- 默认值全空，旧配置缺字段直接走默认
- 合并时对 `type` 做白名单
- 缓存目录 `app_config_dir()/wallpapers`，文件名为 `<id>.jpg`
- 应用成功后清理目录内其他文件；失败保留，下次覆盖
- 下载默认文件名取壁纸标题，过滤 Windows 非法字符

## 5. Rust 实现

```
src-tauri/src/wallpaper/
  mod.rs      命令入口与编排
  client.rs   列表请求、JSON 模型、URL 拼接
  store.rs    下载、WebP 转 JPEG、原子写入、清理
  desktop.rs  IDesktopWallpaper COM、Fill 注册表、SPI 降级
  save.rs     原生保存对话框
```

命令：

- `wallpaper_list(page, kind, sort) -> WallpaperPage`
- `wallpaper_apply(preview_url, id) -> String` 返回本地路径
- `wallpaper_pick_path(title) -> Option<String>`
- `wallpaper_export(preview_url, path) -> Result<(), String>`

`client.rs`：

- WinHTTP：Open、CrackUrl、Connect、OpenRequest、Send、Receive、Read
- 超时 10/15/15/30 秒，跟随重定向，状态码非 2xx 报错
- JSON 上限 4 MB，图片上限 24 MB；失败重试 3 次
- 只接受 `mcblock.top` 域名的图片地址，相对路径自动补全

`store.rs`：

- 下载 → `image` 解码 WebP → RGB8 → JPEG 质量 92
- 先写 `.tmp` 再改名，避免半截文件
- 已有同 id 文件且非空时直接复用

`desktop.rs`：

- `CoInitializeEx` 后 `CoCreateInstance` 取 `IDesktopWallpaper`
- 枚举 `GetMonitorDevicePathAt`，逐屏 `SetWallpaper`
- 先写 Fill 注册表；任何失败降级 `SystemParametersInfoW`
- COM vtable 只声明到 `GetMonitorDevicePathCount`，不调用 `SetPosition`
- 全部在 `spawn_blocking` 中执行，避免阻塞 UI

`save.rs`：

- `GetSaveFileNameW`，owner 为设置窗口 HWND，默认 `.jpg`，覆盖确认
- 通过 `run_on_main_thread` + Tauri 的 tokio channel 回到异步命令
- 取消返回 null，不报错

## 6. 前端实现

```
src/settings/sections/wallpaperSection.tsx   页面状态与数据流
src/settings/wallpaper/api.ts                类型与 invoke 封装
src/settings/wallpaper/grid.tsx              工具栏、卡片与状态
src/settings/wallpaper/preview.tsx           预览浮层
src/settings/wallpaper/toast.tsx             Toast 与 hook
```

- 进入页面才请求，翻页与筛选重新请求，不预加载全部页
- 缩略图 `loading="lazy" decoding="async"`，单卡失败不影响其他卡
- 应用成功后写配置并保持当前页
- 样式复用现有 Card、Button、Tooltip、滚动条与主题变量
- `ui/icons.tsx` 增加 MonitorIcon，导航插到外观与皮肤之间

## 7. 文案

新增 `nav.wallpaper` 与 `wallpaper.*` 词条，中英两份，覆盖筛选、排序、分页、状态、预览操作、Toast 与动态不支持提示。插值沿用 `{page}`、`{total}`、`{reason}`。

## 8. 验证

- `npm run build` 通过
- `cargo check`、`cargo test` 通过
- 单测：列表 JSON 解析、相对地址拼接、size 参数归一、文件名过滤、配置合并
- 手动：筛选与排序、翻页、缩略图失败态、预览缩放与切图、应用后桌面变化、下载对话框、取消、动态禁用
- 不自动修改你的桌面壁纸；应用与下载由你实际点击验收

## 9. 后续扩展位

- 动态壁纸：配置加 `type: "dynamic"` 与视频路径，Rust 增加 WorkerW 宿主
- 多屏：配置加 `mode`、`monitors`、`span`，前端增加显示器设置弹窗
- 原图：mcblock.top 开放或提供登录凭据后，把取图地址换成原图，其余流程不变
