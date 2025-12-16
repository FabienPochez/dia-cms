#!/usr/bin/env tsx
/**
 * Test script for security kill-switch
 * Tests that blocked commands are prevented and allowed commands still work
 */

import { execSync, execFile } from 'child_process'
import '../src/server/lib/subprocessGlobalDiag'

console.log('🧪 Testing Security Kill-Switch\n')

// Test 1: Blocked command (curl)
console.log('Test 1: Blocked command (curl)')
try {
  execSync('curl --version', { encoding: 'utf8' })
  console.error('❌ FAIL: curl should be blocked but executed')
  process.exit(1)
} catch (error: any) {
  if (error.code === 'SECURITY_BLOCK') {
    console.log('✅ PASS: curl correctly blocked')
  } else {
    console.error(`❌ FAIL: Unexpected error: ${error.message}`)
    process.exit(1)
  }
}

// Test 2: Blocked command (wget)
console.log('\nTest 2: Blocked command (wget)')
try {
  execSync('wget --version', { encoding: 'utf8' })
  console.error('❌ FAIL: wget should be blocked but executed')
  process.exit(1)
} catch (error: any) {
  if (error.code === 'SECURITY_BLOCK') {
    console.log('✅ PASS: wget correctly blocked')
  } else {
    console.error(`❌ FAIL: Unexpected error: ${error.message}`)
    process.exit(1)
  }
}

// Test 3: Blocked command (sh)
console.log('\nTest 3: Blocked command (sh)')
try {
  execSync('sh -c "echo test"', { encoding: 'utf8' })
  console.error('❌ FAIL: sh should be blocked but executed')
  process.exit(1)
} catch (error: any) {
  if (error.code === 'SECURITY_BLOCK') {
    console.log('✅ PASS: sh correctly blocked')
  } else {
    console.error(`❌ FAIL: Unexpected error: ${error.message}`)
    process.exit(1)
  }
}

// Test 4: Allowed command (ffprobe) - if available
console.log('\nTest 4: Allowed command (ffprobe)')
try {
  const result = execFile('ffprobe', ['-version'], { encoding: 'utf8' })
  console.log('✅ PASS: ffprobe allowed and executed')
} catch (error: any) {
  if (error.code === 'SECURITY_BLOCK') {
    console.error('❌ FAIL: ffprobe should be allowed but was blocked')
    process.exit(1)
  } else if (error.code === 'ENOENT') {
    console.log('⚠️  SKIP: ffprobe not found in PATH (expected in container)')
  } else {
    console.log(`⚠️  SKIP: ffprobe error (may not be installed): ${error.message}`)
  }
}

// Test 5: Shell metacharacters in exec (should be blocked)
console.log('\nTest 5: Shell metacharacters in exec (should be blocked)')
try {
  execSync('echo test | cat', { encoding: 'utf8' })
  console.error('❌ FAIL: Shell metacharacters should be blocked but executed')
  process.exit(1)
} catch (error: any) {
  if (error.code === 'SECURITY_BLOCK') {
    console.log('✅ PASS: Shell metacharacters correctly blocked')
  } else {
    console.error(`❌ FAIL: Unexpected error: ${error.message}`)
    process.exit(1)
  }
}

console.log('\n✅ All tests passed!')

