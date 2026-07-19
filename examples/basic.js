// Basic usage. Requires: `wiz login` (or env WIZ_TOKEN/WIZ_KB_GUID/WIZ_KB_SERVER) beforehand.

import { WizClient } from '../src/index.js'

const wiz = await WizClient.fromStored()
console.log(`Connected as ${wiz.userId} (kb=${wiz.kbGuid})`)

// list root notes
const notes = await wiz.kb.getCategoryNotes({
  category: '', start: 0, count: 5, withAbstract: true, orderBy: 'modified', ascending: 'desc'
})
console.log('Recent notes:')
for (const n of notes) console.log(' -', n.title)

// search
const hits = await wiz.kb.searchNote({ ss: 'hello' })
console.log(`Search 'hello' → ${hits?.length ?? 0} hits`)
