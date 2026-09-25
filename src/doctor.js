// 笔记体检（`wiz doctor`）：扫全库存量笔记，报告「打不开 / 内容异常 / 引用断链 / 标题脏」，
// 并可安全修复其中可修的部分。
//
// 检查项：
//   collab-render        协作笔记的块格式老版桌面客户端(0.1.107)渲染不了 → 可用 --fix 降级
//                        （含 `blocks` 字段缺失、表格缺 rows、单元格是对象、空 insert）
//   broken-resource-refs 正文引用的 index_files/<name> 在笔记资源列表里不存在（图片/附件断链）
//   markdown-shell-missing Markdown 笔记（type 后缀或标题 .md）正文不是 HTML5 外壳
//                        → 客户端按 Markdown 打开显示空白（历史记录还能看到）→ 可用 --fix 转换写回
//   empty-body           正文、内嵌资源、附件都为空（可能是没写完的笔记，仅提示）
//   title-suffix         标题带多余的 .md / .md.md / ·md 后缀 → 可用 --fix-titles 清理
//
// 只读；只有显式 --fix / --fix-titles 才写。
import { fetchCollabDocData, findLegacyRenderProblems } from './collab-repair.js'
import { unwrapMarkdown } from './markdown.js'

const TITLE_SUFFIX = /(?:\s*[.·]\s*md)+\s*$/i
const RESOURCE_REF = /index_files\/([A-Za-z0-9._%-]+)/g
// 客户端判定「markdown 笔记」的两种来源（见 renderer 里 isMarkdownNote）：
//   type 以 /markdown、/md、/ma 结尾，或标题里带 .md
const MARKDOWN_TYPE_SUFFIX = /\/(markdown|md|ma)$/i
const MARKDOWN_TITLE = /\.md$|\.md |\.md@/i

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

/** 客户端会把这条笔记当 Markdown 笔记打开吗（type 后缀或标题里的 .md）。纯函数。 */
export function isMarkdownLike (note) {
  const type = String(note && note.type || '')
  const title = String(note && note.title || '')
  return MARKDOWN_TYPE_SUFFIX.test(type) || MARKDOWN_TITLE.test(title)
}

/** 正文是不是 Markdown 笔记要求的 HTML5 外壳。纯函数。 */
export function hasMarkdownShell (html) {
  const t = String(html || '').trimStart().toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html')
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '')
const decodeEntities = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/**
 * 把 document 包裹形式的 html 转回 markdown（标题 / 段落 / 列表 / 链接 / 粗斜体 / 换行）。
 * 用于修复「Markdown 笔记但正文没有外壳」的笔记（客户端会显示空白）。纯函数。
 */
export function htmlToMarkdown (html) {
  let s = String(html || '')
  s = s.replace(/<script[^]*?<\/script>/gi, '').replace(/<style[^]*?<\/style>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  for (let level = 6; level >= 1; level--) {
    const re = new RegExp('<' + 'h' + level + '[^>]*>([^]*?)</' + 'h' + level + '>', 'gi')
    s = s.replace(re, (m, text) => '\n' + '#'.repeat(level) + ' ' + decodeEntities(stripTags(text)).replace(/\s*\n\s*/g, ' ').trim() + '\n\n')
  }
  s = s.replace(/<li[^>]*>([^]*?)<\/li>/gi, (m, t) => '- ' + stripTags(t).trim() + '\n')
  s = s.replace(/<(strong|b)[^>]*>([^]*?)<\/\1>/gi, (m, tag, t) => '**' + stripTags(t).trim() + '**')
  s = s.replace(/<(em|i)[^>]*>([^]*?)<\/\1>/gi, (m, tag, t) => '*' + stripTags(t).trim() + '*')
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([^]*?)<\/a>/gi, (m, href, t) => {
    const url = decodeEntities(href)
    const label = decodeEntities(stripTags(t)).trim()
    return label && label !== url ? '[' + label + '](' + url + ')' : url
  })
  s = s.replace(/<\/p>/gi, '\n\n').replace(/<p[^>]*>/gi, '')
  s = s.replace(/<\/div>/gi, '\n').replace(/<div[^>]*>/gi, '')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  return s.split('\n').map((l) => l.replace(/\s+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
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
    // 只对 type 判定为 markdown 的笔记查外壳：标题型 markdown（.md）由 title-suffix 检查
    // + --fix-titles 处理（去掉标题后缀后客户端会按普通文档渲染，不需要转换正文）。
    if (text.length > 0 && MARKDOWN_TYPE_SUFFIX.test(String(note.type || '')) && !hasMarkdownShell(html)) {
      problems.push({
        ...base,
        kind: 'markdown-shell-missing',
        detail: `Markdown 笔记正文缺 HTML5 外壳（客户端按 Markdown 打开会显示空白，历史记录仍能看到内容）`,
        fixable: true
      })
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
        for (const issue of found.filter((i) => i.kind === 'markdown-shell-missing')) {
          const r = await fixMarkdownShell(wiz, note.docGuid)
          fixed.push({ ...issue, kind: 'markdown-shell-missing', fixed: true, markdownChars: r.chars })
        }
        found = found.filter((i) => i.kind !== 'collab-render' && i.kind !== 'markdown-shell-missing')
      }
      issues.push(...found)
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  const byKind = {}
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1
  return { scanned, categories: categories.length, issues, fixed, byKind, fixedCount: fixed.length }
}

/** 把「缺外壳」的 Markdown 笔记转回 markdown 并用正确外壳写回，写完回读校验。 */
async function fixMarkdownShell (wiz, docGuid) {
  const before = await wiz.kb.getNoteContent(docGuid)
  const markdown = htmlToMarkdown(String(before && before.html || ''))
  if (!markdown.trim()) throw new Error('fixMarkdownShell: 转换结果为空，放弃写入')
  await wiz.updateMarkdownNote({ docGuid, markdown })
  const after = await wiz.kb.getNoteContent(docGuid)
  const html = String(after && after.html || '')
  const md = String(unwrapMarkdown(html) || '')
  if (!hasMarkdownShell(html) || !md.trim()) throw new Error('fixMarkdownShell: 写回后仍取不到 markdown')
  return { chars: md.length, markdown }
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
