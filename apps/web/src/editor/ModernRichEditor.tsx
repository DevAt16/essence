import { useEffect, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react'
import type { JSONContent } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import LinkExtension from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Eraser,
  Heading2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote as QuoteIcon,
  Redo2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'

type BlockType = 'paragraph' | 'heading' | 'quote' | 'bullet-list' | 'code'

interface NoteBlock {
  id: string
  type: BlockType
  text?: string
  items?: string[]
  citation?: string
}

type ModernRichEditorProps = {
  blocks: NoteBlock[]
  editorDoc?: JSONContent | null
  onChange: (blocks: NoteBlock[], editorDoc: JSONContent) => void
  onFocus: () => void
  onTitleChange: (title: string) => void
  title: string
}

const richEditorExtensions = [
  StarterKit.configure({
    heading: {
      levels: [2, 3],
    },
    link: false,
    underline: false,
  }),
  Underline,
  Highlight.configure({
    multicolor: false,
  }),
  Superscript,
  Subscript,
  LinkExtension.configure({
    autolink: true,
    openOnClick: false,
  }),
  TextAlign.configure({
    types: ['heading', 'paragraph'],
  }),
  Placeholder.configure({
    placeholder: ({ node }) => {
      if (node.type.name === 'heading') {
        return 'Section heading'
      }

      if (node.type.name === 'codeBlock') {
        return 'Code, data, or structured notes'
      }

      return 'Start writing, or type / for structure'
    },
  }),
]

export default function ModernRichEditor({
  blocks,
  editorDoc,
  onChange,
  onFocus,
  onTitleChange,
  title,
}: ModernRichEditorProps) {
  const safeEditorDoc = useMemo(() => normalizeEditorDocument(editorDoc, blocks), [blocks, editorDoc])
  const latestBlocksRef = useRef(blocks)
  const latestEditorDocRef = useRef(safeEditorDoc)
  const latestSignatureRef = useRef(getEditorStateSignature(blocks, safeEditorDoc))
  const onChangeRef = useRef(onChange)
  const onFocusRef = useRef(onFocus)
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null)

  const editor = useEditor({
    extensions: richEditorExtensions,
    content: safeEditorDoc,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'modern-editor__surface',
        'aria-label': 'Note body',
      },
    },
    onFocus: () => {
      onFocusRef.current()
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextEditorDoc = normalizeEditorDocument(currentEditor.getJSON(), latestBlocksRef.current)
      const nextBlocks = tiptapDocToNoteBlocks(nextEditorDoc, latestBlocksRef.current)
      const nextSignature = getEditorStateSignature(nextBlocks, nextEditorDoc)

      if (nextSignature === latestSignatureRef.current) {
        return
      }

      latestBlocksRef.current = nextBlocks
      latestEditorDocRef.current = nextEditorDoc
      latestSignatureRef.current = nextSignature
      onChangeRef.current(nextBlocks, nextEditorDoc)
    },
  })

  const externalSignature = getEditorStateSignature(blocks, safeEditorDoc)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onFocusRef.current = onFocus
  }, [onFocus])

  useEffect(() => {
    const titleInput = titleInputRef.current

    if (!titleInput) {
      return
    }

    titleInput.style.height = 'auto'
    titleInput.style.height = `${titleInput.scrollHeight}px`
  }, [title])

  useEffect(() => {
    if (!editor) {
      latestBlocksRef.current = blocks
      latestEditorDocRef.current = safeEditorDoc
      latestSignatureRef.current = externalSignature
      return
    }

    if (externalSignature === latestSignatureRef.current) {
      latestBlocksRef.current = blocks
      latestEditorDocRef.current = safeEditorDoc
      return
    }

    const currentEditorDoc = normalizeEditorDocument(editor.getJSON(), blocks)
    const currentSignature = getEditorStateSignature(tiptapDocToNoteBlocks(currentEditorDoc, blocks), currentEditorDoc)

    if (currentSignature !== externalSignature) {
      editor.commands.setContent(safeEditorDoc, { emitUpdate: false })
    }

    latestBlocksRef.current = blocks
    latestEditorDocRef.current = safeEditorDoc
    latestSignatureRef.current = externalSignature
  }, [blocks, editor, externalSignature, safeEditorDoc])

  const applyExternalLink = () => {
    if (!editor) {
      return
    }

    const currentHref = typeof editor.getAttributes('link').href === 'string' ? editor.getAttributes('link').href : ''
    const nextHref = window.prompt('Paste a URL for this text', currentHref)

    if (nextHref === null) {
      return
    }

    if (!nextHref.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: normalizeExternalHref(nextHref) }).run()
  }

  const clearFormatting = () => {
    editor?.chain().focus().unsetAllMarks().clearNodes().run()
  }

  const insertDivider = () => {
    editor?.chain().focus().setHorizontalRule().run()
  }

  const handleToolbarWheel = (event: ReactWheelEvent<HTMLElement>) => {
    const toolbar = event.currentTarget

    if (toolbar.scrollWidth <= toolbar.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return
    }

    event.preventDefault()
    toolbar.scrollLeft += event.deltaY
  }

  return (
    <section className="modern-editor" aria-label="Rich note editor">
      {editor && (
        <BubbleMenu editor={editor} className="modern-editor__bubble">
          <RichEditorButton active={editor.isActive('bold')} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold />
          </RichEditorButton>
          <RichEditorButton active={editor.isActive('italic')} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic />
          </RichEditorButton>
          <RichEditorButton
            active={editor.isActive('underline')}
            label="Underline"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon />
          </RichEditorButton>
          <RichEditorButton active={editor.isActive('code')} label="Inline code" onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code2 />
          </RichEditorButton>
          <RichEditorButton active={editor.isActive('link')} label="Link" onClick={applyExternalLink}>
            <Link2 />
          </RichEditorButton>
        </BubbleMenu>
      )}

      {editor && (
        <div className="modern-editor__toolbarFrame">
          <header className="modern-editor__toolbar" role="toolbar" aria-label="Editor formatting" onWheel={handleToolbarWheel}>
            <div className="modern-editor__toolbarGroup">
              <RichEditorButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>
                <Undo2 />
              </RichEditorButton>
              <RichEditorButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>
                <Redo2 />
              </RichEditorButton>
            </div>

            <div className="modern-editor__toolbarGroup">
              <RichEditorButton
                active={editor.isActive('heading', { level: 2 })}
                label="Heading"
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              >
                <Heading2 />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('bulletList')} label="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()}>
                <List />
              </RichEditorButton>
              <RichEditorButton
                active={editor.isActive('orderedList')}
                label="Numbered list"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('blockquote')} label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                <QuoteIcon />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('codeBlock')} label="Code block" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
                <Code2 />
              </RichEditorButton>
            </div>

            <div className="modern-editor__toolbarGroup">
              <RichEditorButton active={editor.isActive('bold')} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
                <Bold />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('italic')} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
                <Italic />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('strike')} label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}>
                <Strikethrough />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('code')} label="Inline code" onClick={() => editor.chain().focus().toggleCode().run()}>
                <Code2 />
              </RichEditorButton>
              <RichEditorButton
                active={editor.isActive('underline')}
                label="Underline"
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <UnderlineIcon />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('highlight')} label="Highlight" onClick={() => editor.chain().focus().toggleHighlight().run()}>
                <Highlighter />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('link')} label="Link" onClick={applyExternalLink}>
                <Link2 />
              </RichEditorButton>
              <RichEditorButton
                active={editor.isActive('superscript')}
                label="Superscript"
                onClick={() => editor.chain().focus().toggleSuperscript().run()}
              >
                <SuperscriptIcon />
              </RichEditorButton>
              <RichEditorButton active={editor.isActive('subscript')} label="Subscript" onClick={() => editor.chain().focus().toggleSubscript().run()}>
                <SubscriptIcon />
              </RichEditorButton>
            </div>

            <div className="modern-editor__toolbarGroup">
              <RichEditorButton
                active={editor.isActive({ textAlign: 'left' })}
                label="Align left"
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
              >
                <AlignLeft />
              </RichEditorButton>
              <RichEditorButton
                active={editor.isActive({ textAlign: 'center' })}
                label="Align center"
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
              >
                <AlignCenter />
              </RichEditorButton>
              <RichEditorButton
                active={editor.isActive({ textAlign: 'right' })}
                label="Align right"
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
              >
                <AlignRight />
              </RichEditorButton>
              <RichEditorButton
                active={editor.isActive({ textAlign: 'justify' })}
                label="Justify"
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
              >
                <AlignJustify />
              </RichEditorButton>
            </div>

            <div className="modern-editor__toolbarGroup modern-editor__toolbarGroup--end">
              <RichEditorButton label="Clear formatting" onClick={clearFormatting}>
                <Eraser />
              </RichEditorButton>
              <RichEditorButton label="Add divider" onClick={insertDivider}>
                <Minus />
              </RichEditorButton>
            </div>
          </header>
        </div>
      )}

      <div className="modern-editor__body">
        <textarea
          ref={titleInputRef}
          className="modern-editor__title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onFocus={onFocus}
          aria-label="Note title"
          placeholder="Untitled note"
          rows={1}
        />
        <EditorContent editor={editor} />
      </div>
    </section>
  )
}

function RichEditorButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`modern-editor__button ${active ? 'modern-editor__button--active' : ''}`}
      disabled={disabled}
      onMouseDown={preventButtonFocus}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

function noteBlocksToTiptapContent(blocks: NoteBlock[]): JSONContent {
  const content = blocks.map((block) => noteBlockToTiptapNode(block)).filter((node): node is JSONContent => Boolean(node))

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  }
}

function noteBlockToTiptapNode(block: NoteBlock): JSONContent | null {
  if (block.type === 'heading') {
    return {
      type: 'heading',
      attrs: { level: 2 },
      content: createTiptapInlineContentFromText(block.text ?? ''),
    }
  }

  if (block.type === 'quote') {
    return {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: createTiptapInlineContentFromText(block.text ?? '') }],
    }
  }

  if (block.type === 'bullet-list') {
    return {
      type: 'bulletList',
      content: (block.items && block.items.length > 0 ? block.items : ['']).map((item) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: createTiptapInlineContentFromText(item) }],
      })),
    }
  }

  if (block.type === 'code') {
    return {
      type: 'codeBlock',
      content: block.text ? [{ type: 'text', text: block.text }] : undefined,
    }
  }

  return {
    type: 'paragraph',
    content: createTiptapInlineContentFromText(block.text ?? ''),
  }
}

function createTiptapInlineContentFromText(value: string): JSONContent[] | undefined {
  if (!value) {
    return undefined
  }

  const content: JSONContent[] = []
  const inlinePattern = /(\[\[([^[\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|<u>([\s\S]+?)<\/u>|\*\*([^*]+)\*\*|\*([^*]+)\*)/g

  value.split('\n').forEach((line, lineIndex, lines) => {
    let lastIndex = 0

    for (const match of line.matchAll(inlinePattern)) {
      const matchedText = match[0]
      const startIndex = match.index ?? 0

      if (startIndex > lastIndex) {
        content.push({ type: 'text', text: line.slice(lastIndex, startIndex) })
      }

      if (match[2]) {
        content.push({ type: 'text', text: matchedText })
      } else if (match[3] && match[4]) {
        content.push({ type: 'text', text: match[3], marks: [{ type: 'link', attrs: { href: normalizeExternalHref(match[4]) } }] })
      } else if (match[5]) {
        content.push({ type: 'text', text: match[5], marks: [{ type: 'code' }] })
      } else if (match[6]) {
        content.push({ type: 'text', text: match[6], marks: [{ type: 'underline' }] })
      } else if (match[7]) {
        content.push({ type: 'text', text: match[7], marks: [{ type: 'bold' }] })
      } else if (match[8]) {
        content.push({ type: 'text', text: match[8], marks: [{ type: 'italic' }] })
      } else {
        content.push({ type: 'text', text: matchedText })
      }

      lastIndex = startIndex + matchedText.length
    }

    if (lastIndex < line.length) {
      content.push({ type: 'text', text: line.slice(lastIndex) })
    }

    if (lineIndex < lines.length - 1) {
      content.push({ type: 'hardBreak' })
    }
  })

  return content.length > 0 ? content : undefined
}

function normalizeEditorDocument(value: unknown, fallbackBlocks: NoteBlock[]): JSONContent {
  if (isEditorDocument(value)) {
    return {
      ...value,
      content: Array.isArray(value.content) ? value.content : [],
    }
  }

  return noteBlocksToTiptapContent(fallbackBlocks)
}

function isEditorDocument(value: unknown): value is JSONContent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as JSONContent
  return candidate.type === 'doc' && (candidate.content === undefined || Array.isArray(candidate.content))
}

function tiptapDocToNoteBlocks(doc: JSONContent, previousBlocks: NoteBlock[] = []): NoteBlock[] {
  const blocks = (doc.content ?? [])
    .map((node, index) => tiptapNodeToNoteBlock(node, previousBlocks[index]))
    .filter((block): block is NoteBlock => Boolean(block))

  return blocks.length > 0 ? blocks : [createEmptyBlock('paragraph')]
}

function tiptapNodeToNoteBlock(node: JSONContent, previousBlock?: NoteBlock): NoteBlock | null {
  const id = previousBlock?.id ?? generateId('block')

  if (node.type === 'heading') {
    return { id, type: 'heading', text: serializeTiptapInlineContent(node.content) }
  }

  if (node.type === 'blockquote') {
    return {
      id,
      type: 'quote',
      text: serializeTiptapBlockText(node).trim(),
      citation: previousBlock?.type === 'quote' ? previousBlock.citation ?? '' : '',
    }
  }

  if (node.type === 'bulletList' || node.type === 'orderedList') {
    const items = (node.content ?? [])
      .filter((child) => child.type === 'listItem')
      .map((child) => serializeTiptapBlockText(child).trim())

    return { id, type: 'bullet-list', items: items.length > 0 ? items : [''] }
  }

  if (node.type === 'codeBlock') {
    return { id, type: 'code', text: serializeTiptapBlockText(node) }
  }

  if (node.type === 'paragraph') {
    return { id, type: 'paragraph', text: serializeTiptapInlineContent(node.content) }
  }

  return null
}

function serializeTiptapBlockText(node: JSONContent): string {
  if (node.type === 'text') {
    return serializeTiptapTextNode(node)
  }

  if (node.type === 'hardBreak') {
    return '\n'
  }

  if (node.type === 'paragraph' || node.type === 'heading') {
    return serializeTiptapInlineContent(node.content)
  }

  if (node.type === 'listItem') {
    return (node.content ?? []).map(serializeTiptapBlockText).filter(Boolean).join('\n')
  }

  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content ?? []).map(serializeTiptapBlockText).filter(Boolean).join('\n')
  }

  if (node.type === 'blockquote') {
    return (node.content ?? []).map(serializeTiptapBlockText).filter(Boolean).join('\n')
  }

  if (node.type === 'codeBlock') {
    return (node.content ?? []).map((child) => child.text ?? '').join('')
  }

  return (node.content ?? []).map(serializeTiptapBlockText).filter(Boolean).join('\n')
}

function serializeTiptapInlineContent(content: JSONContent[] | undefined) {
  return (content ?? [])
    .map((node) => {
      if (node.type === 'text') {
        return serializeTiptapTextNode(node)
      }

      if (node.type === 'hardBreak') {
        return '\n'
      }

      return serializeTiptapBlockText(node)
    })
    .join('')
}

function serializeTiptapTextNode(node: JSONContent) {
  let text = node.text ?? ''

  if (!text) {
    return ''
  }

  const marks = node.marks ?? []
  const linkMark = marks.find((mark) => mark.type === 'link')

  if (linkMark) {
    const href = typeof linkMark.attrs?.href === 'string' ? linkMark.attrs.href : ''
    return href ? `[${text}](${href})` : text
  }

  if (marks.some((mark) => mark.type === 'code')) {
    return `\`${text}\``
  }

  if (marks.some((mark) => mark.type === 'underline')) {
    text = `<u>${text}</u>`
  }

  if (marks.some((mark) => mark.type === 'bold')) {
    text = `**${text}**`
  }

  if (marks.some((mark) => mark.type === 'italic')) {
    text = `*${text}*`
  }

  return text
}

function getEditorStateSignature(blocks: NoteBlock[], editorDoc: JSONContent) {
  return JSON.stringify({
    blocks: blocks.map((block) => ({
      citation: block.citation ?? '',
      items: block.items ?? [],
      text: block.text ?? '',
      type: block.type,
    })),
    editorDoc,
  })
}

function createEmptyBlock(type: BlockType, id = generateId('block')): NoteBlock {
  switch (type) {
    case 'heading':
      return { id, type, text: '' }
    case 'quote':
      return { id, type, text: '', citation: '' }
    case 'bullet-list':
      return { id, type, items: [''] }
    case 'code':
      return { id, type, text: '' }
    default:
      return { id, type: 'paragraph', text: '' }
  }
}

function normalizeExternalHref(value: string) {
  const trimmedValue = value.trim()

  if (/^(https?:|mailto:|doi:)/i.test(trimmedValue)) {
    return trimmedValue
  }

  return `https://${trimmedValue}`
}

function generateId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function preventButtonFocus(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}
