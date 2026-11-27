<p align="center">
  <img src="app-icon.png" alt="CraftSharp" width="120" />
</p>

<h1 align="center">Craft #（CraftSharp）</h1>

<p align="center"><strong>一款 Minecraft 风格的桌面管理应用</strong></p>

<p align="center">
  <a href="https://github.com/iFannna/Rust-CraftSharp/releases">
    <img src="https://img.shields.io/github/v/release/iFannna/Rust-CraftSharp?style=flat-square&color=D97757" alt="Release" />
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-orange?style=flat-square" alt="Tauri + Rust" />
  <img src="https://img.shields.io/github/license/iFannna/Rust-CraftSharp?style=flat-square" alt="MIT License" />
</p>

<p align="center">
  <a href="https://github.com/iFannna/Rust-CraftSharp/releases/latest">下载</a> ·
  <a href="https://github.com/iFannna/Rust-CraftSharp/issues">反馈</a>
</p>

---

## 这是什么

Craft # 把 Minecraft 的界面搬到桌面上：状态栏、快捷栏、物品栏、准星和 BOSS 血条常驻桌面，快捷栏的每一格就是磁盘上的一个文件，同时提供 3D 皮肤预览和桌面壁纸引擎。

界面与交互按 Minecraft 的手感还原，并在此基础上延伸出硬件数据映射和壁纸两块功能。

## 功能

- **HUD**：状态栏、快捷栏、物品栏、准星、BOSS 血条、副手槽完整还原，每个元素都可单独开关和调整
- **原生交互**：鼠标滚轮和键盘切换选中、Shift 点击或长按移动物品、Q 键丢弃、中键复制、拖出到资源管理器，命中检测在原生层完成
- **硬件映射**：电池、内存、CPU、GPU 利用率实时映射到 BOSS 血条等元素
- **快捷栏即文件**：把任意文件拖进格子即可，图标取自系统，支持自动排序和多套样式
- **皮肤**：3D 玩家模型预览，内置皮肤与本地皮肤导入，支持动作与姿态
- **壁纸**：在线浏览 MCBlock 的 Minecraft 风格壁纸，静态与动态、多屏独立与拼接，一键应用到桌面
- **设置**：深浅主题、中文与英文、字体、应用图标、开机自启、托盘、全局热键、存储目录

## 安装

前往 [GitHub Releases](https://github.com/iFannna/Rust-CraftSharp/releases/latest) 下载最新安装包。

Windows 10/11：下载 `CraftSharp_<版本>_Windows_x64-setup.exe` 或对应 MSI，双击安装。安装包自带应用与资源，不需要 Node.js、Rust 或 .NET；界面依赖系统的 WebView2 运行时，Win11 自带，Win10 一般随 Edge 存在，缺失时安装器会引导安装。

Linux（Ubuntu 24.04 amd64，预览）：下载 `CraftSharp_<版本>_Linux_amd64.deb`，把 `<版本>` 换成实际版本号后执行：

```bash
sudo apt install ./CraftSharp_<版本>_Linux_amd64.deb
CraftSharp
```

安装后也可以从应用列表搜索 CraftSharp；程序位于 `/usr/bin/CraftSharp`。依赖 glibc 2.39 与 GStreamer 1.24，Wayland 与 X11 都可用，HUD 经 XWayland 承载。同版本重装需加上 `--reinstall`，卸载执行 `sudo apt remove craftsharp`。

## 开发

环境要求：

- Windows 10/11：Node.js 20 或更高、Rust 1.77 或更高、WebView2 运行时
- Linux（Ubuntu 24.04）：Node.js 20 或更高、Rust 1.77 或更高、WebKitGTK 4.1、GTK3、AppIndicator3 与 GStreamer 1.24 开发包

```bash
cd apps/desktop
npm install
npm start
```

`npm start` 启动 Tauri 开发模式，前端由 `scripts/dev-server.mjs` 服务构建产物，代码改动后自动重建并刷新窗口，首个窗口不必等待现场编译。

```bash
npm run build     # 类型检查 + 前端构建，输出 dist
npm run package   # Windows 安装包，输出到 src-tauri/target/release/bundle
```

Linux 的 deb 用 `apps/desktop/linux/package-deb.sh` 组装，参数依次是版本号、release 可执行文件和输出路径。

## 目录结构

- `apps/desktop/`：桌面应用，`src` 为 React 前端，`src-tauri` 为 Rust 后端，`pages` 为各窗口入口
- `assets/`：运行时使用的 Minecraft 贴图、实体模型、动画与字体
- `reference/`：不参与构建的 Minecraft 参考资料，用途见其 README

## 发布

推送 `vYY.M.D` 形式的 tag 后，GitHub Actions 会构建 Windows 的 NSIS、两个 MSI 和 Linux 的 deb，校验体积和版本后统一上传到 draft release。产物命名为 `CraftSharp_<版本>_Windows_x64-setup.exe`、`CraftSharp_<版本>_Windows_x64_{zh-CN,en-US}.msi` 和 `CraftSharp_<版本>_Linux_amd64.deb`。核对后手动把 draft 转正式。

## 许可

应用代码基于 [MIT License](LICENSE) 开源。

`assets/` 内的 Minecraft 贴图、模型与动画版权归 Mojang，仅用于 Minecraft 相关开发，使用时遵守 Minecraft 最终用户许可协议；字体版权归各原作者；壁纸内容来自 [MCBlock](https://mcblock.top)。

## 致谢

- 创意来源：[沫海 CimiMoly](https://github.com/EnderMo)
- 壁纸来源：[MCBlock](https://mcblock.top)
