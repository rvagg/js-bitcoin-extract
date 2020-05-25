// awkward construction required because of snap's apparmor containment
// normally this would just be `bitcoin-cli`
module.exports.bitcoinCli = '/snap/bitcoin-core/current/bin/bitcoin-cli -datadir=/mnt/md4/pl/coins/btc/'
module.exports.dataDir = '/mnt/md4/pl/coins/btc-dump'
// module.exports.dataDir = '/tmp/btc-dump'
