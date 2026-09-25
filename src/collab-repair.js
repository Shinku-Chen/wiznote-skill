// 协作笔记块格式「降级」与体检。
//
// 背景:为知笔记的协作笔记正文有两代块格式。老版桌面客户端(0.1.107,官方最后一个
// 桌面构建)只认老格式,遇到新格式会在渲染阶段抛异常,表现是笔记正文一直转圈:
//   - 表格/代码块的子单元必须是**块数组**,新格式存的是对象
//     (`{"__id":...,"__type":"table_cell","text":[...]}`)
//     → 老客户端 `Assert Error`(`w(Array.isArray(getChildContainerData(...)))`)
//   - 表格块必须带 `rows`(老客户端 `rowCount = data.rows` 为 undefined 时网格为空)
//     → `TypeError: Cannot read properties of undefined (reading 'setCell')`
//   - 富文本 op 不能出现空 `insert`(老客户端断言 `"" !== op.insert`);空单元用 `text: []`
//
// 本模块提供:
//   findLegacyRenderProblems(data)  体检单条文档
//   downgradeDocData(data)          新格式 → 老格式(纯函数,幂等)
//   repairCollabDoc(wiz, docGuid)   读 → 转换 → 校验 → 写回(可选 apply)
//   scanCollabDocs(wiz)             全库扫描哪些协作笔记会被老客户端渲染崩

const CELL_KEYS = ['blocks', 'comments', 'meta', 'authors', 'commentators']

const TABLE_DEFAULT_FIELDS = {
  chart: false,
  hasColTitle: false,
  hasRowTitle: false,
  isStripeStyle: false,
  noBorder: false,
  quoted: false
}

/** 去掉老客户端会断言的空 `insert`。空单元保持空数组,不要补 `{insert:''}`。 */
function cleanOps (ops) {
  return (Array.isArray(ops) ? ops : []).filter((op) => {
    if (!op || typeof op !== 'object') return false
    if (!('insert' in op)) return true
    return typeof op.insert === 'string' ? op.insert !== '' : !!op.insert
  })
}

/** 已经是老格式的单元格:只在 ops 真的被过滤掉时才重建,保持引用相等以便统计幂等。 */
function normalizeBlockArrayCell (cell) {
  let changed = false
  const next = cell.map((block) => {
    if (!block || !Array.isArray(block.text)) return block
    const cleaned = cleanOps(block.text)
    if (cleaned.length === block.text.length) return block
    changed = true
    return { ...block, text: cleaned }
  })
  return changed ? next : cell
}

/** 单元格:新格式对象 → 老格式块数组;已经是数组的只做 ops 清洗。 */
function normalizeCell (key, cell) {
  if (Array.isArray(cell)) return normalizeBlockArrayCell(cell)
  return [{
    id: (cell && cell.__id) || key,
    type: 'text',
    level: 0,
    text: cleanOps(cell && cell.text)
  }]
}

function childCellKeys (block) {
  return Array.isArray(block.children) ? block.children : []
}

/** 列出这条文档在老客户端上会渲染失败的点(去重后的字符串数组)。 */
export function findLegacyRenderProblems (data) {
  const problems = new Set()
  // 空文档(刚建还没写内容)/ 空笔记:老客户端渲染成空笔记,不算问题。
  if (data == null) return []
  if (!Array.isArray(data.blocks)) return ['missing-blocks']
  if (data.blocks.length === 0) return []

  const cells = []
  for (const block of data.blocks) {
    if (block.type === 'table') {
      if (!block.rows) problems.add('table-missing-rows')
      for (const key of childCellKeys(block)) if (data[key] && !Array.isArray(data[key])) problems.add('object-cell')
    } else if (block.type === 'code') {
      for (const key of childCellKeys(block)) if (data[key] && !Array.isArray(data[key])) problems.add('object-cell')
    }
    for (const key of childCellKeys(block)) cells.push(data[key])
  }
  for (const [key, value] of Object.entries(data)) {
    if (CELL_KEYS.includes(key)) continue
    if (Array.isArray(value)) value.forEach((block) => (block.text || []).forEach((op) => { if (op && op.insert === '') problems.add('empty-insert') }))
    else if (value && Array.isArray(value.text)) value.text.forEach((op) => { if (op && op.insert === '') problems.add('empty-insert') })
  }
  if (cells.some((cell) => cell && !Array.isArray(cell) && Array.isArray(cell.text) && cell.text.some((op) => op.insert === ''))) {
    problems.add('empty-insert')
  }
  return [...problems]
}

/**
 * 把文档块数据降级成老客户端能渲染的形态。纯函数,可重复调用(幂等):
 * 补上缺失的 `blocks`(老客户端遇到 `data.blocks === undefined` 会 `TypeError`)、
 * 表格补 `rows` 等默认字段、表格/代码块子单元对象→数组、丢弃空 `insert`。
 */
export function downgradeDocData (input) {
  const data = JSON.parse(JSON.stringify(input))
  const stats = { tables: 0, cells: 0, emptyOpsDropped: 0, blocksAdded: 0 }
  if (!data || typeof data !== 'object') throw new Error('downgradeDocData: doc data is required')
  if (!Array.isArray(data.blocks)) { data.blocks = []; stats.blocksAdded = 1 }

  for (const block of data.blocks) {
    if (block.type === 'table') {
      const cols = Number(block.cols) || 1
      const keys = childCellKeys(block)
      block.cols = cols
      block.rows = Math.max(1, Math.ceil(keys.length / cols))
      for (const [field, value] of Object.entries(TABLE_DEFAULT_FIELDS)) {
        if (block[field] === undefined) block[field] = value
      }
      if (!Array.isArray(block.text)) block.text = []
      if (!Array.isArray(block.colsWidth)) block.colsWidth = Array(cols).fill(Math.round(880 / cols))
      stats.tables++
      for (const key of keys) {
        const cell = data[key]
        const before = Array.isArray(cell) ? (cell[0] && cell[0].text) || [] : (cell && cell.text) || []
        const fixed = normalizeCell(key, cell)
        if (fixed !== cell) { data[key] = fixed; stats.cells++ }
        const afterLen = (fixed[0] && fixed[0].text) || []
        if (Array.isArray(before) && before.length !== afterLen.length) stats.emptyOpsDropped += before.length - afterLen.length
      }
    } else if (block.type === 'code') {
      if (!block.language) block.language = 'txt'
      for (const key of childCellKeys(block)) {
        const cell = data[key]
        const fixed = normalizeCell(key, cell)
        if (fixed !== cell) { data[key] = fixed; stats.cells++ }
      }
    }
  }
  return { data, stats }
}

/**
 * 把 `markdownToBlocks()` 的输出规整成老客户端也能渲染的形状,返回同形的
 * `{ blocks, extras }`,可直接喂给 `writeCollaborationBlocks`。
 *
 * `markdownToBlocks` 本身写的是新版块格式(表格无 `rows`、单元格是 `__type` 对象),
 * 桌面客户端 0.1.107 渲染不了;写入前过一道这里,桌面端和网页版都能正常显示。
 */
export function downgradeBlocks ({ blocks, extras = {} }) {
  const { data } = downgradeDocData({ blocks: [...(blocks || [])], ...extras })
  const { blocks: fixedBlocks, ...fixedExtras } = data
  return { blocks: fixedBlocks, extras: fixedExtras }
}

/** 读一条协作文档的当前内容。 */
export async function fetchCollabDocData (wiz, docGuid) {
  const tokenRes = await wiz.getCollaborationToken(docGuid)
  const editorToken = tokenRes?.editorToken || tokenRes
  const raw = await (await import('./collaboration.js')).fetchCollaborationContent({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid, userGuid: wiz.userGuid, editorToken
  })
  const parsed = JSON.parse(raw)
  return { version: parsed?.data?.v ?? 0, type: parsed?.data?.type ?? null, data: parsed?.data?.data || null, editorToken }
}

/**
 * 体检 + (可选)修复单条协作笔记。
 * 默认只读;--apply 时才写回(写入前会做一次内容校验,失败会自动重试并最终抛错)。
 */
export async function repairCollabDoc (wiz, docGuid, { apply = false } = {}) {
  const before = await fetchCollabDocData(wiz, docGuid)
  const problems = findLegacyRenderProblems(before.data)
  const { data: fixed, stats } = downgradeDocData(before.data)
  const result = { docGuid, version: before.version, problems, changed: stats, applied: false, version_after: null }

  if (problems.length === 0) return result
  if (!apply) return result

  const { writeCollaborationBlocks } = await import('./collaboration.js')
  await writeCollaborationBlocks({
    kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid,
    userGuid: wiz.userGuid, editorToken: before.editorToken,
    blocks: fixed.blocks,
    extras: Object.fromEntries(Object.entries(fixed).filter(([key]) => !CELL_KEYS.includes(key) && key !== 'blocks' && key !== 'meta')),
    version: before.version
  })

  const after = await fetchCollabDocData(wiz, docGuid)
  const remaining = findLegacyRenderProblems(after.data)
  const blocksMatch = JSON.stringify(after.data?.blocks) === JSON.stringify(fixed.blocks)
  if (remaining.length || !blocksMatch) {
    throw new Error(`repairCollabDoc: 写回校验未通过 (problems=${remaining.join(',') || 'none'}, blocksMatch=${blocksMatch})`)
  }
  result.applied = true
  result.version_after = after.version
  return result
}

/** 扫全库协作笔记,列出会被老客户端渲染崩的那些。 */
export async function scanCollabDocs (wiz, { onProgress } = {}) {
  const categories = (await wiz.kb.getCategories()).result || []
  const found = []
  for (const category of categories) {
    const notes = await wiz.kb.getCategoryNotes({ category, start: 0, count: 200 }).catch(() => [])
    for (const note of notes) {
      if (!String(note.type || '').toLowerCase().startsWith('collaboration')) continue
      try {
        const doc = await fetchCollabDocData(wiz, note.docGuid)
        const problems = findLegacyRenderProblems(doc.data)
        if (problems.length) found.push({ docGuid: note.docGuid, title: note.title, category, problems })
        if (onProgress) onProgress({ title: note.title, problems })
      } catch (err) {
        found.push({ docGuid: note.docGuid, title: note.title, category, problems: [`fetch-error: ${err.message}`] })
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }
  return found
}
