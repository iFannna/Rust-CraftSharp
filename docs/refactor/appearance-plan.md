# 外观页与应用图标实施计划

## 目标

设置面板外观页按老 WPF 版补齐功能；应用图标一处选择，同时作用于系统托盘、任务栏窗口图标、打包 exe 的程序文件图标与相关快捷方式。实体 3D 入口迁到「调试」页。

## 外观页基线

1. 图标：显示当前应用图标，点击打开「选择应用图标」
2. 主题：跟随系统 / 暗色 / 亮色
3. 字体：跟随系统 / 微软雅黑 / 像素字体 / Unifont / 宋体 / 楷体 / 黑体
4. 字体大小：10 / 12 / 14 / 16 / 18 / 20

底部「恢复默认设置」重置本页配置与全部图标。旧版「图标样式」已废弃，不做。

图标选择按老版分类：方块（全部/建筑/染色/功能/自然/红石）、物品（全部/战斗/食物/原材料/刷怪蛋/工具），另有默认应用图标。贴图取 26.3 官方资源，分类来自同名 `data/categories.json`。

## 应用图标行为

选中图标后：

- 系统托盘立即替换
- 所有窗口图标立即替换，任务栏与 Alt-Tab 同步
- 打包 exe 的资源图标替换，资源管理器中的文件图标更新
- 桌面、开始菜单、任务栏固定项中指向本程序的快捷方式，图标位置改写为当前 exe

实现要点：

- 托盘与窗口：Tauri 托盘和窗口 API，启动时从保存的图标源恢复，避免闪默认图标
- exe：运行时改写 RT_GROUP_ICON(32512) 与 RT_ICON；运行中的 exe 不能直接写，先生成副本改资源，再把当前 exe 改名、副本放回原路径，进程继续从改名后的文件运行
- 目录只读时通过 UAC 提权启动自身完成替换，取消授权则回到界面提示，不静默失败
- 默认图标：构建时原 `icon.ico` 编入程序，重置时把 exe 资源与三处图标一起还原
- 贴图取首帧方形区域，按最近邻生成 16/24/32/48/64/128/256 多尺寸 ICO，保持 MC 像素风
- 配置只存图标 id，源图存应用配置目录 `app-icon.png`；旧 `trayIcon` 与 `tray-icon.png` 自动兼容
- 开发构建不改 exe 资源，避免 cargo 重建覆盖；托盘与窗口照常生效

已知边界：新版本安装会替换 exe，文件图标回到默认，托盘与任务栏仍按配置恢复；已固定的任务栏按钮可能受系统图标缓存影响，取消固定再固定即可。

## 文件

- `apps/desktop/src/config/appConfig.ts`：`appearance.appIcon`，旧字段迁移
- `apps/desktop/src/settings/appIcons.ts`：贴图注册、分类、源图导出
- `apps/desktop/src/settings/components/appIconPicker.tsx`：图标选择对话框
- `apps/desktop/src/settings/sections/appearanceSection.tsx`：图标行、错误提示
- `apps/desktop/src/settings/sections/debugSection.tsx`：调试页
- `apps/desktop/src/settings/index.tsx`、`settings.css`、`i18n/locales/*`
- `apps/desktop/src-tauri/src/appicon/mod.rs`：流程编排、托盘/窗口图标、持久化
- `apps/desktop/src-tauri/src/appicon/ico.rs`：ICO 解析与多尺寸生成
- `apps/desktop/src-tauri/src/appicon/exe.rs`：资源替换与文件交换
- `apps/desktop/src-tauri/src/appicon/shell.rs`：快捷方式改写、图标缓存刷新、UAC 提权
- `apps/desktop/src-tauri/src/icons/shell_windows.rs`：快捷方式图标写入
- `apps/desktop/src-tauri/src/main.rs`：命令注册、启动恢复、提权入口
- `apps/desktop/vite.config.ts`：实体预览页构建入口

## 进度

- [x] 外观页、调试页、图标选择
- [x] 统一 appIcon 命名与迁移
- [x] ICO 生成与 exe 图标补丁
- [x] 窗口图标与快捷方式
- [x] UAC 提权重试
- [x] 前端接入与构建校验

## 验证

- `npm run build`（tsc + vite）通过；`cargo check` 无警告
- `cargo test` 12 项通过：ICO 目录往返、Windows 加载生成的多尺寸 ICO、exe 图标资源替换、快捷方式图标改写、内置默认图标解码
- 运行中 exe 改名再放回新文件，已用普通进程副本实测通过
- 管理员提权与实际任务栏图标刷新需在打包环境手动确认，未在开发会话中触发 UAC
