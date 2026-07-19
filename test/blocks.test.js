// Roundtrip tests for markdown ↔ blocks conversion.
// Runs under Node 18+ built-in test runner: `node --test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markdownToBlocks, blocksToMarkdown, parseInline } from '../src/blocks.js'

// Helper: wrap the blocks/extras pair into the same envelope shape that the
// WebSocket fetch response uses, so blocksToMarkdown can parse it back.
function roundtrip (md) {
  const { blocks, extras } = markdownToBlocks(md)
  const inner = { blocks, ...extras }
  const envelope = JSON.stringify({ data: { v: 1, data: inner } })
  return blocksToMarkdown(envelope)
}

test('heading levels', () => {
  const md = '# h1\n## h2\n### h3'
  assert.equal(roundtrip(md), md)
})

test('paragraphs with inline styles', () => {
  const md = 'plain **bold** *italic* ~~strike~~ `code` [link](https://ex.com) end'
  assert.equal(roundtrip(md), md)
})

test('unordered + ordered lists', () => {
  const md = '- one\n- two\n1. first\n2. second'
  assert.equal(roundtrip(md), md)
})

test('checkbox lists', () => {
  const md = '- [x] done\n- [ ] todo'
  assert.equal(roundtrip(md), md)
})

test('nested list levels', () => {
  const md = '- outer\n  - inner'
  assert.equal(roundtrip(md), md)
})

test('blockquote', () => {
  const md = '> quoted text'
  assert.equal(roundtrip(md), md)
})

test('horizontal rule', () => {
  const md = '---'
  assert.equal(roundtrip(md), md)
})

test('image embed', () => {
  const md = '![alt text](https://ex.com/img.png)'
  assert.equal(roundtrip(md), md)
})

test('code fence with language', () => {
  const md = '```js\nconsole.log(1)\nconsole.log(2)\n```'
  assert.equal(roundtrip(md), md)
})

test('code fence without language', () => {
  const md = '```\nplain code\n```'
  assert.equal(roundtrip(md), md)
})

test('table with header + rows', () => {
  const md = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'
  assert.equal(roundtrip(md), md)
})

test('mixed document', () => {
  const md = [
    '# Title',
    '',
    'A paragraph with **bold** and a [link](https://x).',
    '',
    '## Section',
    '',
    '- item A',
    '- [x] done B',
    '',
    '> a quote',
    '',
    '```py',
    'print("hi")',
    '```',
    '',
    '---'
  ].join('\n')
  // Blank lines don't roundtrip (they're skipped by the parser), but the
  // ORDER and CONTENT of non-blank lines must be preserved.
  const out = roundtrip(md)
  const nonBlank = md.split('\n').filter(l => l.trim())
  const outLines = out.split('\n')
  assert.equal(outLines.length, nonBlank.length)
  for (let i = 0; i < nonBlank.length; i++) {
    assert.equal(outLines[i], nonBlank[i], `line ${i} mismatch`)
  }
})

test('parseInline: plain text is a single insert', () => {
  const out = parseInline('hello world')
  assert.deepEqual(out, [{ insert: 'hello world' }])
})

test('parseInline: bold', () => {
  const out = parseInline('**bold**')
  assert.equal(out.length, 1)
  assert.equal(out[0].insert, 'bold')
  assert.equal(out[0].attributes['style-bold'], true)
})

test('parseInline: link', () => {
  const out = parseInline('[text](https://ex.com)')
  assert.equal(out.length, 1)
  assert.equal(out[0].insert, 'text')
  assert.equal(out[0].attributes.link, 'https://ex.com')
})

test('empty input produces empty blocks', () => {
  const { blocks, extras } = markdownToBlocks('')
  assert.equal(blocks.length, 0)
  assert.equal(Object.keys(extras).length, 0)
})

test('whitespace-only input produces empty blocks', () => {
  const { blocks } = markdownToBlocks('   \n\n  \t\n')
  assert.equal(blocks.length, 0)
})
