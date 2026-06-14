import {describe, expect, it} from 'vitest'
import {
  currentFeatures,
  currentFeatureState,
  FeatureDisabledError,
  featuresResolver,
  featureValue,
  isFeatureEnabled,
  requireFeature,
  runWithAppContext
} from '../src/index'

describe('feature gating (state model + provider seam)', () => {
  it('boolean + valued features: isEnabled (truthy) and featureValue', () => {
    runWithAppContext({features: {invoicing: true, seats: 5, checkout: 'v2', legacy: false}}, () => {
      expect(isFeatureEnabled('invoicing')).toBe(true)
      expect(isFeatureEnabled('seats')).toBe(true) // 5 is truthy
      expect(isFeatureEnabled('legacy')).toBe(false) // explicit false
      expect(isFeatureEnabled('missing')).toBe(false)
      expect(featureValue('seats', 0)).toBe(5)
      expect(featureValue('checkout', 'v1')).toBe('v2')
      expect(featureValue('missing', 42)).toBe(42) // fallback
    })
  })

  it('string[] sugar normalizes to {flag: true}; currentFeatures lists enabled flags', () => {
    runWithAppContext({features: ['a', 'b']}, () => {
      expect(isFeatureEnabled('a')).toBe(true)
      expect(currentFeatures().sort()).toEqual(['a', 'b'])
      expect(currentFeatureState()).toEqual({a: true, b: true})
    })
    // valued state: currentFeatures excludes falsy
    runWithAppContext({features: {a: true, b: false, c: 3}}, () => {
      expect(currentFeatures().sort()).toEqual(['a', 'c'])
    })
  })

  it('requireFeature throws FeatureDisabledError (FEATURE_DISABLED, not FORBIDDEN)', () => {
    runWithAppContext({features: ['x']}, () => {
      expect(() => requireFeature('x')).not.toThrow()
      let err: FeatureDisabledError | undefined
      try {
        requireFeature('premium')
      } catch (e) {
        err = e as FeatureDisabledError
      }
      expect(err).toBeInstanceOf(FeatureDisabledError)
      expect(err?.code).toBe('FEATURE_DISABLED')
      expect(err?.feature).toBe('premium')
    })
  })

  it('featuresResolver exposes the state for the frontend', () => {
    runWithAppContext({features: {invoicing: true, seats: 5}}, () => {
      expect(featuresResolver()).toEqual({invoicing: true, seats: 5})
    })
    // no context bound → empty
    expect(featuresResolver()).toEqual({})
  })
})
