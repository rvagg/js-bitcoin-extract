#!/usr/bin/env node

const assert = require('assert')
const path = require('path')
const fs = require('fs')
const {
  ipld,
  CarDatastore,
  multiformats,
  cleanBlock,
  args,
  run,
  files,
  readFiles,
  fileExists
} = require('./common')
const { type /* , dataDir */ } = require('./config')

// const fauxWitCommitListFile = path.join(dataDir, 'faux-witness-commitment-blocks.json')

// round difficulty to 2 decimal places, it's a calculated value
function roundDifficulty (block) {
  block.difficulty = Math.round(block.difficulty * 100) / 100
  return block
}

function isSegWit (block) {
  return block.tx[0].txid !== block.tx[0].hash
}

/*
async function recordFauxWitCommit (index, hash) {
  let list = []
  try {
    list = JSON.parse(await fs.promises.readFile(fauxWitCommitListFile, 'ascii'))
  } catch (err) {}
  list.push({ index, hash })
  await fs.promises.writeFile(fauxWitCommitListFile, JSON.stringify(list, null, 2), 'ascii')
}
*/

async function generateCar (verify, quickVerify, index) {
  const { jsonFile, binFile, hash } = await files(index)
  const tmpCarFile = path.join(path.dirname(jsonFile), `.${hash}.car`)
  const finalCarFile = path.join(path.dirname(jsonFile), `${hash}.car`)

  process.stdout.write(`${index} ${hash}.car ... `)
  const exists = await fileExists(finalCarFile)

  if (exists && !verify) {
    return process.stdout.write('Skipped')
  }

  const { json: expected, bin } = await readFiles(index, jsonFile, binFile, hash)

  let rootCid
  if (!exists) {
    // write
    const outStream = fs.createWriteStream(tmpCarFile)
    const writeDs = await CarDatastore.writeStream(outStream)
    const decoded = ipld[type === 'bitcoin' ? 'deserializeFullBitcoinBinary' : 'deserializeFullZcashBinary'](bin)
    rootCid = await ipld.blockToCar(multiformats, writeDs, decoded)
    process.stdout.write('w')
  } else {
    rootCid = ipld.blockHashToCID(multiformats, hash)
  }

  // verify
  const carDs = await CarDatastore.readFileComplete(exists && verify ? finalCarFile : tmpCarFile)
  const loader = async (cid) => {
    try {
      const block = await carDs.get(cid)
      return block
    } catch (err) {
      console.log(`failed to load ${cid} (${cid.code})`)
      if (cid.code === 0xb2) { // probably faux witness commitment
        // await recordFauxWitCommit(index, hash)
      }
      throw err
    }
  }

  roundDifficulty(cleanBlock(expected))

  if (quickVerify) {
    const header = multiformats.decode(await loader(rootCid), `${type}-block`)
    roundDifficulty(header)
    delete expected.tx
    delete expected.nTx
    delete expected.size
    delete expected.strippedsize
    delete expected.weight
    assert.strictEqual(header.tx.code, type === 'bitcoin' ? 0xb1 : 0xc1, 'tx CID')
    assert(await carDs.has(header.tx), 'tx merkle root exists')
    if (index !== 0) {
      assert.strictEqual(header.parent.code, type === 'bitcoin' ? 0xb0 : 0xc0, 'parent CID')
    } else {
      assert.strictEqual(header.parent, null, 'genesis parent is null')
    }
    delete header.tx
    delete header.parent
    assert.deepStrictEqual(header, expected, 'round-trip object form matches for header')
  } else {
    const { deserialized, binary } = await ipld.assemble(multiformats, loader, rootCid)

    assert.deepStrictEqual(binary, bin, 'round-trip binary form matches')

    roundDifficulty(deserialized)

    if (type === 'bitcoin' && isSegWit(expected)) {
      // nonce isn't in the bitcoin-cli output (yet)
      const nonce = deserialized.tx[0].vin[0].txinwitness
      assert(Array.isArray(nonce))
      assert.strictEqual(nonce.length, 1)
      assert.strictEqual(nonce[0].length, 64)
      assert(/^[0-9a-f]+$/.test(nonce[0]))
      delete deserialized.tx[0].vin[0].txinwitness
    }

    // See https://github.com/zcash/zcash/pull/4579
    if (type === 'zcash') {
      deserialized.tx.forEach((tx) => {
        if (tx.vjoinsplit.length > 0) {
          assert(/^[0-9a-f]{64}$/.test(tx.joinSplitPubKey))
          assert(/^[0-9a-f]{128}$/.test(tx.joinSplitSig))
          delete tx.joinSplitPubKey
          delete tx.joinSplitSig
        }
      })
    }
    assert.deepStrictEqual(deserialized, expected) //, 'round-trip object form matches')
  }

  process.stdout.write('v')

  if (!exists) {
    await fs.promises.rename(tmpCarFile, finalCarFile)
  }

  process.stdout.write(' \u001b[32m✔\u001b[39m')
}

async function exec () {
  let argv = process.argv
  let verify = false
  if (process.argv.includes('-v')) {
    argv = argv.filter((a) => a !== '-v')
    verify = true
  }
  let quickVerify = false
  if (process.argv.includes('-q')) {
    argv = argv.filter((a) => a !== '-q')
    quickVerify = true
  }
  const { start, limit } = await args(argv)
  await run(start, start + limit, generateCar.bind(null, verify, quickVerify))
}

exec().catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
