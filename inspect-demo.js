#!/usr/bin/env node

const path = require('path')
const multiformats = require('multiformats/basics')
const ipldBitcoin = require('ipld-bitcoin')
multiformats.add(require('@ipld/dag-cbor'))
multiformats.add(require('ipld-bitcoin'))
const CarDatastore = require('datastore-car')(multiformats)
const dataDir = '/mnt/md4/pl/coins/btc-dump/blocks'

async function run (hash) {
  // locate and load CAR file containing this BTC block's graph, make a "loader" from the car
  const carPath = path.join(dataDir, hash.substring(62), hash.substring(60, 62), `${hash}.car`)
  const carDs = await CarDatastore.readFileComplete(carPath)
  // load the header, using the hash as the identifier
  const headerCid = ipldBitcoin.blockHashToCID(multiformats, hash)
  const header = multiformats.decode(await carDs.get(headerCid), 'bitcoin-block')

  // navigate the transaction binary merkle tree to the first transaction, the coinbase
  let txCid = header.tx
  let tx
  while (true) {
    tx = multiformats.decode(await carDs.get(txCid), 'bitcoin-tx')
    if (!Array.isArray(tx)) { // is not an inner merkle tree node
      break
    }
    txCid = tx[0] // leftmost side of the tx binary merkle
  }

  // convert the scriptSig to UTF-8 and cross our fingers
  console.log(Buffer.from(tx.vin[0].coinbase, 'hex').toString('utf8'))
}

run(process.argv[2]).catch((err) => {
  console.error(err.stack)
  process.exit(1)
})
