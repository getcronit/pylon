import {exec} from 'child_process'

import {loadPackageJson} from './load-package-json.js'

async function getServerURLs() {
  const packageJson = await loadPackageJson()

  const baseURL = packageJson.baseURL

  if (!baseURL) {
    throw new Error('No baseURL defined in package.json')
  }

  const apiURL = new URL('/graphql', baseURL).toString()
  const healthURL = new URL(
    '/graphql?query=%7B__typename%7D',
    apiURL
  ).toString()

  return {baseURL, apiURL, healthURL}
}
export async function generateClientWhenServerIsHealthy() {
  const {baseURL, apiURL, healthURL} = await getServerURLs()

  console.log(`Generating client when server is ready at ${baseURL}...`)

  await checkHealth(healthURL, () => {
    generateClient(apiURL)
  })
}

function generateClient(url: string) {
  const cmd = `yarn snek-query generate ${url} -o client`

  console.log('Generating client...')

  exec(cmd)
}

async function checkHealth(url: string, callback: () => void) {
  console.log('Checking server health...')

  while (true) {
    const response = await fetch(url)
    const text = await response.text()
    if (response.status === 200 && text === '{"data":{"__typename":"Query"}}') {
      callback()
      return
    }

    const truncatedText = `${text.slice(0, 100)}...`

    console.log(
      `Server not healthy yet. Status: ${response.status} Text: ${truncatedText}`
    )

    // Wait for 1 second before checking again
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}
