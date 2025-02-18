import fs from 'fs/promises'

export async function updateFileIfChanged(path: string, newContent: string) {
  try {
    const currentContent = await fs.readFile(path, 'utf8')
    if (currentContent === newContent) {
      return false // No update needed
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err // Ignore file not found error
  }

  await fs.writeFile(path, newContent, 'utf8')
  return true // File created or updated
}
