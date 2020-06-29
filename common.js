const fs = require('fs').promises
fs.constants = require('fs').constants
const path = require('path')
const assert = require('assert')
const { spawn } = require('child_process')
const bl = require('bl')
const { type, bitcoinCli, dataDir } = require('./config')

const ipld = require(type === 'bitcoin' ? '@ipld/bitcoin' : '@ipld/zcash')
const multiformats = require('multiformats/basics.js')
multiformats.add(require('@ipld/dag-cbor'))
multiformats.add(ipld)
const CarDatastore = require('datastore-car')(multiformats)

function assertHash (hash) {
  assert(typeof hash === 'string')
  assert(hash.length === 64)
}

function hashToDir (hash) {
  assertHash(hash)
  const l1 = hash.substring(62)
  const l2 = hash.substring(60, 62)
  return `${dataDir}/blocks/${l1}/${l2}`
}

async function mkdir (dir) {
  return fs.mkdir(dir, { recursive: true })
}

async function fileExists (file) {
  try {
    await fs.access(file, fs.constants.R_OK | fs.constants.F_OK)
  } catch (err) {
    return false
  }
  return true
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

async function files (index) {
  const jsonFile = await fs.realpath(path.join(dataDir, 'index', String(Math.floor(index / 1000)), String(index)))
  const hash = path.basename(jsonFile).replace(/\.json$/, '')
  const hashDir = path.dirname(jsonFile)
  const binFile = path.join(hashDir, `${hash}.bin`)
  const carFile = path.join(hashDir, `${hash}.car`)
  return { jsonFile, binFile, carFile, hash }
}

async function readFiles (index, jsonFile, binFile, hash) {
  if (!jsonFile) {
    const f = await files(index)
    jsonFile = f.jsonFile
    binFile = f.binFile
    hash = f.hash
  }
  const bin = await fs.readFile(binFile)
  const json = JSON.parse(await fs.readFile(jsonFile, 'utf8'))
  return { jsonFile, json, binFile, bin, hash }
}

async function maxDir (dir) {
  const ls = (await fs.readdir(dir))
    .map((d) => d.padStart(7, '0')).filter(Boolean)
  ls.sort()
  if (!ls.length) {
    return -1
  }
  const max = ls[ls.length - 1].replace(/^0+/g, '')
  return parseInt(max, 10)
}

async function getBestBlockIndex () {
  const tld = await maxDir(path.join(dataDir, 'index'))
  if (tld < 0) {
    return tld
  }
  const max = await maxDir(path.join(dataDir, 'index', String(tld)))
  return max
}

async function args (argv, includeHash) {
  const start = parseInt(argv[2], 10) || 0
  let limit = argv[3] && parseInt(argv[3], 10)
  const bestBlockIndex = await getBestBlockIndex()
  let hash
  if (!limit) {
    limit = bestBlockIndex
  }
  if (includeHash) {
    if (start == argv[2]) { // eslint-disable-line
      hash = await getBlockHash(start)
    } else if (!start || start.length !== 64) {
      hash = await getTipHash()
    } else {
      hash = start
    }
  }
  const end = limit ? start - limit : 0

  return { start, limit, end, hash, bestBlockIndex }
}

async function run (start, limit, processBlock, progress = true) {
  let hash
  if (typeof start !== 'number') {
    hash = start
    start = 0
  }
  const times = []
  for (let ii = start; ii < limit; ii++) {
    const startTime = Date.now()

    const next = await processBlock(hash || ii)

    times.push(Date.now() - startTime)
    if (times.length > 100) {
      times.slice(times.length - 100)
    }

    const avg = times.reduce((p, c) => p + c, 0) / times.length
    const remaining = (avg * (limit - ii)) / 1000 / 60
    const rh = Math.floor(remaining / 60)
    const rm = Math.round(remaining - rh * 60)

    if (progress) {
      process.stdout.write(`  (avg time ${Math.round(avg)}ms, ${rh}h ${String(rm).padStart(2, '0')}m remaining)\n`)
    }

    if (hash) {
      if (!next) {
        break
      }
      hash = next
    }
  }
}

function cleanBlock (block) {
  if (type === 'bitcoin') {
    'confirmations chainwork height mediantime nextblockhash'.split(' ').forEach((p) => delete block[p])
  } else if (type === 'zcash') {
    'anchor chainhistoryroot root valuePools confirmations chainwork height nextblockhash'.split(' ').forEach((p) => delete block[p])
  }
  return block
}

module.exports.args = args
module.exports.run = run
module.exports.execBitcoinCli = execBitcoinCli
module.exports.getHashFromCmd = getHashFromCmd
module.exports.files = files
module.exports.readFiles = readFiles
module.exports.fileExists = fileExists
module.exports.mkdir = mkdir
module.exports.hashToDir = hashToDir
module.exports.assertHash = assertHash
module.exports.ipld = ipld
module.exports.CarDatastore = CarDatastore
module.exports.cleanBlock = cleanBlock
module.exports.multiformats = multiformats
