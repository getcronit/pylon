import {readFileSync} from 'fs'
import {
  createUseDataAnalyzerCore,
  type UseDataStaticAnalyzerOptions
} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/index'

/**
 * Run the useData static analyzer over a file and return its transformed source —
 * the analyzer's OWN output, with no bundler in the loop.
 *
 * This replaces the old `esbuild.build({plugins: [useDataStaticAnalyzer()]})`
 * harness: those tests snapshotted esbuild's *bundled* output (helpers, inlined
 * React, `export {}` rewrites, type-stripping), which coupled the analyzer's
 * assertions to a bundler's codegen. The analyzer is bundler-agnostic
 * (`createUseDataAnalyzerCore`), so we drive it directly.
 *
 * The core reports analysis failures (e.g. an unknown field) as `result.errors`
 * rather than throwing — esbuild used to turn those into a failed build. We
 * mirror that fail-loud behaviour by throwing here.
 */
type RunOptions = UseDataStaticAnalyzerOptions & {tsConfigFilePath?: string}

async function analyze(
  entries: string[],
  target: string,
  options: RunOptions
): Promise<{code: string; warnings: {text: string}[]}> {
  const core = createUseDataAnalyzerCore(options)
  core.start()
  core.addEntries(entries)
  const contents = readFileSync(target, 'utf8')
  const result = await core.transform({path: target}, contents)
  if (result?.errors?.length) {
    throw new Error(result.errors.map(e => e.text ?? String(e)).join('\n'))
  }
  return {
    code: result?.contents ?? contents,
    warnings: (result?.warnings ?? []).map(w => ({text: w.text ?? String(w)}))
  }
}

export async function runAnalyzer(
  filePath: string,
  options: RunOptions = {}
): Promise<string> {
  return (await analyze([filePath], filePath, options)).code
}

/**
 * Analyze `target` with the WHOLE `entries` graph loaded — needed for cross-file
 * aggregation, where a field accessed in one file must propagate through a hook
 * chain into a `useData()` in another. (The old esbuild harness passed every file
 * as an entryPoint to one plugin instance; this mirrors that with one core.)
 */
export async function runAnalyzerMulti(
  entries: string[],
  target: string,
  options: RunOptions = {}
): Promise<string> {
  return (await analyze(entries, target, options)).code
}

/** Like {@link runAnalyzer} but also returns the analyzer's warnings. */
export async function runAnalyzerResult(
  filePath: string,
  options: RunOptions = {}
): Promise<{code: string; warnings: {text: string}[]}> {
  return await analyze([filePath], filePath, options)
}
