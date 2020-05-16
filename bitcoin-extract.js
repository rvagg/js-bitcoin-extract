#!/usr/bin/env node

const { spawn } = require('child_process')
const assert = require('assert')
const fs = require('fs')
const { promisify } = require('util')
fs.mkdir = promisify(fs.mkdir)
fs.access = promisify(fs.access)
fs.writeFile = promisify(fs.writeFile)
fs.symlink = promisify(fs.symlink)
const bl = require('bl')

const { bitcoinCli, dataDir } = require('./config')

function assertHash (hash) {
  assert(typeof hash === 'string')
  assert(hash.length === 64)
}

async function execBitcoinCli (...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bitcoinCli, args, { shell: true })
    const stdout = bl()
    const stderr = bl()
    child.stdout.pipe(stdout)
    child.stderr.pipe(stderr)
    child.on('close', (code) => {
      if (code) {
        return reject(new Error(`Exited with non-zero code [${code}]: ${stderr.toString()}`))
      }
      if (stderr.length) {
        throw new Error(`Unexpected stderr: ${stderr.toString()}`)
      }
      resolve(stdout.toString())
    })
  })
}

async function getHashFromCmd (...cmd) {
  let stdout = await execBitcoinCli(...cmd)
  stdout = stdout.replace(/[\n\s]+/g, '')
  if (stdout.length !== 64) {
    throw new Error(`Unexpected response to getbestblockhash: ${stdout}`)
  }
  return stdout
}

async function getTipHash () {
  return getHashFromCmd('getbestblockhash')
}

async function getBlockHash (height) {
  assert(typeof height === 'number' && height >= 0)
  return getHashFromCmd('getblockhash', height)
}

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

function hashToDir (hash) {
  assertHash(hash)
  const l1 = hash.substring(62)
  const l2 = hash.substring(60, 62)
  return `${dataDir}/blocks/${l1}/${l2}`
}

function indexToDir (index) {
  assert(typeof index === 'number')
  const th = Math.floor(index / 1000)
  // const rem = index % th
  return `${dataDir}/index/${th}`
}

async function mkdir (dir) {
  return fs.mkdir(dir, { recursive: true })
}

async function exists (hash) {
  const dir = hashToDir(hash)

  const check = async (file) => {
    try {
      await fs.access(file, fs.constants.R_OK | fs.constants.F_OK)
    } catch (err) {
      return false
    }
    return true
  }

  const checked = await Promise.all([
    check(`${dir}/${hash}.json`),
    check(`${dir}/${hash}.bin`),
    check(`${dir}/${hash}.index`)
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
    fs.writeFile(`${ddir}/${hash}.json`, JSON.stringify(block), 'utf8'),
    fs.writeFile(`${ddir}/${hash}.bin`, Buffer.from(hex, 'hex')),
    fs.symlink(`${idir}/${block.height}`, `${ddir}/${hash}.index`),
    fs.symlink(`${ddir}/${hash}.json`, `${idir}/${block.height}`)
  ])
  return block
}

async function run (start, limit) {
  let hash
  if (parseInt(start, 10) > 0) {
    hash = await getBlockHash(parseInt(start, 10))
  } else if (!start || start.length !== 64) {
    hash = await getTipHash()
  } else {
    hash = start
  }
  console.log('Starting with hash', hash)
  let times = []
  let count = 0
  let lastSkipped = 0
  while (hash) {
    const start = Date.now()
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

    times.push(Date.now() - start)
    if (times.length > 100) {
      times = times.slice(times.length - 100)
    }
    const avg = times.reduce((p, c) => p + c, 0) / times.length
    const remaining = (avg * (limit > 0 ? limit - count : block.height)) / 1000 / 60
    const rh = Math.floor(remaining / 60)
    const rm = Math.round(rh ? remaining % rh : remaining)

    process.stdout.write(` ${hash} height=${block.height}`)
    process.stdout.write(`  (${rh}h ${String(rm).padStart(2, '0')}m remaining)\n`)

    hash = block.previousblockhash
    if (limit > 0 && ++count >= limit) {
      break
    } else if (limit < 0 && lastSkipped >= -limit) {
      break
    }
  }
}

run(process.argv[2], process.argv[3] ? parseInt(process.argv[3], 10) : undefined).catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
