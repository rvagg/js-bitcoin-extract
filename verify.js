#!/usr/bin/env node

const test = require('bitcoin-block/test/test')
const { args, run, readFiles } = require('./common')

async function verify (index) {
  const { json: expected, bin: block, hash } = await readFiles(index)
  process.stdout.write(`${index} ${hash} ... `)
  test(hash, block, expected)
  process.stdout.write('\u001b[32m✔\u001b[39m')
}

async function exec () {
  const { start, limit } = await args(process.argv)
  await run(start, start + limit, verify)
}

exec().catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
