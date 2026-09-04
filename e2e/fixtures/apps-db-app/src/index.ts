// The root composes the apps: ONE merged GraphQL schema (shop + blog ops/types)
// at one /graphql, and each app's routes mounted. No defineApp, no compose() from
// pylon-app, no useApp — just `new Pylon().compose(...)`.
import {Pylon} from '@getcronit/pylon'
import {blog} from './apps/blog'
import {shop} from './apps/shop'

export default new Pylon().compose(shop, blog)
