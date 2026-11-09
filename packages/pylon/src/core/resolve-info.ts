import {AsyncLocalStorage} from 'async_hooks'
import {FieldNode, GraphQLResolveInfo} from 'graphql'

export interface ExecutionContext {
  info: GraphQLResolveInfo
  selectedFields: {
    name: string
    fieldNodes: FieldNode[]
    returnType?: any
  }[]
}

export const executionAsyncContext = new AsyncLocalStorage<ExecutionContext>()

export const getResolveInfo = () => {
  const store = executionAsyncContext.getStore()

  if (!store) {
    throw new Error('Resolve info is not available')
  }

  return store
}
