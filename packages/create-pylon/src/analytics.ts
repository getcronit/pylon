import {PostHog} from 'posthog-node'
import Conf from 'conf'
import {readFileSync} from 'fs'
import {randomUUID} from 'crypto'

const schema = {
  distinctId: {
    type: 'string',
    default: randomUUID()
  }
}

const config = new Conf<{
  distinctId: string
}>({
  projectName: 'pylon',
  schema
})

export const distinctId = config.get('distinctId')
export const sessionId = randomUUID()

export const analytics = new PostHog(
  'phc_KN4qCOcCdkXp6sHLIuMWGRfzZWuNht69oqv5Kw5rGxj',
  {
    host: 'https://eu.i.posthog.com',
    disabled: process.env.PYLON_DISABLE_TELEMETRY === 'true'
  }
)

const getPylonDependencies = () => {
  // Read the package.json file in the current directory
  let packageJson

  try {
    packageJson = JSON.parse(readFileSync('./package.json', 'utf8'))
  } catch (error) {
    packageJson = {}
  }

  // Extract the dependencies
  const dependencies: object = packageJson.dependencies || {}
  const devDependencies: object = packageJson.devDependencies || {}
  const peerDependencies: object = packageJson.peerDependencies || {}

  return {dependencies, devDependencies, peerDependencies}
}

export const dependencies = getPylonDependencies()

export const readPylonConfig = async () => {
  try {
    const config = await import(`${process.cwd()}/.pylon/config.js`)
    const data = config.config

    // Sanitize the config values
    const sanitizedData = JSON.parse(JSON.stringify(data)) as object

    // Check if the config is a empty object
    if (Object.keys(sanitizedData).length === 0) {
      return false
    }

    return sanitizedData
  } catch (error) {
    return false
  }
}
