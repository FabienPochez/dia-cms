import { exec as cpExec, execFile as cpExecFile, ExecFileOptions, ExecOptions } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(cpExec)
const execFileAsync = promisify(cpExecFile)

type MaybeOptions = ExecOptions | ExecFileOptions | undefined

function maskSecrets(input: string): string {
  return input
    .replace(/Api-Key\\s+\\S+/gi, 'Api-Key ***')
    .replace(/Bearer\\s+\\S+/gi, 'Bearer ***')
    .replace(/PGPASSWORD=\\S+/gi, 'PGPASSWORD=***')
    .replace(/token=\\S+/gi, 'token=***')
}

function logSubprocess(context: string | undefined, command: string, args?: string[]) {
  const timestamp = new Date().toISOString()
  const stack = new Error().stack
    ?.split('\\n')
    .slice(2, 8)
    .map((line) => line.trim())
    .join(' | ')

  const cmd = args && args.length > 0 ? `${command} ${args.join(' ')}` : command
  console.log(
    '[SUBPROC_DIAG]',
    JSON.stringify({
      ts: timestamp,
      context: context || 'unknown',
      cmd: maskSecrets(cmd),
      stack,
    }),
  )
}

export async function diagExec(command: string, options?: MaybeOptions, context?: string) {
  logSubprocess(context, command)
  return execAsync(command, options)
}

export async function diagExecFile(
  file: string,
  args: string[] = [],
  options?: MaybeOptions,
  context?: string,
) {
  logSubprocess(context, file, args)
  return execFileAsync(file, args, options)
}
