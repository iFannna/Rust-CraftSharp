#!/usr/bin/env bash
# 组装 Linux deb：固定安装路径、udev 规则与 GStreamer 运行依赖。
set -euo pipefail

version="${1:?版本号，例如 26.11.27}"
binary="${2:?craftsharp-desktop 可执行文件路径}"
output="${3:-CraftSharp_${version}_Linux_amd64.deb}"

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "版本号无效：$version" >&2; exit 1; }
[[ -f "$binary" ]] || { echo "找不到可执行文件：$binary" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "$here/.." && pwd)"
binary="$(realpath "$binary")"
output="$(realpath -m "$output")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
root="$tmp/CraftSharp_${version}_amd64"

mkdir -p "$root/DEBIAN" "$root/usr/bin" "$root/usr/share/applications" \
  "$root/usr/share/icons/hicolor/256x256/apps" "$root/etc/udev/rules.d"

install -m 0755 "$binary" "$root/usr/bin/CraftSharp"
install -m 0644 "$here/craftsharp.desktop" "$root/usr/share/applications/craftsharp.desktop"
install -m 0644 "$app/src-tauri/icons/icon.png" "$root/usr/share/icons/hicolor/256x256/apps/craftsharp.png"
install -m 0644 "$here/70-craftsharp-input.rules" "$root/etc/udev/rules.d/70-craftsharp-input.rules"
install -m 0755 "$here/postinst" "$root/DEBIAN/postinst"
install -m 0755 "$here/postrm" "$root/DEBIAN/postrm"

size="$(du -sk "$root" | cut -f1)"
cat > "$root/DEBIAN/control" <<EOF
Package: craftsharp
Version: ${version}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: iFannna <776393086@qq.com>
Installed-Size: ${size}
Depends: libwebkit2gtk-4.1-0, libgtk-3-0 | libgtk-3-0t64, libayatana-appindicator3-1, gstreamer1.0-libav, gstreamer1.0-plugins-base, gstreamer1.0-plugins-good, libgstreamer1.0-0, libgstreamer-plugins-base1.0-0
Description: CraftSharp desktop HUD
 Minecraft 风格的桌面 HUD、物品栏与壁纸应用。
EOF

dpkg-deb --build --root-owner-group "$root" "$output"
dpkg-deb --info "$output"
