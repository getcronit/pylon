import {YogaServerOptions} from 'graphql-yoga'
import {Context} from './context.js'

export {ServiceError} from './define-pylon.js'
export * from './auth/index.js'
export {
  Context,
  Env,
  Variables,
  Bindings,
  asyncContext,
  getContext,
  setContext
} from './context.js'
export {app} from './app/index.js'
export {graphqlHandler} from './app/handler/graphql-handler.js'
export {getEnv} from './get-env.js'
export {createDecorator} from './create-decorator.js'
export {createPubSub as experimentalCreatePubSub} from 'graphql-yoga'

export type PylonConfig = Pick<YogaServerOptions<Context, Context>, 'plugins'>

export type ID = string & {readonly brand?: unique symbol}
export type Int = number & {readonly brand?: unique symbol}
export type Float = number & {readonly brand?: unique symbol}
