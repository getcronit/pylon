const path = require('path')

const packageJson = require(path.join(process.cwd(), 'package.json'))

const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.peerDependencies
}

const cmd = `bun build ./src/index.ts --target=bun --outdir=./dist --sourcemap=external --external=${Object.keys(
  dependencies
).join(' --external=')}`

const {exec} = require('child_process')

exec(cmd, (err, stdout, stderr) => {
  if (err) {
    console.log(err)
    return
  }

  console.log(stdout)
  console.log(stderr)
})
