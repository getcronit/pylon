import {defineConfig} from 'rolldown'

// create-pylon is a BUNDLED CLI (unlike the transpile-only framework): inline the local
// modules + `../package.json`, but keep every npm dependency + node builtin external —
// the equivalent of esbuild's `--bundle --packages=external` the build used before the
// repo standardized on rolldown.
export default defineConfig({
  input: './src/index.ts',
  platform: 'node',
  external: id => !id.startsWith('.') && !id.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(id),
  output: {
    file: './dist/index.js',
    format: 'esm',
    minify: true,
    sourcemap: true
  }
})
