import {describe, expect, it, vi} from 'vitest'
import {
  createTranslator,
  interpolate,
  loadCatalog,
  lookup,
  mergeCatalogs
} from '../../src/pages/plugins/use-pages/catalog'

describe('interpolate', () => {
  it('substitutes named placeholders', () => {
    expect(interpolate('Total: {amount} for {count}', {amount: '12', count: 3})).toBe(
      'Total: 12 for 3'
    )
  })

  it('leaves an unknown placeholder verbatim', () => {
    // A visible `{count}` says exactly what is wrong; the string "undefined" does not.
    expect(interpolate('a {count} b', {other: 1})).toBe('a {count} b')
  })

  it('is a no-op without values', () => {
    expect(interpolate('plain')).toBe('plain')
  })

  it('repeats a placeholder used twice', () => {
    expect(interpolate('{x}-{x}', {x: 'a'})).toBe('a-a')
  })
})

describe('mergeCatalogs', () => {
  it('overlays the active locale on the fallback', () => {
    const merged = mergeCatalogs(
      {nav: {home: 'Home', about: 'About'}},
      {nav: {home: 'Startseite'}}
    )
    // Translated key wins; untranslated one survives from the fallback.
    expect(merged).toEqual({nav: {home: 'Startseite', about: 'About'}})
  })

  it('merges deeply rather than replacing a branch', () => {
    const merged = mergeCatalogs(
      {a: {b: {c: 'en-c', d: 'en-d'}}},
      {a: {b: {c: 'de-c'}}}
    )
    expect(merged).toEqual({a: {b: {c: 'de-c', d: 'en-d'}}})
  })

  it('does not mutate its inputs', () => {
    const fallback = {nav: {home: 'Home'}}
    mergeCatalogs(fallback, {nav: {home: 'Startseite'}})
    expect(fallback).toEqual({nav: {home: 'Home'}})
  })
})

describe('lookup', () => {
  const messages = {nav: {home: 'Home'}, checkout: {total: 'T'}}

  it('resolves a dotted path', () => {
    expect(lookup(messages, 'nav.home')).toBe('Home')
  })

  it('returns undefined for a miss rather than throwing', () => {
    expect(lookup(messages, 'nav.missing')).toBeUndefined()
    expect(lookup(messages, 'nope.nope.nope')).toBeUndefined()
  })

  it('returns undefined for a branch, which is not a message', () => {
    expect(lookup(messages, 'nav')).toBeUndefined()
  })
})

describe('createTranslator', () => {
  const messages = {
    nav: {home: 'Home'},
    checkout: {total: 'Total: {amount} for {count} items'}
  }

  it('translates and interpolates', () => {
    const t = createTranslator(messages)
    expect(t('checkout.total', {amount: '12', count: 3})).toBe('Total: 12 for 3 items')
  })

  it('scopes keys to a namespace', () => {
    const t = createTranslator(messages, 'checkout')
    expect(t('total', {amount: '1', count: 1})).toBe('Total: 1 for 1 items')
  })

  it('returns the key and warns when a message is missing', () => {
    // Renders something traceable and greppable, keeps the page up. An empty string would
    // silently delete UI; throwing would take down a page over a copy edit.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = createTranslator(messages)
    expect(t('nav.nothing' as never)).toBe('nav.nothing')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nav.nothing'))
    warn.mockRestore()
  })

  it('reports the FULL key when namespaced, not the bare one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createTranslator(messages, 'checkout')('nope' as never)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('checkout.nope'))
    warn.mockRestore()
  })
})

describe('loadCatalog', () => {
  it('accepts a plain object', async () => {
    expect(await loadCatalog({a: '1'})).toEqual({a: '1'})
  })

  it('unwraps a module default export', async () => {
    expect(await loadCatalog(async () => ({default: {a: '1'}}))).toEqual({a: '1'})
  })

  it('accepts a function returning messages directly', async () => {
    expect(await loadCatalog(() => ({a: '1'}))).toEqual({a: '1'})
  })
})
