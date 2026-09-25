// 笔记体检（`wiz doctor`）：扫全库存量笔记，报告「打不开 / 内容异常 / 引用断链 / 标题脏」，
// 并可安全修复其中可修的部分。
//
// 检查项：
//   collab-render        协作笔记的块格式老版桌面客户端(0.1.107)渲染不了 → 可用 --fix 降级
//                        （含 `blocks` 字段缺失、表格缺 rows、单元格是对象、空 insert）
//   broken-resource-refs 正文引用的 index_files/<name> 在笔记资源列表里不存在（图片/附件断链）
//   empty-body           正文、内嵌资源、附件都为空（可能是没写完的笔记，仅提示）
//   title-suffix         标题带多余的 .md / .md.md / ·md 后缀 → 可用 --fix-titles 清理
//
// 只读；只有显式 --fix / --fix-titles 才写。
import { fetchCollabDocData, findLegacyRenderProblems } from './collab-repair.js'
import { unwrapMarkdown } from './markdown.js'

const TITLE_SUFFIX = /(?:\s*[.·]\s*md)+\s*$/i
const RESOURCE_REF = /index_files\/([A-Za-z0-9._%-]+)/g

/** 标题里多余的 `.md` / `.md.md` / `·md` 后缀 → 干净的标题。纯函数。 */
export function normalizeTitle (title) {
  const raw = String(title == null ? '' : title)
  const clean = raw.replace(TITLE_SUFFIX, '').trim()
  return { clean, changed: clean !== raw && clean.length > 0, suffix: raw.slice(clean.length) }
}

/** 从 html / markdown 文本里取出所有 `index_files/<name>` 引用（去重）。纯函数。 */
export function findResourceRefs (text) {
  const names = new Set()
  const s = String(text || '')
  let m
  while ((m = RESOURCE_REF.exec(s))) names.add(decodeURIComponent(m[1]))
  RESOURCE_REF.lastIndex = 0
  return [...names]
}

/** 引用里在资源清单中找不到的（= 断链）。纯函数。 */
export function findBrokenResourceRefs (refs, resourceNames) {
  const have = new Set((resourceNames || []).map((n) => String(n)))
  return (refs || []).filter((r) => !have.has(r))
}

const stripHtml = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * 这条笔记的正文文本。
 * markdown 笔记优先取 markdown 源；但历史上被工具改写成 document 包裹形式的
 * lite/markdown 笔记（`<div class="wiz-note-body">…`）取不到 markdown,此时回退到
 * html 文本,避免把有内容的笔记误判成空笔记。
 */
function noteText (note, html) {
  const isMarkdown = note && String(note.type || '').toLowerCase() === 'lite/markdown'
  if (isMarkdown) {
    const md = stripHtml(String(unwrapMarkdown(html) || ''))
    if (md) return md
  }
  return stripHtml(html)
}

/** 体检单条笔记。返回 problem 数组（空数组 = 没发现问题）。 */
export async function inspectNote (wiz, note, { category } = {}) {
  const problems = []
  const type = String(note.type || '').toLowerCase()
  const base = { docGuid: note.docGuid, title: note.title, category, type: note.type || null }

  if (type.startsWith('collaboration')) {
    let doc
    try {
      doc = await fetchCollabDocData(wiz, note.docGuid)
    } catch (e) {
      return [{ ...base, kind: 'read-error', detail: e.message, fixable: false }]
    }
    const format = findLegacyRenderProblems(doc.data)
    if (format.length) {
      problems.push({ ...base, kind: 'collab-render', detail: format.join(', '), fixable: true, docVersion: doc.version })
    }
    const blocks = (doc.data && doc.data.blocks) || []
    const chars = JSON.stringify(doc.data || {}).replace(/[{}\[\]",:]/g, '').length
    if (blocks.length === 0 && chars < 200) {
      problems.push({ ...base, kind: 'empty-body', detail: '协作笔记正文为空', fixable: false })
    }
  } else {
    let full
    try {
      full = await wiz.kb.getNoteContent(note.docGuid)
    } catch (e) {
      return [{ ...base, kind: 'read-error', detail: e.message, fixable: false }]
    }
    const html = full && full.html ? String(full.html) : ''
    const text = noteText(note, html)
    const resources = (full && full.resources) || []
    const attachments = Number(note.attachmentCount || 0)

    const refs = findResourceRefs(html)
    const broken = findBrokenResourceRefs(refs, resources.map((r) => r.name))
    if (broken.length) {
      problems.push({ ...base, kind: 'broken-resource-refs', detail: `${broken.length} 个引用在资源清单里找不到: ${broken.slice(0, 3).join(', ')}`, fixable: false })
    }
    if (text.length === 0 && resources.length === 0 && attachments === 0) {
      problems.push({ ...base, kind: 'empty-body', detail: `正文/资源/附件都为空（html ${html.length} 字节）`, fixable: false })
    }
  }

  const title = normalizeTitle(note.title)
  if (title.changed) {
    problems.push({ ...base, kind: 'title-suffix', detail: `标题后缀「${title.suffix}」多余`, fixable: false, fixableByTitles: true, cleanTitle: title.clean })
  }
  return problems
}

/**
 * 扫全库做体检。
 *   fix: true        → 顺手修可修的（目前是协作笔记块格式降级）
 *   fixTitles: true  → 顺手清理标题里多余的 .md（协作笔记连正文首行一起改）
 */
export async function runDoctor (wiz, { fix = false, fixTitles = false, onProgress, delayMs = 80, category: onlyCategory = null, limit = 0 } = {}) {
  const all = (await wiz.kb.getCategories()).result || []
  const categories = onlyCategory ? all.filter((c) => c === onlyCategory || c.startsWith(onlyCategory)) : all
  const issues = []
  const fixed = []
  let scanned = 0

  for (const category of categories) {
    const notes = await wiz.kb.getCategoryNotes({ category, start: 0, count: 200 }).catch(() => [])
    for (const note of notes) {
      if (limit && scanned >= limit) break
      scanned++
      let found = await inspectNote(wiz, note, { category })
      if (onProgress) onProgress({ scanned, title: note.title, issues: found.length })

      if (fixTitles) {
        for (const issue of found.filter((i) => i.kind === 'title-suffix')) {
          await renameWithHeading(wiz, note, issue.cleanTitle)
          fixed.push({ ...issue, kind: 'title-suffix', fixed: true })
        }
        found = found.filter((i) => i.kind !== 'title-suffix')
      }
      if (fix) {
        for (const issue of found.filter((i) => i.kind === 'collab-render' && i.fixable)) {
          const r = await wiz.repairCollabDoc(note.docGuid, { apply: true })
          fixed.push({ ...issue, kind: 'collab-render', fixed: true, versionAfter: r.version_after })
        }
        found = found.filter((i) => i.kind !== 'collab-render')
      }
      issues.push(...found)
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  const byKind = {}
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1
  return { scanned, categories: categories.length, issues, fixed, byKind, fixedCount: fixed.length }
}

/** 改标题；协作笔记如果正文首个标题块与旧标题一致，一并改成新标题。 */
async function renameWithHeading (wiz, note, cleanTitle) {
  const type = String(note.type || '').toLowerCase()
  if (type.startsWith('collaboration')) {
    try {
      const doc = await fetchCollabDocData(wiz, note.docGuid)
      const first = (doc.data && doc.data.blocks && doc.data.blocks[0]) || null
      const heading = first && first.heading ? (first.text || []).map((x) => x.insert || '').join('') : ''
      if (heading && normalizeTitle(heading).changed) {
        const blocks = JSON.parse(JSON.stringify(doc.data.blocks))
        blocks[0].text = [{ insert: normalizeTitle(heading).clean }]
        const extras = {}
        for (const [k, v] of Object.entries(doc.data)) if (k !== 'blocks') extras[k] = v
        const { writeCollaborationBlocks } = await import('./collaboration.js')
        await writeCollaborationBlocks({
          kbServer: wiz.kbServer, kbGuid: wiz.kbGuid, docGuid: note.docGuid,
          userGuid: wiz.userGuid, editorToken: doc.editorToken,
          blocks, extras, version: doc.version
        })
      }
    } catch { /* 正文首行清理失败不阻塞改名 */ }
  }
  return await wiz.kb.renameNote(note.docGuid, cleanTitle)
}
