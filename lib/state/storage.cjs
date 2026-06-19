'use strict'

const fs = require('fs')
const path = require('path')

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function jsonSafeReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (_) {
    return fallback
  }
}

function writeJsonFile(filePath, payload) {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(payload, jsonSafeReplacer, 2) + '\n', 'utf8')
}

module.exports = {
  ensureDirectory,
  readJsonFile,
  writeJsonFile,
  jsonSafeReplacer
}
