export async function importFresh(modulePath: string) {
  const cacheBustingModulePath = `${modulePath}?update=${Date.now()}`
  return await import(cacheBustingModulePath)
}
