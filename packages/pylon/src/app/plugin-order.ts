import type {Plugin} from '..'

/**
 * Stable topological sort of plugins by `dependsOn` (referencing plugin `name`s).
 *
 * - Plugins with no constraints keep their original (array) order — so existing
 *   configs that declare no `dependsOn` are unaffected.
 * - A dependency whose name isn't in this list is IGNORED (it may load in the other
 *   strategy phase, which already runs before/after this one).
 * - A dependency cycle throws a clear error naming the plugins.
 *
 * Pure (no side effects) so it can be unit-tested directly.
 */
export function topoSortPlugins(plugins: Plugin[]): Plugin[] {
  const byName = new Map<string, Plugin>()
  for (const p of plugins) if (p.name) byName.set(p.name, p)

  const order = new Map<Plugin, number>(plugins.map((p, i) => [p, i]))
  const state = new Map<Plugin, 'visiting' | 'done'>()
  const out: Plugin[] = []

  const visit = (p: Plugin, stack: string[]) => {
    const s = state.get(p)
    if (s === 'done') return
    if (s === 'visiting') {
      throw new Error(
        `Pylon plugin dependency cycle: ${[...stack, p.name ?? '(anonymous)'].join(' → ')}`
      )
    }
    state.set(p, 'visiting')

    // Visit present dependencies first, in their original order (stability).
    const deps = (p.dependsOn ?? [])
      .map(n => byName.get(n))
      .filter((d): d is Plugin => !!d && d !== p)
      .sort((a, b) => order.get(a)! - order.get(b)!)
    for (const d of deps) visit(d, p.name ? [...stack, p.name] : stack)

    state.set(p, 'done')
    out.push(p)
  }

  for (const p of plugins) visit(p, [])
  return out
}
