import { useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { go } from '@codemirror/lang-go'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { Decoration, EditorView } from '@codemirror/view'

import { useResolvedTheme } from '@/hooks/useTheme'
import { highlight as syntax } from '@/lib/codemirror'

export type CodeLang = 'ts' | 'json' | 'python' | 'go'

const LANGS: Record<CodeLang, () => ReturnType<typeof json>> = {
  ts: () => javascript({ typescript: true }),
  json: () => json(),
  python: () => python(),
  go: () => go(),
}

/** 1-based inclusive lines to highlight; `nonce` changes when the user asks to see them again. */
export interface LineRange {
  from: number
  to: number
  nonce: number
}

/** Read-only, highlighted code. */
export function CodeView({ code, lang, label, highlight }: { code: string; lang: CodeLang; label: string; highlight?: LineRange | null }) {
  const theme = useResolvedTheme()
  const editor = useRef<ReactCodeMirrorRef>(null)
  const from = highlight?.from
  const to = highlight?.to
  const nonce = highlight?.nonce

  const extensions = useMemo(
    () => [
      LANGS[lang](),
      syntax,
      EditorView.editorAttributes.of({ class: 'cm-readonly' }),
      EditorView.contentAttributes.of({ 'aria-label': label }),
      ...(from && to
        ? [
            EditorView.decorations.of((view) => {
              const doc = view.state.doc
              const marks = []
              for (let n = Math.min(from, doc.lines); n <= Math.min(to, doc.lines); n++) marks.push(Decoration.line({ class: 'cm-focus-line' }).range(doc.line(n).from))
              return Decoration.set(marks)
            }),
          ]
        : []),
    ],
    [lang, label, from, to],
  )

  // scroll the highlighted declaration to the top when it's picked, or when the code under it changes
  useEffect(() => {
    const view = editor.current?.view
    if (!view || !from) return
    const line = view.state.doc.line(Math.min(from, view.state.doc.lines))
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) })
  }, [from, nonce, code])

  return (
    <CodeMirror
      ref={editor}
      value={code}
      height="100%"
      className="h-full"
      theme={theme}
      editable={false}
      readOnly
      extensions={extensions}
      basicSetup={{ highlightActiveLine: false, highlightActiveLineGutter: false, foldGutter: true, searchKeymap: true }}
    />
  )
}
