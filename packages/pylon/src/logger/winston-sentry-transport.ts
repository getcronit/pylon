import * as Sentry from '@sentry/bun'
import TransportStream from 'winston-transport'

enum SentrySeverity {
  Debug = 'debug',
  Log = 'log',
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
  Fatal = 'fatal'
}

const DEFAULT_LEVELS_MAP: SeverityOptions = {
  silly: SentrySeverity.Debug,
  verbose: SentrySeverity.Debug,
  info: SentrySeverity.Info,
  debug: SentrySeverity.Debug,
  warn: SentrySeverity.Warning,
  error: SentrySeverity.Error
}

export interface SentryTransportOptions
  extends TransportStream.TransportStreamOptions {
  sentry?: Sentry.BunOptions
  levelsMap?: SeverityOptions
  skipSentryInit?: boolean
}

interface SeverityOptions {
  [key: string]: Sentry.SeverityLevel
}

class ExtendedError extends Error {
  constructor(info: any) {
    super(info.message)

    this.name = info.name || 'Error'
    if (info.stack && typeof info.stack === 'string') {
      this.stack = info.stack
    }
  }
}

export default class SentryTransport extends TransportStream {
  public silent = false

  private levelsMap: SeverityOptions = {}

  public constructor(opts?: SentryTransportOptions) {
    super(opts)

    this.levelsMap = this.setLevelsMap(opts && opts.levelsMap)
    this.silent = (opts && opts.silent) || false

    if (!opts || !opts.skipSentryInit) {
      Sentry.init(SentryTransport.withDefaults((opts && opts.sentry) || {}))
    }
  }

  public log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info)
    })

    if (this.silent) return callback()

    const {message, tags, user, ...meta} = info
    const winstonLevel = info['level']

    const sentryLevel = this.levelsMap[winstonLevel]

    const scope = Sentry.getCurrentScope()

    scope.clear()

    if (tags !== undefined && SentryTransport.isObject(tags)) {
      scope.setTags(tags)
    }

    scope.setExtras(meta)

    if (user !== undefined && SentryTransport.isObject(user)) {
      scope.setUser(user)
    }

    // TODO: add fingerprints
    // scope.setFingerprint(['{{ default }}', path]); // fingerprint should be an array

    // scope.clear();

    // TODO: add breadcrumbs
    // Sentry.addBreadcrumb({
    //   message: 'My Breadcrumb',
    //   // ...
    // });

    // Capturing Errors / Exceptions
    if (SentryTransport.shouldLogException(sentryLevel)) {
      const error =
        Object.values(info).find(value => value instanceof Error) ??
        new ExtendedError(info)
      Sentry.captureException(error, {tags, level: sentryLevel})

      return callback()
    }

    // Capturing Messages
    Sentry.captureMessage(message, sentryLevel)
    return callback()
  }

  end(...args: any[]) {
    Sentry.flush().then(() => {
      super.end(...args)
    })
    return this
  }

  public get sentry() {
    return Sentry
  }

  private setLevelsMap = (options?: SeverityOptions): SeverityOptions => {
    if (!options) {
      return DEFAULT_LEVELS_MAP
    }

    const customLevelsMap = Object.keys(options).reduce<SeverityOptions>(
      (acc: {[key: string]: any}, winstonSeverity: string) => {
        acc[winstonSeverity] = options[winstonSeverity]
        return acc
      },
      {}
    )

    return {
      ...DEFAULT_LEVELS_MAP,
      ...customLevelsMap
    }
  }

  private static withDefaults(options: Sentry.BunOptions) {
    return {
      ...options,
      dsn: (options && options.dsn) || process.env.SENTRY_DSN || '',
      serverName:
        (options && options.serverName) || 'winston-transport-sentry-node',
      environment:
        (options && options.environment) ||
        process.env.SENTRY_ENVIRONMENT ||
        process.env.NODE_ENV ||
        'production',
      debug: (options && options.debug) || !!process.env.SENTRY_DEBUG || false,
      sampleRate: (options && options.sampleRate) || 1.0,
      maxBreadcrumbs: (options && options.maxBreadcrumbs) || 100
    }
  }

  // private normalizeMessage(msg: any) {
  //   return msg && msg.message ? msg.message : msg;
  // }

  private static isObject(obj: any) {
    const type = typeof obj
    return type === 'function' || (type === 'object' && !!obj)
  }

  private static shouldLogException(level: Sentry.SeverityLevel) {
    return level === SentrySeverity.Fatal || level === SentrySeverity.Error
  }
}
