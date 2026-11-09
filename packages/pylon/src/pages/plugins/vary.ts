/** Add `value` to a `Vary` header without duplicating an existing entry. */
export const appendVary = (headers: Headers, value: string): void => {
  const current = headers.get('Vary')
  if (!current) {
    headers.set('Vary', value)
    return
  }
  if (current.trim() === '*') return // already the broadest possible
  const present = current
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
  if (present.includes(value.toLowerCase())) return
  headers.set('Vary', `${current}, ${value}`)
}
