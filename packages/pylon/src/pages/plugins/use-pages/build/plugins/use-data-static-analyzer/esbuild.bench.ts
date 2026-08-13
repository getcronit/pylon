import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'
import {bench, describe} from 'vitest'
import {useDataStaticAnalyzer} from './index'

describe('esbuild plugin performance', () => {
  const tempDir = path.join(__dirname, 'temp_bench_project')

  const runBuild = async () => {
    try {
      await esbuild.build({
        entryPoints: fs
          .readdirSync(tempDir)
          .filter(f => f.startsWith('Page'))
          .map(f => path.join(tempDir, f)),
        bundle: true,
        write: false,
        outdir: 'dist',
        plugins: [
          useDataStaticAnalyzer({
            pylonPackage: '@getcronit/pylon-pages',
            debug: false
          })
        ],
        logLevel: 'silent'
      })
    } catch (err) {
      console.error('ESBUILD ERROR:', err)
      throw err
    }
  }

  bench(
    'esbuild build with 200+ files',
    async () => {
      await runBuild()
    },
    {
      iterations: 1,
      setup() {
        if (true) {
          if (fs.existsSync(tempDir)) fs.rmSync(tempDir, {recursive: true})
          fs.mkdirSync(tempDir, {recursive: true})
          fs.mkdirSync(path.join(tempDir, 'utils'), {recursive: true})
          fs.mkdirSync(path.join(tempDir, 'components'), {recursive: true})

          const noiseText = '/* ' + 'noise '.repeat(1000) + ' */\n'

          // 5 utils
          for (let i = 1; i <= 5; i++) {
            let content = `${noiseText}`
            if (i === 5) {
              content += `export function getData(d: any) { return d.final; }`
            } else {
              const nextFn = i === 4 ? 'getData' : `wrap${i + 1}`
              content += `import { ${nextFn} } from "./level${i + 1}"; export function wrap${i}(d: any) { return ${nextFn}(d); }`
            }
            fs.writeFileSync(
              path.join(tempDir, 'utils', `level${i}.ts`),
              content
            )
          }

          // 200 noise components
          for (let i = 0; i < 200; i++) {
            fs.writeFileSync(
              path.join(tempDir, 'components', `Noise${i}.tsx`),
              `
        import React from 'react';
        import { useData } from '@getcronit/pylon-pages';
        ${noiseText}
        export function Noise${i}() { 
          const data = useData();
          return <div>Noise ${i} {data.id}</div>; 
        }
      `
            )
          }

          // 20 "real" pages using useData
          const entryPoints: string[] = []
          for (let i = 0; i < 20; i++) {
            const noiseImports = Array.from(
              {length: 10},
              (_, j) => `import { Noise${j} } from './components/Noise${j}';`
            ).join('\n')
            const pathStr = path.join(tempDir, `Page${i}.tsx`)
            entryPoints.push(pathStr)
            fs.writeFileSync(
              pathStr,
              `
        import { useData } from '@getcronit/pylon-pages';
        import { wrap1 } from './utils/level1';
        ${noiseImports}
        
        export default function Page${i}() {
          const data = useData();
          const value = wrap1(data.field_${i});
          return <div>{value} ${Array.from({length: 10}, (_, j) => `<Noise${j} />`).join(' ')}</div>;
        }
      `
            )
          }
        }
      },
      teardown() {
        fs.rmSync(tempDir, {recursive: true})
      }
    }
  )
})
