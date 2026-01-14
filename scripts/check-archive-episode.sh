#!/usr/bin/env bash
# Check if an episode file exists on the archive server
# Usage: check-archive-episode.sh <episodeId>

set -euo pipefail

EPISODE_ID="${1:-}"

if [[ -z "$EPISODE_ID" ]]; then
  echo "Usage: $0 <episodeId>"
  exit 1
fi

echo "🔍 Searching archive server for episode: $EPISODE_ID"
echo ""

# Check legacy directory
echo "📁 Checking /home/archive/legacy/..."
LEGACY_FILES=$(ssh bx-archive "find /home/archive/legacy -name '${EPISODE_ID}*' -type f 2>/dev/null" 2>&1 || echo "")

if [[ -n "$LEGACY_FILES" ]]; then
  echo "✅ Found in legacy:"
  echo "$LEGACY_FILES" | while read -r file; do
    if [[ -n "$file" ]]; then
      echo "   $file"
      ssh bx-archive "ls -lh '$file' 2>/dev/null" 2>&1 | head -1
    fi
  done
else
  echo "❌ Not found in legacy"
fi

echo ""
echo "📁 Checking /home/archive/archive/..."
ARCHIVE_FILES=$(ssh bx-archive "find /home/archive/archive -name '${EPISODE_ID}*' -type f 2>/dev/null" 2>&1 || echo "")

if [[ -n "$ARCHIVE_FILES" ]]; then
  echo "✅ Found in archive:"
  echo "$ARCHIVE_FILES" | while read -r file; do
    if [[ -n "$file" ]]; then
      echo "   $file"
      ssh bx-archive "ls -lh '$file' 2>/dev/null" 2>&1 | head -1
    fi
  done
else
  echo "❌ Not found in archive"
fi

echo ""
echo "📊 Summary:"
TOTAL=$(echo -e "$LEGACY_FILES\n$ARCHIVE_FILES" | grep -v '^$' | wc -l)
if [[ $TOTAL -gt 0 ]]; then
  echo "✅ Found $TOTAL file(s) on archive server"
else
  echo "❌ No files found on archive server"
fi
