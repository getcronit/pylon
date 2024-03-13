import _ from 'lodash'
import TransportStream from 'winston-transport'

import * as Sentry from '@sentry/bun'

interface Context {
  level?: any
  extra?: any
  fingerprint?: any
}

const errorHandler = (err: any) => {
  // eslint-disable-next-line
  console.error(err)
}

class WinstonSentryTransport extends TransportStream {
  protected name: string
  protected tags: {[s: string]: any}
  protected levelsMap: any

  constructor(opts: any) {
    super(opts)
    this.name = 'winston-sentry-log'
    this.tags = {}
    const options = opts

    _.defaultsDeep(opts, {
      errorHandler,
      config: {
        dsn: process.env.SENTRY_DSN
      },
      level: 'info',
      levelsMap: {
        silly: 'debug',
        verbose: 'debug',
        info: 'info',
        debug: 'debug',
        warn: 'warning',
        error: 'error'
      },
      name: 'winston-sentry-log',
      silent: false
    })

    this.levelsMap = options.levelsMap

    if (options.tags) {
      this.tags = options.tags
    } else if (options.globalTags) {
      this.tags = options.globalTags
    } else if (options.config.tags) {
      this.tags = options.config.tags
    }

    if (options.extra) {
      options.config.extra = options.config.extra || {}
      options.config.extra = _.defaults(options.config.extra, options.extra)
    }

    // if (!Sentry.getClient()) {
    //   Sentry.init({
    //     dsn: options.config.dsn,
    //     environment: process.env.NODE_ENV
    //   })
    // }

    Sentry.configureScope(scope => {
      if (!_.isEmpty(this.tags)) {
        Object.keys(this.tags).forEach(key => {
          scope.setTag(key, this.tags[key])
        })
      }
    })
  }

  public log(
    info: any,
    callback: any
  ): ((a: null, b: boolean) => unknown) | undefined {
    const {message, fingerprint} = info

    const level = Object.keys(this.levelsMap).find(key =>
      info.level.toString().includes(key)
    )
    if (!level) {
      return callback(null, true)
    }

    const meta = Object.assign({}, _.omit(info, ['level', 'message', 'label']))
    setImmediate(() => {
      this.emit('logged', level)
    })

    if (!!this.silent) {
      return callback(null, true)
    }

    const context: Context = {}
    context.level = this.levelsMap[level]
    context.extra = _.omit(meta, ['user', 'tags'])
    context.fingerprint = [fingerprint, process.env.NODE_ENV]
    Sentry.withScope(scope => {
      const user = _.get(meta, 'user')
      if (_.has(context, 'extra')) {
        Object.keys(context.extra).forEach(key => {
          scope.setExtra(key, context.extra[key])
        })
      }

      if (!_.isEmpty(meta.tags) && _.isObject(meta.tags)) {
        Object.keys(meta.tags).forEach(key => {
          scope.setTag(key, meta.tags[key])
        })
      }

      if (!!user) {
        scope.setUser(user)
      }

      if (context.level === 'error' || context.level === 'fatal') {
        let err: Error | null = null
        if (_.isError(info)) {
          err = info
        } else {
          err = new Error(message)
          if (info.stack) {
            err.stack = info.stack
          }
        }
        Sentry.captureException(err)
        return callback(null, true)
      }
      Sentry.captureMessage(message, context.level)
      return callback(null, true)
    })
    return undefined
  }
}

export default WinstonSentryTransport
