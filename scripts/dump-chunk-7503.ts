#!/usr/bin/env tsx
/**
 * Diagnostic script to dump chunk 7503.js for analysis
 * Run this to extract the full malicious code context
 */

import fs from 'fs'
import path from 'path'

const chunkPath = path.join(process.cwd(), '.next/server/chunks/7503.js')

if (!fs.existsSync(chunkPath)) {
  console.error(`Chunk file not found: ${chunkPath}`)
  process.exit(1)
}

const content = fs.readFileSync(chunkPath, 'utf8')
const fileSize = content.length

console.log('=== CHUNK 7503.js ANALYSIS ===')
console.log(`File size: ${fileSize} bytes`)
console.log(`Lines: ${content.split('\n').length}`)
console.log(`MD5: ${require('crypto').createHash('md5').update(content).digest('hex')}`)
console.log('')

// Find all execSync references
const execSyncMatches: Array<{ index: number; context: string }> = []
let searchIndex = 0
while (true) {
  const idx = content.indexOf('execSync', searchIndex)
  if (idx === -1) break
  const start = Math.max(0, idx - 200)
  const end = Math.min(content.length, idx + 500)
  execSyncMatches.push({
    index: idx,
    context: content.substring(start, end),
  })
  searchIndex = idx + 1
}

console.log(`=== Found ${execSyncMatches.length} execSync references ===`)
execSyncMatches.forEach((match, i) => {
  console.log(`\n--- execSync #${i + 1} at position ${match.index} ---`)
  console.log(match.context)
})

// Find all eval() calls
const evalMatches: Array<{ index: number; context: string }> = []
searchIndex = 0
while (true) {
  const idx = content.indexOf('eval(', searchIndex)
  if (idx === -1) break
  const start = Math.max(0, idx - 200)
  const end = Math.min(content.length, idx + 500)
  evalMatches.push({
    index: idx,
    context: content.substring(start, end),
  })
  searchIndex = idx + 1
}

console.log(`\n=== Found ${evalMatches.length} eval() calls ===`)
evalMatches.forEach((match, i) => {
  console.log(`\n--- eval() #${i + 1} at position ${match.index} ---`)
  console.log(match.context)
})

// Check for malicious patterns
const maliciousPatterns = [
  '176.117.107.158',
  'wget',
  'curl',
  'r.sh',
  'mkdir /tmp',
  'chmod 777',
]

console.log('\n=== MALICIOUS PATTERN SEARCH ===')
maliciousPatterns.forEach((pattern) => {
  const idx = content.indexOf(pattern)
  if (idx !== -1) {
    const start = Math.max(0, idx - 300)
    const end = Math.min(content.length, idx + 300)
    console.log(`\n⚠️  Found "${pattern}" at position ${idx}:`)
    console.log(content.substring(start, end))
  } else {
    console.log(`✓ Pattern "${pattern}" not found`)
  }
})

// Save full file for comparison
const outputPath = path.join(process.cwd(), 'chunk-7503-dump.txt')
fs.writeFileSync(outputPath, content)
console.log(`\n=== Full file saved to: ${outputPath} ===`)
