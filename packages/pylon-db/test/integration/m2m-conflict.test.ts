/**
 * Guard: a cross-app many-to-many declared NON-inverse on BOTH sides means both
 * apps synthesize the same join table → a deploy collision. `appGroups()` must
 * fail early (build/diff time) with the fix, instead of a cryptic
 * "constraint already exists" at deploy. (Own registry, no DB.)
 */
import {describe, expect, it} from 'vitest'
import {db, models} from '../../src/index'
import {appGroups} from '../../src/migration-groups'

const left = models.app('mcleft')
const right = models.app('mcright')

@left.model({table: 'mc_left'})
class MCLeft extends left.Model {
  static objects = db.manager(MCLeft)
  id = left.ID()
  rights = left.ManyToMany(() => MCRight) // non-inverse
}

@right.model({table: 'mc_right'})
class MCRight extends right.Model {
  static objects = db.manager(MCRight)
  id = right.ID()
  lefts = right.ManyToMany(() => MCLeft) // ALSO non-inverse → conflict
}

describe('cross-app m2m conflict guard', () => {
  it('appGroups() throws when both sides synthesize the same cross-app join', () => {
    expect(() => appGroups()).toThrow(/Cross-app many-to-many conflict/)
    expect(() => appGroups()).toThrow(/inverse: true/) // suggests the fix
  })
})
