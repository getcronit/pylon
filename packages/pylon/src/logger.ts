import winston from 'winston'

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(
      info => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  transports: [new winston.transports.Console()]
})

type FunctionWithArgs<T extends any[], R> = (...args: T) => R

export const logExecutionTime = <T extends any[], R>(
  fn: FunctionWithArgs<T, Promise<R>>,
  functionName: string
): FunctionWithArgs<T, Promise<R>> => {
  return async (...args: T): Promise<R> => {
    const startTime = new Date().getTime() // Start measuring function execution time

    const result = await fn(...args)

    const endTime = new Date().getTime() // End measuring function execution time
    const executionTime = endTime - startTime

    logger.info(`Function '${functionName}' execution time: ${executionTime}ms`)

    return result
  }
}
