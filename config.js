module.exports.type = 'zcash' // or 'bitcoin'

// awkward construction required because of snap's apparmor containment
// normally this would just be `bitcoin-cli`

if (module.exports.type === 'bitcoin') {
  module.exports.bitcoinCli = '/snap/bitcoin-core/current/bin/bitcoin-cli -datadir=/mnt/md4/pl/coins/btc/'
  module.exports.dataDir = '/mnt/md4/pl/coins/btc-dump'
} else if (module.exports.type === 'zcash') {
  module.exports.bitcoinCli = '/usr/bin/zcash-cli -datadir=/mnt/md4/pl/coins/zcash/'
  module.exports.dataDir = '/mnt/md4/pl/coins/zcash-dump'
}
