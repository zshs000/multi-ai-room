// Markdown 渲染：markdown-it + highlight.js 代码高亮。
// html:false 确保不渲染原始 HTML，天然防 XSS（AI 输出当不可信处理）。
// highlight.js 只按需注册常用语言，避免全量引入撑大 bundle。
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import 'highlight.js/styles/github.css'

import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import markdown from 'highlight.js/lib/languages/markdown'

for (const [name, lang] of Object.entries({
  javascript, typescript, python, java, json, bash, xml, css, sql, go, rust, markdown,
})) {
  hljs.registerLanguage(name, lang)
}
// 常见别名
hljs.registerAliases(['js'], { languageName: 'javascript' })
hljs.registerAliases(['ts'], { languageName: 'typescript' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' })
hljs.registerAliases(['html'], { languageName: 'xml' })

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`
      } catch {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  },
})

export function renderMarkdown(text) {
  return md.render(text || '')
}
