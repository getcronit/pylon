import {Project, SourceFile} from 'ts-morph'
import * as crypto from 'crypto'

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

  constructor() {
    this.project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4, // ReactJSX
        moduleResolution: 2, // Node
        esModuleInterop: true,
        target: 9 // ESNext
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

// Singleton for cases where a shared instance isn't explicitly passed
export const globalAnalysisManager = new StaticAnalysisManager()
