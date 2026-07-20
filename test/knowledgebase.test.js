import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KnowledgeBaseApi } from '../src/KnowledgeBaseApi.js'

// patchNoteInfo re-uploads a full metadata object (/ks/note/upload is a full
// overwrite). Any writable field it forgets to echo back gets wiped — tags most
// dangerously (verified 2026-07-20: moveNote/renameNote silently dropped tags).
function stubKb (info) {
  const kb = new KnowledgeBaseApi({ baseUrl: 'http://x', kbGuid: 'kb', token: 't' })
  const uploaded = []
  kb.getNoteContent = async () => ({ info })
  kb.updateNoteInfo = async (docGuid, body) => { uploaded.push(body); return { docGuid } }
  return { kb, uploaded }
}

test('patchNoteInfo echoes tags + dataModified back so a metadata patch keeps them', async () => {
  const { kb, uploaded } = stubKb({
    title: 't', category: '/a/', tags: 'guid1*guid2', created: 100, dataModified: 200
  })
  await kb.patchNoteInfo('d', { category: '/b/' })   // e.g. moveNote
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].tags, 'guid1*guid2')      // NOT dropped
  assert.equal(uploaded[0].dataModified, 200)        // NOT reset to 1970
  assert.equal(uploaded[0].category, '/b/')          // patch applied
  assert.equal(uploaded[0].created, 100)             // other fields preserved
})

test('patchNoteInfo falls back dataModified to created when the note lacks one', async () => {
  const { kb, uploaded } = stubKb({ title: 't', category: '/a/', created: 100 })
  await kb.patchNoteInfo('d', { title: 'new' })
  assert.equal(uploaded[0].dataModified, 100)        // not 0/1970
})

test('patchNoteInfo defaults tags to empty string when the note has none', async () => {
  const { kb, uploaded } = stubKb({ title: 't', category: '/a/' })
  await kb.patchNoteInfo('d', { title: 'new' })
  assert.equal(uploaded[0].tags, '')
})
