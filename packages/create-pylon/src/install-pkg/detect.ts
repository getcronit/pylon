import type {Agent} from 'package-manager-detector'
import process from 'node:process'
import {detect} from 'package-manager-detector/detect'
import consola from 'consola'

export type {Agent} from 'package-manager-detector'

export type PackageManager = Agent

export async function detectPackageManager(
  cwd = process.cwd()
): Promise<Agent | null> {
  const result = await detect({
    cwd,
    onUnknown(packageManager) {
      consola.warn('Unknown packageManager:', packageManager)
      return undefined
    }
  })

  return result?.agent || null
}

type PackageManagerScript =
  | 'bun'
  | 'npm run'
  | 'yarn'
  | 'pnpm run'
  | 'deno task'

export function getRunScript(
  agentSpecifier: PackageManager | null
): PackageManagerScript | null {
  if (agentSpecifier === null) return null

  const [agent] = agentSpecifier.split('@') // Extract agent name before '@'

  switch (agent) {
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
      return null
  }
}
