import crypto from 'crypto'
import os from 'os'

import {getRuntimeKey} from 'hono/adapter'

import {createRequire as createImportMetaRequire} from 'module'
// @ts-ignore
import.meta.require ||= id => createImportMetaRequire(import.meta.url)(id)

// @ts-ignore
// prettier-ignore
const getEnv = await import('@getcronit/pylon').then(m => m.getEnv).catch(() => () => process.env)

// @ts-ignore
// prettier-ignore
const a = (function(){var R=Array.prototype.slice.call(arguments),X=R.shift();return R.reverse().map(function(i,D){return String.fromCharCode(i-X-26-D)}).join('')})(63,162,164,206,160,162,158,205,156,203,202,154,150,149,149,147,149,151,148,146,140,143,188)+(649979179260519).toString(36).toLowerCase()+(725430515880572).toString(36).toLowerCase()+(13551800594).toString(36).toLowerCase()+(function(){var A=Array.prototype.slice.call(arguments),P=A.shift();return A.reverse().map(function(M,R){return String.fromCharCode(M-P-2-R)}).join('')})(14,118,119,75,68,118)+(3158761452024).toString(36).toLowerCase()+(function(){var R=Array.prototype.slice.call(arguments),i=R.shift();return R.reverse().map(function(S,w){return String.fromCharCode(S-i-31-w)}).join('')})(32,112)

const generateInstanceId = (): string => {
  try {
    // Get the hostname
    const hostname = os.hostname()

    // Hash the hostname
    const hash = crypto.createHash('sha256').update(hostname).digest('hex')

    // Return the hashed hostname
    return hash
  } catch (error) {
    console.error('Error generating instance ID:', error)
    throw error
  }
}

// Example usage
const instanceId = generateInstanceId()

let versionCache: Record<string, string> = {}

const versionOrUndefined = (name: string): string => {
  // Check if the version is already cached
  if (versionCache[name]) {
    return versionCache[name]
  }

  try {
    // Load the version from package.json
    const version = require(`${name}/package.json`).version
    // Cache the version
    versionCache[name] = version
    return version
  } catch (error) {
    // Cache 'unknown' if there's an error (e.g., package not found)
    versionCache[name] = 'unknown'
    return 'unknown'
  }
}

export const getVersions = () => {
  const telemetryVersion = versionOrUndefined('@getcronit/pylon-telemetry')
  const pylonDevVersion = versionOrUndefined('@getcronit/pylon-dev')

  const pylonVersion = versionOrUndefined('@getcronit/pylon')
  const pylonBuilderVersion = versionOrUndefined('@getcronit/pylon-builder')

  return {
    telemetryVersion,
    pylonDevVersion,
    pylonVersion,
    pylonBuilderVersion
  }
}

const sendEvent = async (
  type:
    | 'PYLON_VERSION'
    | 'PYLON_DEV'
    | 'PYLON_BUILD'
    | 'PYLON_CREATE'
    | 'PYLON_FUNCTION',
  payload: {
    telemetryVersion: string
    pylonVersion?: string
    pylonCreateVersion?: string
    pylonBuilderVersion?: string
    pylonDevVersion?: string
    isDevelopment?: boolean
    duration?: number
    totalFiles?: number
    totalSize?: number
    name?: string
    runtime?: string
    template?: string
    clientPath?: string
    clientPort?: number
  }
) => {
  const env = getEnv(
    // @ts-ignore
    true
  )

  // @ts-ignore
  if (!env.PYLON_TELEMETRY_DISABLED === '1') {
    return
  }

  const query = `
mutation Event($instanceId: String!, $payload: EventPayloadInput!) {
  event(instanceId: $instanceId, payload: $payload) {
    id
  }
}
`

  const variables = {
    instanceId,
    payload: {
      type,
      timestamp: new Date().getTime(),
      runtime: getRuntimeKey(),
      ...payload
    }
  }

  // @ts-ignore
  if (env.PYLON_TELEMETRY_DEBUG) {
    console.log(`[Pylon Telemetry]`, variables.payload)
  }

  try {
    await fetch('https://pylon-telemetry.cronit.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        EVENT_SHARED_SECRET: a
      },
      body: JSON.stringify({
        query: query,
        variables: variables
      })
    })
  } catch {
    // nop
  }
}

export const sendVersionEvent = async () => {
  const versions = getVersions()

  await sendEvent('PYLON_VERSION', {
    telemetryVersion: versions.telemetryVersion,
    pylonVersion: versions.pylonVersion,
    pylonDevVersion: versions.pylonDevVersion,
    pylonBuilderVersion: versions.pylonBuilderVersion
  })
}

export const sendDevEvent = async (payload: {
  duration: number
  clientPath?: string
  clientPort?: number
}) => {
  const versions = getVersions()

  await sendEvent('PYLON_DEV', {
    telemetryVersion: versions.telemetryVersion,
    pylonVersion: versions.pylonVersion,
    pylonDevVersion: versions.pylonDevVersion,
    pylonBuilderVersion: versions.pylonBuilderVersion,
    isDevelopment: true,
    ...payload
  })
}

export const sendBuildEvent = async (payload: {
  duration: number
  totalFiles: number
  totalSize: number
  isDevelopment: boolean
}) => {
  const versions = getVersions()

  await sendEvent('PYLON_BUILD', {
    telemetryVersion: versions.telemetryVersion,
    pylonVersion: versions.pylonVersion,
    pylonBuilderVersion: versions.pylonBuilderVersion,
    ...payload
  })
}

export const sendCreateEvent = async (payload: {
  pylonCreateVersion: string
  name: string
  runtime: string
  template: string
  clientPath?: string
  clientPort?: number
}) => {
  const versions = getVersions()

  await sendEvent('PYLON_CREATE', {
    ...versions,
    ...payload
  })
}

export const sendFunctionEvent = async (payload: {
  name: string
  duration: number
}) => {
  const versions = getVersions()

  await sendEvent('PYLON_FUNCTION', {
    telemetryVersion: versions.telemetryVersion,
    pylonVersion: versions.pylonVersion,
    pylonBuilderVersion: versions.pylonBuilderVersion,
    ...payload
  })
}
