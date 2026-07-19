#!/usr/bin/env node
// Generate tiny but valid PNG / WAV / ZIP test files.
// Argument: output directory (absolute path).
import fs from 'node:fs'
import path from 'node:path'
import { crc32 } from 'node:zlib'

const dir = process.argv[2]
if (!dir) { console.error('usage: gen-test-blobs <dir>'); process.exit(1) }
fs.mkdirSync(dir, { recursive: true })

// 1x1 red PNG (67 bytes)
const png = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8CFC0F00F00030105011DCC1F3D0000000049454E44AE426082',
  'hex'
)
fs.writeFileSync(path.join(dir, 'pic.png'), png)

// 1s silence 8-bit mono 8 kHz WAV
const samples = 8000
const hdr = Buffer.alloc(44)
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + samples, 4); hdr.write('WAVE', 8)
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22)
hdr.writeUInt32LE(8000, 24); hdr.writeUInt32LE(8000, 28); hdr.writeUInt16LE(1, 32); hdr.writeUInt16LE(8, 34)
hdr.write('data', 36); hdr.writeUInt32LE(samples, 40)
fs.writeFileSync(path.join(dir, 'audio.wav'), Buffer.concat([hdr, Buffer.alloc(samples, 128)]))

// Minimal ZIP with a single stored (no-compress) entry `hello.txt`
const name = Buffer.from('hello.txt')
const data = Buffer.from('hello from wiz upload\n')
const c = crc32(data), s = data.length
const u32 = v => Buffer.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])
const u16 = v => Buffer.from([v & 0xff, (v >>> 8) & 0xff])
const local = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  u16(20), u16(0), u16(0), u16(0), u16(0x21),
  u32(c), u32(s), u32(s), u16(name.length), u16(0), name, data
])
const cd = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21),
  u32(c), u32(s), u32(s), u16(name.length), u16(0), u16(0), u16(0), u16(0),
  u32(0), u32(0), name
])
const eocd = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  u16(0), u16(0), u16(1), u16(1),
  u32(cd.length), u32(local.length), u16(0)
])
fs.writeFileSync(path.join(dir, 'pkg.zip'), Buffer.concat([local, cd, eocd]))

console.log(fs.readdirSync(dir).map(n => `${n}  ${fs.statSync(path.join(dir, n)).size}B`).join('\n'))
