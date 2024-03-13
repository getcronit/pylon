import winston from 'winston'

import WinstonSentryTransport from './winston-sentry-transport'

export const logger = winston.createLogger({
  transports: [
    new WinstonSentryTransport({
      level: 'info'
    })
  ]
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple()
    })
  )
}
