#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

app_name="PgClient.app"
built_app="target/release/bundle/macos/$app_name"
installed_app="/Applications/$app_name"

npm install
npm --prefix web install
npm run tauri build -- --bundles app

osascript -e 'tell application "PgClient" to quit' 2>/dev/null || true

rm -rf "$installed_app"
cp -R "$built_app" "$installed_app"

# Spotlight would list the build output as a second PgClient.app.
rm -rf "$built_app"

# Builds are ad-hoc signed, so a quarantine flag would force right-click → Open.
xattr -dr com.apple.quarantine "$installed_app"

echo "Installed $installed_app"
