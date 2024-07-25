import winston from 'winston'

import WinstonSentryTransport from './winston-sentry-transport'

const mainLogger = winston.createLogger({
  format: winston.format.errors({stack: true}),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({stack: true}),
        winston.format.printf(info => {
          const label = info.label ? `[${info.label}] ` : ''

          if (info.stack) {
            return `${label} ${info.timestamp} ${info.level}: ${info.stack}`
          }
          return `${label} ${info.timestamp} ${info.level}: ${info.message}`
        })
      )
    }),
    new WinstonSentryTransport({
      level: 'info',
      skipSentryInit: true
    })
  ]
})

/**
 * @deprecated Use `getLogger` instead
 *
 * import {getLogger} from '@getcronit/pylon'
 *
 * const logger = getLogger(__filename)
 */
export const logger = mainLogger

// Define the getLogger function
export const getLogger = (moduleName?: string): winston.Logger => {
  const childLogger = mainLogger.child({label: moduleName})

  // Override the child logger's child method to extend the label
  childLogger.child = (options: {label: string}) => {
    return getLogger(`${moduleName} -> ${options.label}`)
  }

  return childLogger
}
