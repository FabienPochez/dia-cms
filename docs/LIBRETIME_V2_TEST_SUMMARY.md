# LibreTime v2 API Test - Complete Package

## Files Created

1. **`libretime-v2-api-test.sh`** - Complete test script with full error handling
2. **`quick-lt-test.sh`** - Helper script for easy execution with parameters  
3. **`LIBRETIME_V2_API_REVIEWER_PACK.md`** - Detailed reviewer documentation
4. **`LIBRETIME_V2_TEST_SUMMARY.md`** - This summary file

## Quick Start

```bash
# Method 1: Set environment variables and run
export LT_URL="http://your-libretime-server:8080"
export LT_API_KEY="your-api-key"
export LT_FILE_ID="optional-file-id"  # Leave empty to auto-discover
./libretime-v2-api-test.sh

# Method 2: Pass parameters directly
./quick-lt-test.sh "http://your-libretime-server:8080" "your-api-key" "optional-file-id"

# Method 3: Use defaults (requires LT_URL and LT_API_KEY env vars)
./quick-lt-test.sh
```

## What the Test Does

### ✅ **Creates Test Entities**
- **Show**: Named `dia-test-<timestamp>` with live_enabled=true
- **Show Instance**: 15-minute window starting 10 minutes from test execution
- **Schedule Item**: Links a file to the show instance (if file available)

### ✅ **Verifies Creation**
- GET requests to confirm all created resources
- Validates relationships between show → instance → schedule
- Shows HTTP status codes and response bodies

### ✅ **Provides Cleanup**
- Manual DELETE commands for all created test entities
- Safe to run multiple times (unique timestamp prefixes)

## Expected Results

### Success Case
```
=== LibreTime v2 API Test Suite ===
Test Name: dia-test-20241201T143022Z
Start Time: 2024-12-01T14:40:00Z
End Time: 2024-12-01T14:55:00Z

→ Check v2 API root
HTTP Status: 200
✓ Success

→ Create test show  
HTTP Status: 201
✓ Success
Created Show ID: 123

→ Create show instance
HTTP Status: 201  
✓ Success
Created Instance ID: 456

→ Schedule file in instance
HTTP Status: 201
✓ Success  
Created Schedule ID: 789

=== Test Complete ===
```

### Failure Cases
- **401 Unauthorized**: Check API key
- **403 Forbidden**: Check API key permissions
- **500 Internal Server Error**: Known issue with some LibreTime versions
- **400 Bad Request**: Check request format and required fields

## Safety Features

- **Unique Naming**: All test entities use `dia-test-<timestamp>` prefix
- **No Automatic Cleanup**: DELETE commands provided but not executed automatically
- **Error Handling**: Captures and displays HTTP status codes and error responses
- **Graceful Degradation**: Continues test even if file scheduling fails

## Troubleshooting

### Common Issues

1. **"jq command not found"**
   ```bash
   # Install jq
   sudo apt-get install jq  # Ubuntu/Debian
   brew install jq          # macOS
   ```

2. **"LT_API_KEY environment variable not set"**
   ```bash
   export LT_API_KEY="your-actual-api-key"
   ```

3. **"No files found"**
   - Upload a file to LibreTime first, or
   - Set `LT_FILE_ID` to a known file ID

4. **"500 Internal Server Error" on schedule endpoint**
   - Known issue with some LibreTime versions
   - Check LibreTime version and consider using legacy API

### Debug Mode
```bash
# Add -v flag to curl commands for verbose output
curl -v -H "Authorization: Api-Key $LT_API_KEY" "$LT_URL/api/v2/"
```

## API Endpoints Tested

| Endpoint | Method | Purpose | Expected Status |
|----------|--------|---------|-----------------|
| `/api/v2/` | GET | Check API availability | 200 |
| `/api/v2/shows` | OPTIONS | Check capabilities | 200 |
| `/api/v2/shows` | POST | Create show | 201 |
| `/api/v2/show-instances` | POST | Create instance | 201 |
| `/api/v2/schedule` | POST | Schedule file | 201 |
| `/api/v2/shows/{id}` | GET | Verify show | 200 |
| `/api/v2/show-instances?show={id}` | GET | Verify instance | 200 |
| `/api/v2/schedule?instance={id}` | GET | Verify schedule | 200 |

## Next Steps

1. **Run the test** with your LibreTime server details
2. **Verify all endpoints work** and return expected status codes
3. **Check the created resources** in LibreTime web interface
4. **Clean up test data** using provided DELETE commands
5. **Report any issues** with specific error messages and LibreTime version

## Support

- **LibreTime Documentation**: https://libretime.org/docs/
- **API Reference**: Check your LibreTime installation's `/api/v2/` endpoint
- **Version Info**: Check LibreTime version in web interface or API response headers
