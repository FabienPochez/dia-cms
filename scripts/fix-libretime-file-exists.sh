#!/bin/bash
# Fix LibreTime file_exists flags by checking actual file existence
# This prevents playout errors when files are missing from disk

set -euo pipefail

MEDIA_ROOT="${MEDIA_ROOT:-/srv/media}"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== LibreTime file_exists Fixer ===${NC}"
echo "Media root: $MEDIA_ROOT"
echo ""

# Get all files marked as existing in database
echo -e "${YELLOW}→ Checking files marked as existing in database...${NC}"

docker exec -i libretime-postgres-1 psql -U libretime -d libretime -t -c \
  "SELECT id, filepath FROM cc_files WHERE file_exists = true AND filepath != '';" | \
while IFS='|' read -r id filepath; do
  # Trim whitespace
  id=$(echo "$id" | xargs)
  filepath=$(echo "$filepath" | xargs)
  
  if [ -z "$id" ] || [ -z "$filepath" ]; then
    continue
  fi
  
  # Check if file exists on disk
  full_path="$MEDIA_ROOT/$filepath"
  if [ ! -f "$full_path" ]; then
    echo -e "${RED}✗ File $id missing: $filepath${NC}"
    
    # Update database
    docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c \
      "UPDATE cc_files SET file_exists = false WHERE id = $id;" > /dev/null
    
    # Remove from future schedules
    deleted=$(docker exec -i libretime-postgres-1 psql -U libretime -d libretime -t -c \
      "DELETE FROM cc_schedule WHERE file_id = $id AND starts > NOW() RETURNING id;" | wc -l)
    
    if [ "$deleted" -gt 0 ]; then
      echo -e "${YELLOW}  → Removed $deleted schedule entries${NC}"
    fi
  fi
done

echo ""
echo -e "${GREEN}✓ file_exists check complete${NC}"
echo ""
echo -e "${YELLOW}Tip: Run this script after restoring from backup or moving media files${NC}"



