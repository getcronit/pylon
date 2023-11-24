import winston from 'winston'

const isProduction = process.env.NODE_ENV === 'production'

export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(
      info =>
        `${info.timestamp} ${info.level}: ${info.message} ${
          info.meta ? JSON.stringify(info.meta) : ''
        }`
    )
  ),
  transports: [new winston.transports.Console()]
})
