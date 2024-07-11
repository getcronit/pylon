import winston from 'winston'

import WinstonSentryTransport from './winston-sentry-transport'

const mainLogger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.printf(({timestamp, level, message, label}) => {
          if (label) {
            return `${timestamp} [${label}] ${level}: ${message}`
          }

          // Workaround for the root logger
          return `${timestamp} ${level}: ${message}`
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
