#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const { promisify } = require('util')
fs.access = promisify(fs.access)
fs.writeFile = promisify(fs.writeFile)
fs.symlink = promisify(fs.symlink)
fs.rename = promisify(fs.rename)
const { args, run, execBitcoinCli, fileExists, mkdir, hashToDir, assertHash } = require('./common')
const { dataDir } = require('./config')

async function getBlock (hash) {
  assertHash(hash)
  const stdout = await execBitcoinCli(`getblock ${hash} 2`)
  return JSON.parse(stdout)
}

async function getBlockHex (hash) {
  assertHash(hash)
  return execBitcoinCli('getblock', hash, '0')
}

async function getPreviousBlock (hash) {
  assertHash(hash)
  const stdout = await execBitcoinCli(`getblock ${hash} 1`)
  const block = JSON.parse(stdout)
  return block
}

function indexToDir (index) {
  assert(typeof index === 'number')
  const th = Math.floor(index / 1000)
  // const rem = index % th
  return `${dataDir}/index/${th}`
}

async function exists (hash) {
  const dir = hashToDir(hash)

  const checked = await Promise.all([
    fileExists(`${dir}/${hash}.json`),
    fileExists(`${dir}/${hash}.bin`),
    fileExists(`${dir}/${hash}.index`)
  ])

  return checked[0] && checked[1]
}

async function dump (hash) {
  assertHash(hash)
  const [block, hex] = await Promise.all([getBlock(hash), getBlockHex(hash)])
  const ddir = hashToDir(hash)
  const idir = indexToDir(block.height)
  await Promise.all([mkdir(ddir), mkdir(idir)])
  await Promise.all([
    fs.writeFile(`${ddir}/.${hash}.json`, JSON.stringify(block), 'utf8'),
    fs.writeFile(`${ddir}/.${hash}.bin`, Buffer.from(hex, 'hex'))
  ])
  await Promise.all([
    fs.rename(`${ddir}/.${hash}.json`, `${ddir}/${hash}.json`),
    fs.rename(`${ddir}/.${hash}.bin`, `${ddir}/${hash}.bin`),
    fs.symlink(`${idir}/${block.height}`, `${ddir}/${hash}.index`),
    fs.symlink(`${ddir}/${hash}.json`, `${idir}/${block.height}`)
  ])
  return block
}

async function exec () {
  const { hash, limit } = await args(process.argv, true)
  const skipLimit = parseInt(process.argv[4], 10)

  console.log('Starting with hash', hash)

  let lastSkipped = 0
  async function processBlock (hash) {
    let block
    if (await exists(hash)) {
      block = await getPreviousBlock(hash)
      process.stdout.write('Skipped')
      lastSkipped++
    } else {
      block = await dump(hash)
      process.stdout.write('Dumped ')
      lastSkipped = 0
    }

    process.stdout.write(` ${hash} height=${block.height}`)

    hash = block.previousblockhash
    if (skipLimit && lastSkipped >= skipLimit) {
      return null
    }
    return hash
  }

  await run(hash, limit, processBlock)
}

exec().catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
