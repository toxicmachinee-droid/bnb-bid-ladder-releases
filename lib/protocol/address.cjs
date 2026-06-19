'use strict'

const { ethers } = require('ethers')

function normalizeAddress(address) {
  return ethers.getAddress(address)
}

module.exports = {
  normalizeAddress
}
