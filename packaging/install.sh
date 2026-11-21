#!/bin/sh
# Visual Git installer for macOS and Linux. Installs into your home folder and
# never needs sudo.
#
#   sh install.sh               install or update
#   sh install.sh --uninstall   remove it again
#
# Locations (override with the environment variables in brackets):
#   app      ~/.local/share/visual-git   [VISUAL_GIT_HOME]
#   command  ~/.local/bin/visualgit      [VISUAL_GIT_BIN]
#
# If Node.js 20+ is missing, a private copy is downloaded from nodejs.org
# (checksum verified) into the app folder. Nothing system-wide is changed.
set -eu

NODE_LINE="latest-v22.x"
MIN_NODE_MAJOR=20
SRC=$(cd "$(dirname "$0")" && pwd)
DEST="${VISUAL_GIT_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/visual-git}"
BIN="${VISUAL_GIT_BIN:-$HOME/.local/bin}"

step() { printf '  - %s\n' "$1"; }
fail() { printf '\nInstall stopped: %s\nNothing outside your home folder was changed.\n' "$1" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  echo "Removing Visual Git..."
  if [ -L "$BIN/visualgit" ] || [ -f "$BIN/visualgit" ]; then rm -f "$BIN/visualgit"; step "Removed $BIN/visualgit"; fi
  if [ -d "$DEST" ]; then rm -rf "$DEST"; step "Deleted $DEST"; fi
  echo "Visual Git has been removed. Your projects were not touched."
  exit 0
fi

fetch() { # fetch URL [OUTFILE]; prints to stdout when no OUTFILE
  if command -v curl >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then curl -fsSL "$1" -o "$2"; else curl -fsSL "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then wget -q "$1" -O "$2"; else wget -q "$1" -O -; fi
  else
    return 1
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else return 1
  fi
}

have_node() {
  command -v node >/dev/null 2>&1 || return 1
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "$major" -ge "$MIN_NODE_MAJOR" ] 2>/dev/null
}

install_private_node() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "No Node.js download for this system. Install Node.js $MIN_NODE_MAJOR or newer, then run this again." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) fail "No Node.js download for this processor. Install Node.js $MIN_NODE_MAJOR or newer, then run this again." ;;
  esac

  base="https://nodejs.org/dist/$NODE_LINE"
  step "Node.js not found. Downloading a private copy from nodejs.org..."
  sums=$(fetch "$base/SHASUMS256.txt") || fail "Could not reach nodejs.org (curl or wget is required). Install Node.js yourself, then run this again."
  line=$(printf '%s\n' "$sums" | grep -E "  node-v[0-9.]+-$os-$arch\.tar\.gz\$" | head -n 1)
  [ -n "$line" ] || fail "Could not find a Node.js build for this computer on nodejs.org."
  expected=${line%% *}
  file=${line##* }

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  fetch "$base/$file" "$tmp/$file" || fail "The Node.js download failed. Check your connection and try again."
  actual=$(sha256_of "$tmp/$file") || fail "Cannot verify the download (sha256sum or shasum is required)."
  [ "$actual" = "$expected" ] || fail "The Node.js download did not match its published checksum, so it was not installed."

  rm -rf "$DEST/runtime/node"
  mkdir -p "$DEST/runtime/node"
  tar -xzf "$tmp/$file" -C "$DEST/runtime/node" --strip-components=1
  [ -x "$DEST/runtime/node/bin/node" ] || fail "Unpacking Node.js failed."
  step "Node.js is ready (private copy; nothing else on this computer is changed)."
}

VERSION=""
[ -f "$SRC/VERSION" ] && VERSION=$(head -n 1 "$SRC/VERSION")
echo "Installing Visual Git $VERSION for $(id -un) (no sudo needed)..."

mkdir -p "$DEST" "$BIN"
if [ "$SRC" != "$DEST" ]; then
  [ -f "$SRC/app/build/cli.mjs" ] || fail "This folder is incomplete (app/build/cli.mjs is missing). Unpack the whole Visual Git archive first."
  rm -rf "$DEST/app"
  cp -R "$SRC/app" "$DEST/app"
  for name in visualgit install.sh README.txt VERSION; do
    [ -f "$SRC/$name" ] && cp "$SRC/$name" "$DEST/$name"
  done
  chmod +x "$DEST/visualgit" "$DEST/install.sh"
  step "Copied Visual Git to $DEST"
fi

if [ -x "$DEST/runtime/node/bin/node" ]; then
  step "Node.js: using the private copy from an earlier install."
elif [ -z "${VISUAL_GIT_FORCE_PRIVATE_NODE:-}" ] && have_node; then
  step "Node.js: using the one already on this computer."
else
  install_private_node
fi

if command -v git >/dev/null 2>&1; then
  step "Git: using the one already on this computer."
else
  step "Git is not installed. Visual Git will open, but cannot read a project until it is:"
  case "$(uname -s)" in
    Darwin) echo "      run:  xcode-select --install" ;;
    *) echo "      install the 'git' package with your system's package manager" ;;
  esac
fi

ln -sf "$DEST/visualgit" "$BIN/visualgit"
step "Added the visualgit command at $BIN/visualgit"

echo
case ":$PATH:" in
  *":$BIN:"*)
    echo "Done. In any project folder, type:  visualgit"
    ;;
  *)
    echo "Done. One more step: $BIN is not on your PATH yet."
    echo "Add this line to your shell profile (~/.zshrc or ~/.bashrc), then open a new terminal:"
    echo "  export PATH=\"$BIN:\$PATH\""
    echo "Until then you can run it directly:  $BIN/visualgit"
    ;;
esac
