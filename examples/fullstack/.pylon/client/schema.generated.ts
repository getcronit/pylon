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
  Date: {input: any; output: any}
  File: {input: any; output: any}
  JSON: {input: any; output: any}
  Number: {input: any; output: any}
  Object: {input: any; output: any}
  Void: {input: any; output: any}
}

export const scalarsEnumsHash: ScalarsEnumsHash = {
  Any: true,
  Boolean: true,
  Date: true,
  File: true,
  Float: true,
  ID: true,
  Int: true,
  JSON: true,
  Number: true,
  Object: true,
  String: true,
  Void: true
}
export const generatedSchema = {
  Author: {
    __typename: {__type: 'String!'},
    email: {__type: 'String!'},
    id: {__type: 'Number!'},
    name: {__type: 'String!'}
  },
  Post: {
    __typename: {__type: 'String!'},
    author: {__type: 'Author!'},
    content: {__type: 'String!'},
    id: {__type: 'Number!'},
    tags: {__type: '[String!]!'},
    title: {__type: 'String!'}
  },
  User: {
    __typename: {__type: 'String!'},
    email: {__type: 'String!'},
    id: {__type: 'Number!'},
    name: {__type: 'String!'},
    posts: {__type: '[Post!]!'}
  },
  mutation: {},
  query: {
    __typename: {__type: 'String!'},
    posts: {__type: '[Post!]!'},
    users: {__type: '[User!]!'}
  },
  subscription: {}
} as const

export interface Author {
  __typename?: 'Author'
  email: ScalarsEnums['String']
  id: ScalarsEnums['Number']
  name: ScalarsEnums['String']
}

export interface Post {
  __typename?: 'Post'
  author: Author
  content: ScalarsEnums['String']
  id: ScalarsEnums['Number']
  tags: Array<ScalarsEnums['String']>
  title: ScalarsEnums['String']
}

export interface User {
  __typename?: 'User'
  email: ScalarsEnums['String']
  id: ScalarsEnums['Number']
  name: ScalarsEnums['String']
  posts: Array<Post>
}

export interface Mutation {
  __typename?: 'Mutation'
}

export interface Query {
  __typename?: 'Query'
  posts: Array<Post>
  users: Array<User>
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
