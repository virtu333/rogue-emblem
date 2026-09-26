#!/usr/bin/env bash
# Writes the App Store Connect API key from $ASC_PRIVATE_KEY (the whole AuthKey_<id>.p8,
# PEM or base64) to $RUNNER_TEMP/private_keys/AuthKey_$ASC_KEY_ID.p8, where xcodebuild,
# altool and tools/ios/*.mjs find it, and exports ASC_KEY_PATH and API_PRIVATE_KEYS_DIR.
set -euo pipefail
KEY_DIR="$RUNNER_TEMP/private_keys"
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"
KEY_PATH="$KEY_DIR/AuthKey_${ASC_KEY_ID}.p8"
if printf '%s' "$ASC_PRIVATE_KEY" | grep -q 'BEGIN PRIVATE KEY'; then
  # Pasted PEM; %b also turns literal "\n" sequences into newlines.
  printf '%b\n' "$ASC_PRIVATE_KEY" > "$KEY_PATH"
else
  printf '%s' "$ASC_PRIVATE_KEY" | base64 --decode > "$KEY_PATH"
fi
chmod 600 "$KEY_PATH"
if ! openssl pkey -in "$KEY_PATH" -noout 2>/dev/null; then
  echo "::error::APP_STORE_CONNECT_PRIVATE_KEY is not a readable .p8 private key (paste the whole file, including the BEGIN/END lines)."
  exit 1
fi
echo "ASC_KEY_PATH=$KEY_PATH" >> "$GITHUB_ENV"
echo "API_PRIVATE_KEYS_DIR=$KEY_DIR" >> "$GITHUB_ENV"
