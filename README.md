# js-bitcoin-extract

Tools to work with the Bitcoin blockchain and IPLD.

* bitcoin-extract.js to extract each block of the blockchain into files, both binary (.bin) and JSON (.json) forms, into files named after the block IDs and symlinks into an index directory using the block height so they can be sequentially scaned afterward without having to know the block ID. Uses the `bitcoin-cli` to perform extraction.
* verify.js to verify the written data can be read in binary form by https://github.com/rvagg/js-bitcoin-block
* fetchfixtures.sh to fetch a sampling of block throughout the blockchain to be used as test fixtures (for js-bitcoin-block, but could be repurposed for other means)
