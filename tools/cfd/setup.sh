#!/usr/bin/env bash
# Installs the APEX F1 CFD toolchain into tools/cfd/.local (gitignored). Nothing is installed system-wide.
#   - SU2 v8.5.0 official macOS build (x86_64; runs under Rosetta on Apple Silicon), checksum-pinned
#   - a Python venv with gmsh (mesher), numpy and scipy
#   - the NASA TMR NACA 0012 grid family (113x33, 225x65, 449x129) from the SU2 TestCases repository, checksum-pinned
# Usage: bash tools/cfd/setup.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
local="$here/.local"
mkdir -p "$local/grids"

fetch() { # url dest sha256
  if [ -f "$2" ] && echo "$3  $2" | shasum -a 256 -c --status; then return; fi
  curl -sfL --retry 3 -o "$2.part" "$1"
  echo "$3  $2.part" | shasum -a 256 -c --status || { echo "checksum mismatch for $1" >&2; rm -f "$2.part"; exit 1; }
  mv "$2.part" "$2"
}

fetch https://github.com/su2code/SU2/releases/download/v8.5.0/SU2-v8.5.0-macos64.zip "$local/SU2-v8.5.0-macos64.zip" \
  90a967598cccef540355450bd6c52961942ee8868764749d53191387623eba79
if [ ! -x "$local/su2/bin/SU2_CFD" ]; then
  rm -rf "$local/su2" && mkdir -p "$local/su2"
  unzip -oq "$local/SU2-v8.5.0-macos64.zip" -d "$local/su2"
  unzip -oq "$local/su2/macos64.zip" -d "$local/su2" && rm "$local/su2/macos64.zip"
fi
"$local/su2/bin/SU2_CFD" --help | head -1

base=https://raw.githubusercontent.com/su2code/TestCases/master/rans/naca0012
fetch "$base/n0012_113-33.su2" "$local/grids/n0012_113-33.su2" 9a872a3de5a1b6b6a590ece8cae32ed8e9cbcafde3294fbab0eb67026b08a4f0
fetch "$base/n0012_225-65.su2" "$local/grids/n0012_225-65.su2" 20dfc96875b1d1a8377c2e64248b6ee42a1ecf525c50d822fb5f539d06d68d15
fetch "$base/n0012_449-129.su2" "$local/grids/n0012_449-129.su2" 2e7d2feeb9832d3d16ed6867a3dc16d9e1ec045cf3d4a89ebfb506bcac9571d2

if [ ! -x "$local/venv/bin/python" ]; then python3 -m venv "$local/venv"; fi
"$local/venv/bin/pip" install -q --disable-pip-version-check "gmsh==4.15.2" "numpy==1.26.4" "scipy==1.13.1"
"$local/venv/bin/python" -c "import gmsh, numpy, scipy; print('gmsh', gmsh.__version__, 'numpy', numpy.__version__, 'scipy', scipy.__version__)"
echo "CFD toolchain ready in $local"
