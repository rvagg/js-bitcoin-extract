#!/usr/bin/env node

// CarDatastore.readFileIndexed() gets big for large files, it may need to be run with:
// NODE_OPTIONS="--max-old-space-size=16384"

const assert = require('assert')
const fs = require('fs').promises
fs.createReadStream = require('fs').createReadStream
const path = require('path')
const { ipld, multiformats, CarDatastore, args, run, files, mkdir, hashToDir } = require('./common')
const { type, dataDir } = require('./config')

const carHeaderSize = 60
const chunkIndexDir = path.join(dataDir, 'chunks/index')
const chunkCarDir = path.join(dataDir, 'chunks/car')

const targetSize = 1024 * 1024 * 1010 - carHeaderSize // 1010 Mb

let chunk = []
let chunkSize = 0
let binChunkSize = 0

function groupStr (ii) {
  if (ii !== Math.floor(ii)) {
    return String(ii).replace(/\d{1,3}(?=(\d{3})+(?=\.))/g, '$&,')
  }
  return String(ii).replace(/\d{1,3}(?=(\d{3})+)/g, '$&,')
}

function sizeStr (size) {
  let mb = size / 1024 / 1024
  mb = Math.round(mb * 100) / 100
  return `${groupStr(mb)} Mb`
}

async function index (index) {
  const { carFile, binFile, hash } = await files(index)

  const [carSize, binSize] = (await Promise.all([
    fs.stat(carFile),
    fs.stat(binFile)
  ])).map((s) => s.size)

  const outSize = carSize - carHeaderSize

  if (chunkSize + outSize > targetSize) {
    if (chunkSize > targetSize) {
      console.log(chunk)
      throw new Error('single block larger than 1Gb?')
    }
    const name = `${String(chunk[0].index).padStart(7, '0')}-${String(chunk[chunk.length - 1].index).padStart(7, '0')}`
    console.log(`${name} with ${chunk.length} blocks @ ${sizeStr(chunkSize)} vs raw ${sizeStr(binChunkSize)}`)
    await fs.writeFile(path.join(chunkIndexDir, `${name}.json`), JSON.stringify(chunk, null, 2), 'ascii')
    chunk = []
    chunkSize = 0
    binChunkSize = 0
  }

  chunk.push({ index, hash, size: outSize, originalSize: binSize })
  chunkSize += outSize
  binChunkSize += binSize
}

async function consolidate (start, skip) {
  let chunkList = await fs.readdir(chunkIndexDir)
  chunkList = chunkList.map((chunkIndex, num) => ({ num, chunkIndex }))
  chunkList = chunkList.slice(start).filter((_, i) => i % skip === 0)
  for (const { num, chunkIndex } of chunkList) {
    const index = JSON.parse(await fs.readFile(path.join(chunkIndexDir, chunkIndex)))
    const carOutFile = path.join(chunkCarDir, chunkIndex.replace(/\.json$/, '.car'))
    await consolidateChunk(num, index, carOutFile)
  }
}

async function consolidateChunk (num, index, carOutFile) {
  process.stdout.write(`Consolidating #${num} ${carOutFile} ... `)

  const cidSet = new Set()
  let duplicates = 0
  const outStream = fs.createWriteStream(carOutFile)
  const carOut = await CarDatastore.writeStream(outStream)

  let chadv = 0
  let ii = 0
  for (const { hash } of index.reverse()) {
    const hashCid = ipld.blockHashToCID(multiformats, hash)
    if (ii++ === 0) {
      await carOut.setRoots([hashCid])
    }
    const carFile = path.join(hashToDir(hash), `${hash}.car`)
    const inStream = fs.createReadStream(carFile)
    const carDs = await CarDatastore.readStreaming(inStream)
    const [rootCid] = await carDs.getRoots()
    assert.strictEqual(rootCid.toString(), hashCid.toString())
    const msg = `${groupStr(Math.round((ii / index.length) * 1000) / 10)}% (${groupStr(ii)} / ${groupStr(index.length)})    `
    if (chadv) {
      process.stdout.write(`\x1b[${chadv}D`)
    }
    process.stdout.write(msg)
    chadv = msg.length
    for await (const { key: cid, value: binary } of carDs.query()) {
      const cidStr = cid.toString()
      if (cidSet.has(cidStr)) {
        duplicates++
        continue
      }
      cidSet.add(cidStr)
      await carOut.put(cid, binary)
    }
    await carDs.close()
  }
  console.log(`${groupStr(cidSet.size)} blocks, ${duplicates} dupes`)
}

const nameRe = /^(\d+)-(\d+)\.car$/
async function lsIndex () {
  return (await fs.readdir(chunkCarDir))
    .filter((f) => nameRe.test(f))
    .map((name) => {
      const match = name.match(nameRe)
      const start = parseInt(match[1], 10)
      const end = parseInt(match[2], 10)
      return {
        name,
        start,
        end,
        path: path.join(chunkCarDir, name)
      }
    })
}

async function verify (start) {
  console.log('Starting at', start)
  const index = (await lsIndex()).filter((ii) => ii.start <= start)

  let expectedRoot = ipld.blockHashToCID(multiformats, (await files(start)).hash)

  for (const chunk of index.reverse()) {
    const { hash } = await files(chunk.end)
    console.log(`Loading CAR ${chunk.path} ...`)
    const carDs = await CarDatastore.readFileIndexed(chunk.path)
    const loader = async (cid) => carDs.get(cid)
    // check that the CAR has a proper root
    assert.deepStrictEqual((await carDs.getRoots()).map((c) => c.toString()), [ipld.blockHashToCID(multiformats, hash).toString()])
    process.stdout.write('Done, processing ... ')

    let chadv = 0
    let ii = start
    const length = start - chunk.start

    while (ii >= chunk.start) {
      const { binFile, hash } = await files(ii)
      const expectedBin = await fs.readFile(binFile)
      const rootCid = ipld.blockHashToCID(multiformats, hash)

      const header = multiformats.decode(await carDs.get(rootCid), `${type}-block`)
      assert.strictEqual(rootCid.toString(), expectedRoot.toString())
      expectedRoot = header.parent
      // verify
      const { binary } = await ipld.assemble(multiformats, loader, rootCid)
      assert.strictEqual(binary.compare(expectedBin), 0, `round-trip binary form matches for block #${ii}`)
      ii--

      const ind = ii - chunk.start
      const msg = `${groupStr(Math.round(((length - ind) / length) * 1000) / 10)}% (${groupStr(length - ind)} / ${groupStr(length)})    `
      if (chadv) {
        process.stdout.write(`\x1b[${chadv}D`)
      }
      process.stdout.write(msg)
      chadv = msg.length
    }

    start = chunk.start - 1
    await carDs.close()
    console.log()
  }
}

async function exec () {
  const mode = process.argv[2]
  if (mode === 'index') {
    const argv = process.argv.splice(2, 1)
    const { start, limit } = await args(argv)
    await mkdir(chunkIndexDir)
    await run(start, start + limit, index, false)
  } else if (mode === 'consolidate') {
    const start = parseInt(process.argv[3], 10)
    const skip = parseInt(process.argv[4], 10)
    if (start !== +process.argv[3]) {
      throw new Error('Need start argument')
    }
    if (skip !== +process.argv[4]) {
      throw new Error('Need skip argument')
    }
    await mkdir(chunkCarDir)
    await consolidate(start, skip)
  } else if (mode === 'verify') {
    let start = parseInt(process.argv[3], 10)
    if (start !== +process.argv[3]) {
      const ls = await lsIndex()
      if (!ls || !ls.length) {
        throw new Error('Bad index?')
      }
      start = ls[ls.length - 1].end
    }
    await verify(start)
  } else {
    throw new Error(`Unknown command: ${process.argv[2]}`)
  }
}

exec().catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
