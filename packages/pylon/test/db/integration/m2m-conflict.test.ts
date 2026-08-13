/**
 * Guard: a cross-app many-to-many declared NON-inverse on BOTH sides means both
 * apps synthesize the same join table → a deploy collision. `appGroups()` must
 * fail early (build/diff time) with the fix, instead of a cryptic
 * "constraint already exists" at deploy. (Own registry, no DB.)
 */
import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {db, models, type ModelConfig} from '@/db/index'
import {appGroups} from '@/db/migration-groups'

class MCLeft extends models.Model {
  static config = {table: 'mc_left'} satisfies ModelConfig<MCLeft>
  static objects = db.manager(MCLeft)
  id = models.ID()
  rights = models.ManyToMany(() => MCRight) // non-inverse
}
new Pylon({name: 'mcleft', db: {models: [MCLeft]}})

class MCRight extends models.Model {
  static config = {table: 'mc_right'} satisfies ModelConfig<MCRight>
  static objects = db.manager(MCRight)
  id = models.ID()
  lefts = models.ManyToMany(() => MCLeft) // ALSO non-inverse → conflict
}
new Pylon({name: 'mcright', db: {models: [MCRight]}})

describe('cross-app m2m conflict guard', () => {
  it('appGroups() throws when both sides synthesize the same cross-app join', () => {
    expect(() => appGroups()).toThrow(/Cross-app many-to-many conflict/)
    expect(() => appGroups()).toThrow(/inverse: true/) // suggests the fix
  })
})
