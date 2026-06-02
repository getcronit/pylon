import * as crypto from 'crypto'
import {Project, SourceFile} from 'ts-morph'

export interface AnalysisResult {
  contents: string
  dependencies: string[]
  hash: string
}

export class StaticAnalysisManager {
  private project: Project
  private cache: Map<string, AnalysisResult> = new Map()
  private sessionResults: Map<string, AnalysisResult> = new Map()
  private lastSessionReset: number = 0
  constructor(options: {tsConfigFilePath?: string}) {
    this.project = new Project({
      tsConfigFilePath: options.tsConfigFilePath,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        jsx: 4, // ReactJSX
        moduleResolution: 2, // Node
        esModuleInterop: true,
        target: 9, // ESNext
        noLib: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true
      }
    })

    // Create a virtual empty file to mock all node_modules / third-party imports
    this.project.createSourceFile('/node_modules_dummy.ts', 'export {};', {overwrite: true})

    // Update compilerOptions.paths to redirect all unresolved non-relative imports to the dummy file
    const compilerOptions = this.project.getCompilerOptions()
    const originalPaths = compilerOptions.paths || {}
    this.project.compilerOptions.set({
      ...compilerOptions,
      paths: {
        ...originalPaths,
        '*': ['/node_modules_dummy.ts']
      }
    })
  }

  /**
   * Resets the session cache if enough time has passed since the last reset.
   * This allows client and server builds starting together to share results.
   */
  public resetSession() {
    const now = Date.now()
    if (now - this.lastSessionReset > 500) {
      this.sessionResults.clear()
      this.lastSessionReset = now
    }
  }

  public getProject() {
    return this.project
  }

  public getCachedResult(path: string, content: string): AnalysisResult | null {
    const hash = this.computeHash(content)

    // Check session first (deduplicates client/server runs)
    const sessionResult = this.sessionResults.get(path)
    if (sessionResult && sessionResult.hash === hash) {
      return sessionResult
    }

    // Check long-term cache
    const cached = this.cache.get(path)
    if (cached && cached.hash === hash) {
      // We still need to verify dependencies in the long-term cache
      // but for now, we'll keep it simple and focus on session deduplication
      return cached
    }

    return null
  }

  public setCache(path: string, result: AnalysisResult) {
    this.cache.set(path, result)
    this.sessionResults.set(path, result)
  }

  public updateSourceFile(path: string, content: string): SourceFile {
    const existing = this.project.getSourceFile(path)
    if (existing) {
      if (existing.getFullText() !== content) {
        existing.replaceWithText(content)
      }
      return existing
    }
    return this.project.createSourceFile(path, content, {overwrite: true})
  }

  private computeHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex')
  }
}
