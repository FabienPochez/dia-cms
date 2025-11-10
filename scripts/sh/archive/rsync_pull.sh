#!/usr/bin/env bash
#
# Rsync Pull - Copy file from Hetzner archive to local working directory
# Usage: rsync_pull.sh <archive_rel_path> <working_rel_path>
#
# Example:
#   rsync_pull.sh "legacy/file.mp3" "imported/1/Artist/Album/file.mp3"
#

set -euo pipefail

SRC_REL="${1:?Missing source archive path}"
DST_REL="${2:?Missing destination working path}"

# Build absolute paths
SRC_ABS="bx-archive:/home/archive/${SRC_REL}"
DST_ABS="/srv/media/${DST_REL}"

TMP_ABS="${DST_ABS}.tmp.$$"

# Ensure destination directory exists
mkdir -p "$(dirname "$DST_ABS")"

# Clean up temp file on exit/failure
cleanup_tmp() {
  if [[ -f "$TMP_ABS" ]]; then
    rm -f "$TMP_ABS"
  fi
}
trap cleanup_tmp EXIT

# SSH defaults (disable ControlMaster and override ControlPath to writable location)
# This allows the SSH config to be used while avoiding readonly filesystem issues
RSYNC_RSH='ssh -o ControlMaster=no -o ControlPath=/tmp/ssh-cm-%r@%h:%p'
export RSYNC_RSH

# Execute rsync into temp file and atomically move into place
rsync -a --partial "$SRC_ABS" "$TMP_ABS"
mv -f "$TMP_ABS" "$DST_ABS"

# Print file size on success
stat -c '%s' "$DST_ABS"

# Clear trap once successful move complete
trap - EXIT

