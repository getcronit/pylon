/**
 * GQty AUTO-GENERATED CODE: PLEASE DO NOT MODIFY MANUALLY
 */

import {type ScalarsEnumsHash} from 'gqty'

export type Maybe<T> = T | null
export type InputMaybe<T> = Maybe<T>
export type Exact<T extends {[key: string]: unknown}> = {[K in keyof T]: T[K]}
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>
}
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>
}
export type MakeEmpty<T extends {[key: string]: unknown}, K extends keyof T> = {
  [_ in K]?: never
}
export type Incremental<T> =
  | T
  | {[P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never}
/** All built-in and custom scalars, mapped to their actual values */
export interface Scalars {
  ID: {input: string; output: string}
  String: {input: string; output: string}
  Boolean: {input: boolean; output: boolean}
  Int: {input: number; output: number}
  Float: {input: number; output: number}
  Any: {input: any; output: any}
  /** Date custom scalar type */
  Date: {input: any; output: any}
  File: {input: any; output: any}
  JSON: {input: any; output: any}
  Number: {input: number; output: number}
  Object: {input: Record<string, unknown>; output: Record<string, unknown>}
}

export const scalarsEnumsHash: ScalarsEnumsHash = {
  Any: true,
  Boolean: true,
  Date: true,
  File: true,
  JSON: true,
  Number: true,
  Object: true,
  String: true
}
export const generatedSchema = {
  mutation: {
    __typename: {__type: 'String!'},
    generateRandomQRCode: {__type: 'String!'}
  },
  query: {__typename: {__type: 'String!'}, qrCodes: {__type: '[String!]!'}},
  subscription: {}
} as const

export interface Mutation {
  __typename?: 'Mutation'
  generateRandomQRCode: ScalarsEnums['String']
}

export interface Query {
  __typename?: 'Query'
  qrCodes: Array<ScalarsEnums['String']>
}

export interface Subscription {
  __typename?: 'Subscription'
}

export interface GeneratedSchema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}

export type ScalarsEnums = {
  [Key in keyof Scalars]: Scalars[Key] extends {output: unknown}
    ? Scalars[Key]['output']
    : never
} & {}
