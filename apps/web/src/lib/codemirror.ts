import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Syntax colours from the theme tokens, so code matches the structure tree in light and dark. */
export const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--c-t-key)' },
    { tag: [t.string, t.special(t.string)], color: 'var(--c-t-string)' },
    { tag: [t.number], color: 'var(--c-t-number)' },
    { tag: [t.bool], color: 'var(--c-t-boolean)' },
    { tag: [t.null], color: 'var(--c-t-null)' },
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword], color: 'var(--c-t-keyword)' },
    { tag: [t.typeName, t.className, t.definition(t.typeName)], color: 'var(--c-t-ref)' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--c-t-number)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--c-t-comment)', fontStyle: 'italic' },
    { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--c-ink-3)' },
  ]),
)
