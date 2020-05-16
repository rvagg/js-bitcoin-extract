#!/usr/bin/env node

const fs = require('fs').promises
const path = require('path')
const test = require('bitcoin-block/test/test')

const { dataDir } = require('./config')

async function maxDir (dir) {
  const ls = (await fs.readdir(dir))
    .map((d) => d.padStart(7, '0')).filter(Boolean)
  ls.sort()
  const max = ls[ls.length - 1].replace(/^0+/g, '')
  return parseInt(max, 10)
}

async function bestBlockIndex () {
  const tld = await maxDir(path.join(dataDir, 'index'))
  const max = await maxDir(path.join(dataDir, 'index', String(tld)))
  return max
}

async function files (index) {
  const jsonFile = await fs.realpath(path.join(dataDir, 'index', String(Math.floor(index / 1000)), String(index)))
  const hash = path.basename(jsonFile).replace(/\.json$/, '')
  const hashDir = path.dirname(jsonFile)
  const binFile = path.join(hashDir, `${hash}.bin`)
  return { jsonFile, binFile, hash }
}

async function verify (index) {
  const { jsonFile, binFile, hash } = await files(index)
  const block = await fs.readFile(binFile)
  const expected = JSON.parse(await fs.readFile(jsonFile, 'utf8'))
  process.stdout.write(`${index} ${hash} ... `)
  test(hash, block, expected)
  process.stdout.write('\u001b[32m✔\u001b[39m')
}

async function run (start, limit) {
  if (!start) {
    start = await bestBlockIndex()
  }
  const end = limit ? start - limit : 0

  const times = []
  for (let i = start; i >= end; i--) {
    const startTime = Date.now()

    await verify(i)

    times.push(Date.now() - startTime)
    if (times.length > 100) {
      times.slice(times.length - 100)
    }

    const avg = times.reduce((p, c) => p + c, 0) / times.length
    const remaining = (avg * (i - end)) / 1000 / 60
    const rh = Math.floor(remaining / 60)
    const rm = Math.round(remaining - rh * 60)

    process.stdout.write(`  (avg time ${Math.round(avg)}ms, ${rh}h ${String(rm).padStart(2, '0')}m remaining)\n`)
  }
}

run(parseInt(process.argv[2], 10), process.argv[3] && parseInt(process.argv[3], 10)).catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
