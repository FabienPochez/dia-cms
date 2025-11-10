#!/bin/bash
# Test script for password change endpoint
# This script tests various scenarios for the /api/users/change-password endpoint

API_URL="${API_URL:-https://content.diaradio.live}"
ENDPOINT="$API_URL/api/users/change-password"

echo "=== Password Change Endpoint Test Suite ==="
echo "Testing endpoint: $ENDPOINT"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test helper function
test_case() {
  local name="$1"
  local expected_status="$2"
  local token="$3"
  local current_pw="$4"
  local new_pw="$5"
  
  echo -e "${YELLOW}Test: $name${NC}"
  
  response=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"currentPassword\": \"$current_pw\", \"newPassword\": \"$new_pw\"}")
  
  status=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$status" == "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Status: $status)"
  else
    echo -e "${RED}✗ FAIL${NC} (Expected: $expected_status, Got: $status)"
  fi
  
  echo "Response: $body"
  echo ""
}

# Check if JWT token is provided
if [ -z "$JWT_TOKEN" ]; then
  echo -e "${RED}Error: JWT_TOKEN environment variable not set${NC}"
  echo "Usage: JWT_TOKEN='your-jwt-token' ./test-password-change.sh"
  echo ""
  echo "To get a token, log in via:"
  echo "curl -X POST $API_URL/api/users/login -H 'Content-Type: application/json' -d '{\"email\":\"your@email.com\",\"password\":\"yourpassword\"}'"
  exit 1
fi

echo "Using JWT token: ${JWT_TOKEN:0:20}..."
echo ""

# Test 1: Missing current password
test_case "Missing current password" 400 "$JWT_TOKEN" "" "newpassword123"

# Test 2: Missing new password
test_case "Missing new password" 400 "$JWT_TOKEN" "currentpass" ""

# Test 3: New password too short
test_case "New password too short" 400 "$JWT_TOKEN" "currentpass" "short"

# Test 4: Same password
test_case "Same as current password" 400 "$JWT_TOKEN" "samepass123" "samepass123"

# Test 5: Invalid token
test_case "Invalid JWT token" 401 "invalid-token" "currentpass" "newpassword123"

# Test 6: Incorrect current password
echo -e "${YELLOW}Test: Incorrect current password${NC}"
echo "Note: This will increment rate limit counter"
test_case "Wrong current password" 401 "$JWT_TOKEN" "wrongpassword123" "newpassword123"

# Test 7: Valid password change (if you want to actually test this)
echo -e "${YELLOW}Test: Valid password change (SKIPPED)${NC}"
echo "To test successful password change, uncomment and provide real credentials"
echo "# test_case 'Valid password change' 200 '$JWT_TOKEN' 'your-real-current-password' 'your-new-password'"
echo ""

# Test 8: Rate limiting (requires multiple failed attempts)
echo -e "${YELLOW}Test: Rate limiting${NC}"
echo "Sending 5 requests to trigger rate limit..."
for i in {1..5}; do
  curl -s -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d '{"currentPassword": "wrong", "newPassword": "newpass123"}' > /dev/null
  echo "  Attempt $i sent"
done

echo "Sending 6th request (should be rate limited)..."
response=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"currentPassword": "wrong", "newPassword": "newpass123"}')

status=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$status" == "429" ]; then
  echo -e "${GREEN}✓ PASS${NC} (Rate limited with status 429)"
else
  echo -e "${YELLOW}⚠ WARNING${NC} (Expected 429, Got: $status)"
fi
echo "Response: $body"
echo ""

echo "=== Test Suite Complete ==="
echo ""
echo "Note: Wait 60 seconds for rate limit to reset before running again"




