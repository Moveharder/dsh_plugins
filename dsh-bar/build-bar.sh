#!/bin/bash
# 构建 dsh-bar.app —— 自包含：
#    · 图标已内置在 assets/，无需外部仓库路径，也无需 rsvg-convert / qlmanage
#    · 依赖仅为 macOS 自带工具（Xcode Command Line Tools 提供 swiftc / codesign）
#    · 可选 REGEN=1 从 assets/whale.svg 重新生成图标（此时才需要 rsvg-convert 或 qlmanage）
set -euo pipefail
cd "$(dirname "$0")"

APP="dsh-bar.app"
REGEN="${REGEN:-0}"
ICON_DIR="assets"

if [[ "$REGEN" == "1" ]]; then
  echo "==> REGEN=1：从 assets/whale.svg 重新生成图标（需要 rsvg-convert 或 qlmanage）"
  mkdir -p gen
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w 1024 -h 1024 assets/whale.svg -o gen/whale-1024.png
  elif command -v qlmanage >/dev/null 2>&1; then
    qlmanage -t -s 1024 -o gen assets/whale.svg >/dev/null 2>&1
    mv gen/whale.svg.png gen/whale-1024.png
  else
    echo "错误：既没有 rsvg-convert 也没有 qlmanage，无法重新生成图标" >&2
    exit 1
  fi
  sips -z 36 36 gen/whale-1024.png --out gen/whale-36.png >/dev/null
  rm -rf gen/whale.iconset; mkdir -p gen/whale.iconset
  while read -r size name; do
    sips -z "$size" "$size" gen/whale-1024.png --out "gen/whale.iconset/$name" >/dev/null
  done <<'SIZES'
16      icon_16x16.png
32      icon_16x16@2x.png
32      icon_32x32.png
64      icon_32x32@2x.png
128     icon_128x128.png
256     icon_128x128@2x.png
256     icon_256x256.png
512     icon_256x256@2x.png
512     icon_512x512.png
1024    icon_512x512@2x.png
SIZES
  iconutil -c icns gen/whale.iconset -o gen/applet.icns
  ICON_DIR="gen"
  echo "    已重新生成；如需固化，把 gen/ 里的 applet.icns / whale-36.png 拷回 assets/"
else
  echo "==> 使用内置图标 assets/"
fi

echo "==> 1/4 swiftc 编译"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" gen/mcache
swiftc -O -framework Cocoa -Xcc -fmodules-cache-path="$(pwd)/gen/mcache" main.swift -o "$APP/Contents/MacOS/dsh-bar"

echo "==> 2/4 组装 bundle"
cp "$ICON_DIR/applet.icns"  "$APP/Contents/Resources/applet.icns"
cp "$ICON_DIR/whale-36.png" "$APP/Contents/Resources/whale-36.png"
printf 'APPL????' > "$APP/Contents/PkgInfo"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key><string>en</string>
	<key>CFBundleExecutable</key><string>dsh-bar</string>
	<key>CFBundleIconFile</key><string>applet</string>
	<key>CFBundleIdentifier</key><string>ai.deepseek.dsh-bar</string>
	<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
	<key>CFBundleName</key><string>dsh-bar</string>
	<key>CFBundleDisplayName</key><string>dsh-bar</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>1.0</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>LSUIElement</key><true/>
	<key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

echo "==> 3/4 签名"
codesign --force --sign - "$APP"
codesign --verify --verbose=1 "$APP"

echo "==> 4/4 清理构建缓存（gen/mcache 含编译机路径，不随包分发）"
rm -rf gen/mcache
echo "OK -> $APP"
