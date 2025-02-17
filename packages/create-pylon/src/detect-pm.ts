import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import {execSync} from 'node:child_process'
import consola from 'consola'

// Helper function to check if a command exists
function isCommandAvailable(command: string): boolean {
  try {
    execSync(`${command} --version`, {stdio: 'ignore'})
    return true
  } catch (e) {
    console.error(e)
    return false
  }
}

// Detect Bun
function isBun(): boolean {
  // @ts-ignore: Bun may not be defined
  return typeof Bun !== 'undefined' && isCommandAvailable('bun')
}

// Detect npm
function isNpm(): boolean {
  return process.env.npm_execpath?.includes('npm') ?? false
}

// Detect Yarn
function isYarn(): boolean {
  return process.env.npm_execpath?.includes('yarn') ?? false
}

// Detect Deno
function isDeno(): boolean {
  // @ts-ignore: Deno may not be defined
  return typeof Deno !== 'undefined' && isCommandAvailable('deno')
}

// Detect pnpm
function isPnpm(): boolean {
  return process.env.npm_execpath?.includes('pnpm') ?? false
}

// Detect based on lock files
function detectByLockFiles(cwd: string): PackageManager | null {
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) {
    return 'bun'
  }
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
    return 'npm'
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn'
  }
  if (
    fs.existsSync(path.join(cwd, 'deno.json')) ||
    fs.existsSync(path.join(cwd, 'deno.lock'))
  ) {
    return 'deno'
  }
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }
  return null
}

export type PackageManager =
  | 'bun'
  | 'npm'
  | 'yarn'
  | 'pnpm'
  | 'deno'
  | 'unknown'

// Main detection function
export function detectPackageManager({
  preferredPm,
  cwd = process.cwd()
}: {
  preferredPm?: PackageManager
  cwd?: string
}): PackageManager {
  // Check the preferred package manager first
  if (preferredPm && isCommandAvailable(preferredPm)) {
    return preferredPm
  }

  // Proceed with detection logic
  if (isBun()) {
    return 'bun'
  }
  if (isNpm()) {
    return 'npm'
  }
  if (isPnpm()) {
    return 'pnpm'
  }
  if (isDeno()) {
    return 'deno'
  }
  if (isYarn()) {
    return 'yarn'
  }

  // Fallback to lock file detection
  const lockFileDetection = detectByLockFiles(cwd)
  if (lockFileDetection) {
    consola.info(`Detected package manager by lock file: ${lockFileDetection}`)
    if (isCommandAvailable(lockFileDetection)) {
      return lockFileDetection
    } else {
      consola.warn(
        `Lock file detected, but ${lockFileDetection} is not installed.`
      )
    }
  }

  return 'unknown'
}

type PackageManagerScript =
  | 'bun'
  | 'npm run'
  | 'yarn'
  | 'pnpm run'
  | 'deno task'

// Run script detection
export function getRunScript(pm: PackageManager): PackageManagerScript {
  switch (pm) {
    case 'bun':
      return 'bun'
    case 'npm':
      return 'npm run'
    case 'yarn':
      return 'yarn'
    case 'pnpm':
      return 'pnpm run'
    case 'deno':
      return 'deno task'
    default:
      // Default to npm run if unknown
      return 'npm run'
  }
}
