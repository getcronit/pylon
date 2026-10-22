import {describe, expect, it} from 'vitest'
import type {ShapeField} from '@/query/runtime/doc'
import {isSatisfied} from '@/query/runtime/satisfied'

const ID = <T>(v: T): T => v

describe('isSatisfied', () => {
  it('no shape → always satisfied (hand-authored / mutation docs are ungated)', () => {
    expect(isSatisfied(undefined, {anything: true}, ID)).toBe(true)
  })

  it('all selected fields present → satisfied', () => {
    const shape: ShapeField[] = [{k: 'me', s: [{k: 'name'}, {k: 'age'}]}]
    expect(isSatisfied(shape, {me: {name: 'Ada', age: 36}}, ID)).toBe(true)
  })

  it('a selected field ABSENT from a present object → NOT satisfied (the hole)', () => {
    const shape: ShapeField[] = [
      {k: 'ticket', s: [{k: 'id'}, {k: 'timeline', s: [{k: 'totalCount'}]}]}
    ]
    // The shared entity exists but a narrower op populated it without `timeline`.
    expect(isSatisfied(shape, {ticket: {id: '1'}}, ID)).toBe(false)
  })

  it('a PRESENT-but-null field is satisfied (nullable / feature-gated null is a real answer)', () => {
    const shape: ShapeField[] = [
      {k: 'tasks', s: [{k: 'id'}]},
      {k: 'tickets', s: [{k: 'id'}]}
    ]
    // `tickets` gated off → resolves to null; the KEY is present, so no hole.
    expect(isSatisfied(shape, {tasks: {id: 't1'}, tickets: null}, ID)).toBe(true)
  })

  it('a nested hole below a present parent → NOT satisfied', () => {
    const shape: ShapeField[] = [
      {k: 'ticket', s: [{k: 'timeline', s: [{k: 'totalCount'}]}]}
    ]
    expect(isSatisfied(shape, {ticket: {timeline: {}}}, ID)).toBe(false)
  })

  it('lists: every element must satisfy the element shape', () => {
    const shape: ShapeField[] = [{k: 'posts', s: [{k: 'id'}, {k: 'title'}]}]
    expect(isSatisfied(shape, {posts: [{id: '1', title: 'A'}, {id: '2', title: 'B'}]}, ID)).toBe(true)
    expect(isSatisfied(shape, {posts: [{id: '1', title: 'A'}, {id: '2'}]}, ID)).toBe(false)
  })

  it('inline-fragment fields are only required on their concrete __typename', () => {
    const shape: ShapeField[] = [
      {k: 'node', s: [{k: 'id'}, {k: 'subject', t: 'Ticket'}, {k: 'due', t: 'Task'}]}
    ]
    // A Task node: `subject` (Ticket-only) is not required; `due` (Task) is.
    expect(isSatisfied(shape, {node: {__typename: 'Task', id: '1', due: 'x'}}, ID)).toBe(true)
    // A Task node missing its Task field → hole.
    expect(isSatisfied(shape, {node: {__typename: 'Task', id: '1'}}, ID)).toBe(false)
  })

  it('follows refs through deref into the live entity table', () => {
    const entities: Record<string, any> = {
      'Ticket:1': {__typename: 'Ticket', id: '1', timeline: {totalCount: 3}}
    }
    const deref = (v: any) => (v && v.__ref ? entities[v.__ref] : v)
    const shape: ShapeField[] = [
      {k: 'ticket', s: [{k: 'id'}, {k: 'timeline', s: [{k: 'totalCount'}]}]}
    ]
    expect(isSatisfied(shape, {ticket: {__ref: 'Ticket:1'}}, deref)).toBe(true)
    // Same op root, but the entity got overwritten without `timeline`.
    entities['Ticket:1'] = {__typename: 'Ticket', id: '1'}
    expect(isSatisfied(shape, {ticket: {__ref: 'Ticket:1'}}, deref)).toBe(false)
  })
})
