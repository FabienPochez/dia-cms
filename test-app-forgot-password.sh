#!/bin/bash
# Test script for app forgot password endpoint
# Tests various scenarios for POST /api/auth/app/forgot-password

API_URL="${API_URL:-https://content.diaradio.live}"
ENDPOINT="$API_URL/api/app-forgot-password"

echo "=== App Forgot Password Endpoint Test Suite ==="
echo "Testing endpoint: $ENDPOINT"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test helper function
test_case() {
  local name="$1"
  local expected_status="$2"
  local email="$3"
  
  echo -e "${YELLOW}Test: $name${NC}"
  echo "  Email: ${email:-'(none)'}"
  
  response=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\"}")
  
  status=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$status" == "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Status: $status)"
  else
    echo -e "${RED}✗ FAIL${NC} (Expected: $expected_status, Got: $status)"
  fi
  
  echo "  Response: $body"
  echo ""
}

# Test 1: Missing email
echo -e "${BLUE}=== Validation Tests ===${NC}"
test_case "Missing email" 400 ""

# Test 2: Invalid email format
test_case "Invalid email format" 400 "not-an-email"

# Test 3: Invalid email format (no @)
test_case "Invalid email (no @)" 400 "invalidemail.com"

# Test 4: Invalid email format (no domain)
test_case "Invalid email (no domain)" 400 "user@"

# Test 5: Valid email format (should succeed even if user doesn't exist)
echo -e "${BLUE}=== Success Cases ===${NC}"
test_case "Valid email (generic success)" 200 "test@example.com"

# Test 6: Valid email with registered user (if you have one)
if [ -n "$TEST_EMAIL" ]; then
  test_case "Valid email (registered user)" 200 "$TEST_EMAIL"
else
  echo -e "${YELLOW}Note: Set TEST_EMAIL env var to test with a registered user${NC}"
  echo ""
fi

# Test 7: Rate limiting (send 6 requests rapidly)
echo -e "${BLUE}=== Rate Limiting Test ===${NC}"
echo -e "${YELLOW}Test: Rate limiting (6 requests in quick succession)${NC}"
echo "  Email: ratelimit@example.com"
echo ""

for i in {1..6}; do
  response=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d '{"email": "ratelimit@example.com"}')
  
  status=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$status" == "429" ]; then
    echo -e "${GREEN}✓ Rate limit triggered on request #$i${NC} (Status: $status)"
    echo "  Response: $body"
    break
  else
    echo "  Request #$i: Status $status"
  fi
  
  # Small delay to avoid overwhelming the server
  sleep 0.1
done

echo ""
echo -e "${BLUE}=== Test Summary ===${NC}"
echo "Check server logs for:"
echo "  - [app-forgot-password] Password reset email sent to <email>"
echo "  - [app-forgot-password] Rate limit exceeded (if rate limit test worked)"
echo ""
echo "In development (mock mode), check logs for email preview URL"
echo "In production, check the user's inbox for the reset email"
echo ""
echo "To test the full flow:"
echo "  1. Request reset: POST $ENDPOINT with valid email"
echo "  2. Check email for reset link: https://dia-web.vercel.app/reset-password?token=..."
echo "  3. Use token to reset: POST $API_URL/api/users/reset-password"
echo "     Body: {\"token\": \"<token>\", \"password\": \"newpassword123\"}"

