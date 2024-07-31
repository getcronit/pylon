const cmd = `bun build ./src/index.ts --target=bun --outdir=./dist --sourcemap=external --packages external`

const {exec} = require('child_process')

exec(cmd, (err, stdout, stderr) => {
  if (err) {
    console.log(err)
    return
  }

  console.log(stdout)
  console.log(stderr)
})
