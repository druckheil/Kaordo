#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CLIENT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$CLIENT_DIR/../.." && pwd)

VERSION=${1:-0.2.6}
TARGET=${2:-universal-apple-darwin}

if [ "$TARGET" != "universal-apple-darwin" ]; then
    echo "This release helper currently supports only universal macOS builds." >&2
    exit 1
fi

APP_PATH="$PROJECT_DIR/target/$TARGET/release/bundle/macos/Kaordo.app"
ICON_PATH="$CLIENT_DIR/src-tauri/icons/icon.icns"
OUTPUT_DIR="$PROJECT_DIR/release/scope-$VERSION"
DMG_PATH="$OUTPUT_DIR/Kaordo_scope-${VERSION}_macos_universal.dmg"
STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/kaordo-macos-dmg.XXXXXX")
SOURCE_DMG="$STAGING_DIR/Kaordo-source.dmg"
MOUNT_DIR="$STAGING_DIR/mount"
MOUNTED=0

cleanup() {
    if [ "$MOUNTED" -eq 1 ]; then
        hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
    fi
    if [ -d "$STAGING_DIR" ]; then
        rm -R "$STAGING_DIR"
    fi
}
trap cleanup EXIT INT TERM

cd "$CLIENT_DIR"
pnpm tauri build \
    --target "$TARGET" \
    --bundles app \
    --config "{\"version\":\"$VERSION\"}"

swift "$SCRIPT_DIR/apply-macos-icon.swift" "$APP_PATH" "$ICON_PATH"

# Tahoe preserves the custom Finder icon only when it is written into the
# writable image before the image is converted to a compressed DMG.
hdiutil create \
    -size 512m \
    -fs HFS+ \
    -volname Kaordo \
    -ov \
    "$SOURCE_DMG" >/dev/null
mkdir -p "$MOUNT_DIR"
hdiutil attach "$SOURCE_DMG" -nobrowse -mountpoint "$MOUNT_DIR" >/dev/null
MOUNTED=1
ditto --rsrc --extattr --qtn "$APP_PATH" "$MOUNT_DIR/Kaordo.app"
ln -s /Applications "$MOUNT_DIR/Applications"
swift "$SCRIPT_DIR/apply-macos-icon.swift" "$MOUNT_DIR/Kaordo.app" "$ICON_PATH"
hdiutil detach "$MOUNT_DIR" >/dev/null
MOUNTED=0

mkdir -p "$OUTPUT_DIR"
hdiutil convert "$SOURCE_DMG" \
    -format UDZO \
    -ov \
    -o "$DMG_PATH" >/dev/null

echo "Created $DMG_PATH"
