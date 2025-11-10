# LibreTime v2 API Test - Reviewer Pack

## SUMMARY (≤10 bullets)

• **Goal**: Test LibreTime v2 API endpoints for Show + Instance + Schedule creation using `Api-Key` authentication
• **Scope**: POST operations for `/api/v2/shows`, `/api/v2/show-instances`, `/api/v2/schedule` with GET verification
• **Safety**: Creates test entities with unique timestamp prefix (`dia-test-<ts>`) to avoid conflicts
• **Auth Method**: Uses `Authorization: Api-Key <LT_API_KEY>` header format
• **Time Window**: Creates 15-minute show instance starting 10 minutes from test execution
• **File Handling**: Uses provided `LT_FILE_ID` or discovers first available file via `/api/v2/files`
• **Verification**: GET requests to confirm created resources and their relationships
• **Cleanup**: Provides manual DELETE commands for all created test entities
• **Error Handling**: Captures HTTP status codes and response bodies for debugging
• **Dependencies**: Requires `jq` for JSON parsing and `curl` for HTTP requests

## COMMANDS (copy/paste `curl` + tiny helpers)

### Environment Setup
```bash
# Set required environment variables
export LT_URL="${LT_URL:-http://libretime-nginx-1:8080}"
export LT_API_KEY="your-api-key-here"
export LT_FILE_ID="optional-file-id"  # Leave empty to auto-discover

# Generate test identifiers
TS=$(date -u +%Y%m%dT%H%M%SZ)
NAME="dia-test-$TS"
START=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u -d '+25 minutes' +%Y-%m-%dT%H:%M:%SZ)
```

### A) Preflight Checks
```bash
# Check v2 API root
curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/"

# Check endpoint capabilities
curl -s -I -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/shows"
curl -s -I -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/show-instances"  
curl -s -I -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/schedule"
```

### B) Create Show
```bash
# POST /api/v2/shows
curl -X POST \
  -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'$NAME'",
    "description": "LibreTime v2 API test show",
    "live_enabled": true
  }' \
  "$LT_URL/api/v2/shows"

# Capture SHOW_ID from response
SHOW_ID=$(echo "$response" | jq -r '.id')
```

### C) Create Show Instance
```bash
# POST /api/v2/show-instances
curl -X POST \
  -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "show": '$SHOW_ID',
    "starts_at": "'$START'",
    "ends_at": "'$END'",
    "record_enabled": 0
  }' \
  "$LT_URL/api/v2/show-instances"

# Capture INSTANCE_ID from response
INSTANCE_ID=$(echo "$response" | jq -r '.id')
```

### D) Pick a File
```bash
# If LT_FILE_ID not set, discover files
if [[ -z "$LT_FILE_ID" ]]; then
  curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/files?limit=10"
  FILE_ID=$(echo "$response" | jq -r '.results[0].id')
else
  FILE_ID="$LT_FILE_ID"
fi
```

### E) Schedule the File
```bash
# POST /api/v2/schedule
curl -X POST \
  -H "Authorization: Api-Key $LT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instance": '$INSTANCE_ID',
    "file": '$FILE_ID',
    "starts_at": "'$START'",
    "position": 0,
    "cue_in": "00:00:00",
    "broadcasted": 0
  }' \
  "$LT_URL/api/v2/schedule"

# Capture SCHED_ID from response
SCHED_ID=$(echo "$response" | jq -r '.id')
```

### F) Verify Creation
```bash
# Verify show
curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/shows/$SHOW_ID"

# Verify instance
curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/show-instances?show=$SHOW_ID"

# Verify schedule
curl -s -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/schedule?instance=$INSTANCE_ID"
```

### G) Cleanup (Manual)
```bash
# Delete schedule item
curl -X DELETE -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/schedule/$SCHED_ID"

# Delete show instance  
curl -X DELETE -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/show-instances/$INSTANCE_ID"

# Delete show
curl -X DELETE -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/shows/$SHOW_ID"
```

## LOGS (expected responses / what to look for)

### Successful Responses

**Show Creation (POST /api/v2/shows)**
- **HTTP Status**: `201 Created`
- **Response Body**: `{"id": 123, "name": "dia-test-20241201T143022Z", "description": "probe", "live_enabled": true, ...}`
- **Key Fields**: `id` (integer), `name` (string), `live_enabled` (boolean)

**Show Instance Creation (POST /api/v2/show-instances)**
- **HTTP Status**: `201 Created`  
- **Response Body**: `{"id": 456, "show": 123, "starts_at": "2024-12-01T14:40:00Z", "ends_at": "2024-12-01T14:55:00Z", ...}`
- **Key Fields**: `id` (integer), `show` (integer), `starts_at`/`ends_at` (ISO8601 strings)

**Schedule Creation (POST /api/v2/schedule)**
- **HTTP Status**: `201 Created`
- **Response Body**: `{"id": 789, "instance": 456, "file": 101, "starts_at": "2024-12-01T14:40:00Z", "position": 0, ...}`
- **Key Fields**: `id` (integer), `instance` (integer), `file` (integer), `starts_at` (ISO8601 string)

### Error Responses to Watch For

**Authentication Issues**
- **HTTP Status**: `401 Unauthorized`
- **Response**: `{"detail": "Authentication credentials were not provided."}`
- **Fix**: Verify `LT_API_KEY` is correct and has proper permissions

**Permission Issues**
- **HTTP Status**: `403 Forbidden`  
- **Response**: `{"detail": "You do not have permission to perform this action."}`
- **Fix**: Check API key has create/schedule permissions

**Validation Errors**
- **HTTP Status**: `400 Bad Request`
- **Response**: `{"field_name": ["This field is required."]}`
- **Fix**: Verify all required fields are provided with correct data types

**Server Errors**
- **HTTP Status**: `500 Internal Server Error`
- **Response**: `{"detail": "Internal server error"}` or database error details
- **Note**: Some LibreTime versions have known issues with `/api/v2/schedule` endpoint

### OPTIONS Response Headers
- **Allow Header**: Should include `POST` for creation endpoints
- **Expected**: `Allow: GET, POST, OPTIONS` or similar
- **Missing POST**: Indicates endpoint doesn't support creation

## QUESTIONS & RISKS (≤6 bullets)

• **API Version Compatibility**: Some LibreTime installations may not have v2 API enabled or may have different endpoint structures. What LibreTime version is being tested and are v2 endpoints confirmed available?

• **Authentication Scope**: Does the provided API key have sufficient permissions to create shows, instances, and schedule items? Some keys may be read-only or have limited scope.

• **File Availability**: The test requires at least one file in the LibreTime system to schedule. What happens if no files are available, and should the test handle this gracefully or fail?

• **Timezone Handling**: The test uses UTC timestamps, but LibreTime may be configured for a different timezone. Should we verify the server timezone and adjust accordingly?

• **Concurrent Access**: If multiple tests run simultaneously with the same timestamp prefix, could there be naming conflicts? Should we add additional uniqueness measures?

• **Cleanup Dependencies**: The cleanup commands assume DELETE operations work in reverse order (schedule → instance → show). What if some endpoints don't support DELETE or have dependency constraints that prevent cleanup?

## ACCEPTANCE CRITERIA

✅ **Show Creation**: POST `/api/v2/shows` returns 201 with valid show ID  
✅ **Instance Creation**: POST `/api/v2/show-instances` returns 201 with valid instance ID linked to show  
✅ **Schedule Creation**: POST `/api/v2/schedule` returns 201 with valid schedule ID linking file to instance  
✅ **Verification**: GET requests return created resources with correct relationships  
✅ **Authentication**: All requests use `Api-Key` header format successfully  
✅ **Cleanup**: DELETE commands are provided for manual cleanup of test data  

## KNOWN ISSUES & WORKAROUNDS

• **Schedule Endpoint 500 Errors**: Some LibreTime versions have reported 500 errors on POST `/api/v2/schedule`. If encountered, check LibreTime version and consider using legacy API or manual scheduling.

• **File Discovery**: If no files exist in the system, the test will skip schedule creation. Consider uploading a test file first or using a known file ID.

• **Time Window**: The test creates instances 10-25 minutes in the future. Ensure the LibreTime server clock is synchronized and the time window doesn't conflict with existing programming.

## TEST EXECUTION

Run the complete test script:
```bash
chmod +x libretime-v2-api-test.sh
./libretime-v2-api-test.sh
```

Or execute individual curl commands from the COMMANDS section above.
