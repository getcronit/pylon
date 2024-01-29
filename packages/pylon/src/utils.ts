import {GraphQLResolveInfo} from 'graphql'
import {Context} from 'hono'

export const getContext = (args: IArguments): Context => args[args.length - 2]
export const getInfo = (args: IArguments): GraphQLResolveInfo | null =>
  args[args.length - 1] || null
