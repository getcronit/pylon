export const SCALARS: Record<string, string> = {
  String: 'string',
  ID: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  Number: 'number',
  Any: 'any',
  Void: 'void',
  JSONObject: 'object',
  File: 'File',
  Date: 'Date',
  JSON: 'object',
  DateTime: 'Date',
  DateTimeISO: 'Date'
} as const

export const SCALAR_NAMES = Object.keys(SCALARS)
