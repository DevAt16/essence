import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

type CollectionId = string
type NoteLayout = 'feature' | 'standard' | 'quote'
type NoteType = 'quote' | undefined
type BlockType = 'paragraph' | 'heading' | 'quote' | 'bullet-list' | 'code'
type AiDraftCategory = 'essay' | 'article' | 'research-topic' | 'quote'
type AiComposerMode = 'draft' | 'assist'
type AiComposerOutputMode = 'preview' | 'insert'
type AiAssistAction =
  | 'continue-writing'
  | 'improve-clarity'
  | 'create-outline'
  | 'study-questions'
  | 'counterarguments'
  | 'reading-list'
type AiAssistActionGroup = 'Write' | 'Review'

interface AiDraftBlock {
  citation?: string
  items?: string[]
  text?: string
  type: BlockType
}

interface AiDraft {
  blocks: AiDraftBlock[]
  collectionId: CollectionId
  layout: NoteLayout
  noteType?: NoteType
  status: string
  summary: string
  tags: string[]
  title: string
}

interface AiAssistResult {
  action: AiAssistAction
  actionLabel: string
  blocks: AiDraftBlock[]
  canReplaceSelection: boolean
  summary: string
  title: string
}

interface ComposerHistoryEntry {
  assist?: {
    action: AiAssistAction
    actionLabel: string
  }
  blocks: AiDraftBlock[]
  createdAt: string
  draft?: {
    category: AiDraftCategory
    collectionId: CollectionId
    layout: NoteLayout
    noteType?: NoteType
    status: string
    tags: string[]
  }
  id: string
  mode: AiComposerMode
  prompt: string
  sourceTitle: string
  summary: string
  title: string
}

interface AiComposerPanelProps {
  activeNoteTitle: string | null
  assistAction: AiAssistAction
  assistError: string | null
  assistResult: AiAssistResult | null
  category: AiDraftCategory
  canReplaceSelection: boolean
  composerHistory: ComposerHistoryEntry[]
  draft: AiDraft | null
  error: string | null
  isAssisting: boolean
  isGenerating: boolean
  isOpen: boolean
  mode: AiComposerMode
  runtimeLabel: string
  onAppendAssist: () => void
  onAssistActionChange: (action: AiAssistAction) => void
  onCategoryChange: (category: AiDraftCategory) => void
  onClearHistory: () => void
  onClose: () => void
  onCreateNote: () => void
  onGenerateAssist: () => void
  onGenerate: () => void
  onModeChange: (mode: AiComposerMode) => void
  onReplaceSelection: () => void
  onRestoreHistory: (entry: ComposerHistoryEntry) => void
  onTopicChange: (value: string) => void
  selectedBlockPreview: string
  topic: string
}

const collectionNameById: Record<CollectionId, string> = {
  work: 'Work',
  personal: 'Personal',
  research: 'Research',
  ideas: 'Ideas',
}

function getCollectionName(collectionId: CollectionId) {
  return collectionNameById[collectionId] ?? humanizeCollectionId(collectionId)
}

function humanizeCollectionId(collectionId: CollectionId) {
  const label = collectionId
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return label ? label.replace(/\b\w/g, (character) => character.toUpperCase()).slice(0, 80) : 'Untitled Collection'
}

const aiDraftCategories: Array<{ description: string; label: string; value: AiDraftCategory }> = [
  {
    value: 'essay',
    label: 'Essay',
    description: 'Argument, reflection, and synthesis.',
  },
  {
    value: 'article',
    label: 'Article',
    description: 'Clear explanatory writing with sections.',
  },
  {
    value: 'research-topic',
    label: 'Research Topic',
    description: 'Questions, hypotheses, and next checks.',
  },
  {
    value: 'quote',
    label: 'Quote',
    description: 'A concise line with a short reflection.',
  },
]

const aiAssistActions: Array<{
  description: string
  group: AiAssistActionGroup
  label: string
  value: AiAssistAction
}> = [
  {
    value: 'continue-writing',
    group: 'Write',
    label: 'Continue',
    description: 'Add the next coherent blocks.',
  },
  {
    value: 'improve-clarity',
    group: 'Write',
    label: 'Clarify',
    description: 'Rewrite the selected block, or suggest a clarity pass.',
  },
  {
    value: 'create-outline',
    group: 'Review',
    label: 'Outline',
    description: 'Find structure, gaps, and next sections.',
  },
  {
    value: 'study-questions',
    group: 'Review',
    label: 'Study',
    description: 'Generate review prompts and key questions.',
  },
  {
    value: 'counterarguments',
    group: 'Review',
    label: 'Counterpoints',
    description: 'Find objections, tensions, and alternate readings.',
  },
  {
    value: 'reading-list',
    group: 'Review',
    label: 'Reading list',
    description: 'Turn this note into a guided source-finding plan.',
  },
]

const aiAssistActionGroups: AiAssistActionGroup[] = ['Write', 'Review']

export default function AiComposerPanel({
  activeNoteTitle,
  assistAction,
  assistError,
  assistResult,
  category,
  canReplaceSelection,
  composerHistory,
  draft,
  error,
  isAssisting,
  isGenerating,
  isOpen,
  mode,
  runtimeLabel,
  onAppendAssist,
  onAssistActionChange,
  onCategoryChange,
  onClearHistory,
  onClose,
  onCreateNote,
  onGenerateAssist,
  onGenerate,
  onModeChange,
  onReplaceSelection,
  onRestoreHistory,
  onTopicChange,
  selectedBlockPreview,
  topic,
}: AiComposerPanelProps) {
  const activeCategory = aiDraftCategories.find((candidate) => candidate.value === category) ?? aiDraftCategories[0]
  const previewBlocks = draft?.blocks.slice(0, 4) ?? []
  const assistPreviewBlocks = assistResult?.blocks.slice(0, 4) ?? []
  const activeAssistAction = aiAssistActions.find((action) => action.value === assistAction) ?? aiAssistActions[0]
  const runtimeSuffix = runtimeLabel && runtimeLabel !== 'Composer' ? ` with ${runtimeLabel}` : ''
  const outputResetKey =
    mode === 'draft'
      ? `draft:${draft?.title ?? 'empty'}:${draft?.blocks.length ?? 0}:${draft?.summary ?? ''}`
      : `assist:${assistResult?.title ?? 'empty'}:${assistResult?.blocks.length ?? 0}:${assistResult?.summary ?? ''}`
  const [outputState, setOutputState] = useState<{ key: string; mode: AiComposerOutputMode }>({
    key: outputResetKey,
    mode: 'preview',
  })
  const outputMode = outputState.key === outputResetKey ? outputState.mode : 'preview'
  const changeOutputMode = (nextMode: AiComposerOutputMode) => {
    setOutputState({ key: outputResetKey, mode: nextMode })
  }

  const handleDraftSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onGenerate()
  }

  const handleAssistSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onGenerateAssist()
  }

  return (
    <aside className={`ai-composer ${isOpen ? 'ai-composer--open' : ''}`} aria-hidden={!isOpen}>
      <div className="ai-composer__panel">
        <div className="ai-composer__header">
          <div>
            <span className="ai-composer__eyebrow">Essence Composer</span>
            <h2>{mode === 'draft' ? 'Draft with a topic.' : 'Work inside this note.'}</h2>
            <p>
              {mode === 'draft'
                ? 'Generate a structured note, then refine it in the editor.'
                : 'Continue, clarify, outline, or turn this note into study material.'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close Composer">
            <Icon name="close" />
          </button>
        </div>

        <div className="ai-composer__modeToggle" role="tablist" aria-label="Composer mode">
          <button
            type="button"
            className={`ai-composer__modeButton ${mode === 'draft' ? 'ai-composer__modeButton--active' : ''}`}
            onClick={() => onModeChange('draft')}
            role="tab"
            aria-selected={mode === 'draft'}
          >
            <strong>New draft</strong>
            <span>Creates a note</span>
          </button>
          <button
            type="button"
            className={`ai-composer__modeButton ${mode === 'assist' ? 'ai-composer__modeButton--active' : ''}`}
            onClick={() => onModeChange('assist')}
            role="tab"
            aria-selected={mode === 'assist'}
          >
            <strong>Assist note</strong>
            <span>Writes here</span>
          </button>
        </div>

        {mode === 'draft' ? (
          <>
            <form className="ai-composer__form" onSubmit={handleDraftSubmit} aria-busy={isGenerating}>
              <div className="ai-composer__sectionLabel">
                <Icon name="spark" />
                <span>Prompt</span>
              </div>

              <label className="ai-composer__field">
                <span>Topic</span>
                <textarea
                  value={topic}
                  onChange={(event) => onTopicChange(event.target.value)}
                  placeholder="Cliodynamics and the rise of empires"
                  rows={3}
                  disabled={isGenerating}
                />
              </label>

              <label className="ai-composer__field">
                <span>Type</span>
                <select
                  value={category}
                  onChange={(event) => onCategoryChange(event.target.value as AiDraftCategory)}
                  disabled={isGenerating}
                >
                  {aiDraftCategories.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <p className="ai-composer__hint">{activeCategory.description}</p>

              {error && <p className="ai-composer__error">{error}</p>}

              <button type="submit" className="primary-button ai-composer__submit" disabled={isGenerating}>
                {isGenerating ? <span className="ai-composer__buttonSpinner" aria-hidden="true" /> : <Icon name="spark" />}
                <span>{isGenerating ? 'Composing...' : 'Generate draft'}</span>
              </button>
            </form>

            <div className="ai-composer__preview" aria-live="polite" aria-busy={isGenerating}>
              {isGenerating ? (
                <ComposerWaitingState
                  title={`Composing${runtimeSuffix}...`}
                  detail={
                    runtimeLabel === 'Ollama'
                      ? 'Waking the local model and shaping the result into editable blocks.'
                      : 'Sending the prompt through the API and shaping the result into editable blocks.'
                  }
                />
              ) : draft ? (
                <>
                  <AiOutputToolbar
                    mode={outputMode}
                    onChange={changeOutputMode}
                    summary={`${formatCount(draft.blocks.length, 'block')} ready`}
                  />

                  {outputMode === 'preview' ? (
                    <>
                      <div className="ai-composer__draftHeader">
                        <span className="badge">{draft.status}</span>
                        <h3>{draft.title}</h3>
                        {draft.summary && <p>{draft.summary}</p>}
                      </div>

                      <div className="ai-composer__tags">
                        {draft.tags.slice(0, 5).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>

                      <AiBlocksPreview blocks={previewBlocks} />
                    </>
                  ) : (
                    <div className="ai-composer__insertPlan">
                      <span>Insert plan</span>
                      <h3>{`Create a ${getCollectionName(draft.collectionId)} note`}</h3>
                      <p>
                        Essence will create a new note named "{draft.title}" with{' '}
                        {formatCount(draft.blocks.length, 'block')} and keep it editable in the block editor.
                      </p>
                      <button type="button" className="primary-button" onClick={onCreateNote}>
                        <Icon name="compose" />
                        <span>Create note</span>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="ai-composer__empty">
                  <Icon name="spark" />
                  <strong>A quiet drafting sidecar.</strong>
                  <span>Use it for first drafts, article skeletons, research framings, and quotes.</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <form className="ai-composer__form" onSubmit={handleAssistSubmit} aria-busy={isAssisting}>
              <div className="ai-composer__sectionLabel">
                <Icon name="spark" />
                <span>Assist action</span>
              </div>

              <div className="ai-composer__contextCard">
                <span>Current note</span>
                <strong>{activeNoteTitle ?? 'No note open'}</strong>
                {selectedBlockPreview && <p>Selected block: {selectedBlockPreview}</p>}
              </div>

              <div className="ai-composer__actionGroups" role="radiogroup" aria-label="Assist note Composer action">
                {aiAssistActionGroups.map((group) => (
                  <section key={group} className="ai-composer__actionGroup" aria-label={group}>
                    <span>{group}</span>
                    <div className="ai-composer__actionGrid">
                      {aiAssistActions
                        .filter((action) => action.group === group)
                        .map((action) => (
                          <button
                            key={action.value}
                            type="button"
                            className={`ai-composer__actionChoice ${assistAction === action.value ? 'ai-composer__actionChoice--active' : ''}`}
                            onClick={() => onAssistActionChange(action.value)}
                            role="radio"
                            aria-checked={assistAction === action.value}
                            disabled={isAssisting}
                          >
                            <strong>{action.label}</strong>
                            <span>{action.description}</span>
                          </button>
                        ))}
                    </div>
                  </section>
                ))}
              </div>

              <p className="ai-composer__hint">{activeAssistAction.description}</p>

              {assistError && <p className="ai-composer__error">{assistError}</p>}

              <button
                type="submit"
                className="primary-button ai-composer__submit"
                disabled={isAssisting || !activeNoteTitle}
              >
                {isAssisting ? <span className="ai-composer__buttonSpinner" aria-hidden="true" /> : <Icon name="spark" />}
                <span>{isAssisting ? 'Thinking...' : 'Assist this note'}</span>
              </button>
            </form>

            <div className="ai-composer__preview" aria-live="polite" aria-busy={isAssisting}>
              {isAssisting ? (
                <ComposerWaitingState
                  title={`Thinking${runtimeSuffix}...`}
                  detail={
                    runtimeLabel === 'Ollama'
                      ? 'Local models can take a moment, especially on the first request after launch.'
                      : 'Reading the note context and preparing editable blocks.'
                  }
                />
              ) : assistResult ? (
                <>
                  <AiOutputToolbar
                    mode={outputMode}
                    onChange={changeOutputMode}
                    summary={`${formatCount(assistResult.blocks.length, 'block')} ready`}
                  />

                  {outputMode === 'preview' ? (
                    <>
                      <div className="ai-composer__draftHeader">
                        <span className="badge">{assistResult.actionLabel}</span>
                        <h3>{assistResult.title}</h3>
                        {assistResult.summary && <p>{assistResult.summary}</p>}
                      </div>

                      <AiBlocksPreview blocks={assistPreviewBlocks} />
                    </>
                  ) : (
                    <div className="ai-composer__insertPlan">
                      <span>Insert plan</span>
                      <h3>Write into the current note</h3>
                      <p>
                        Append {formatCount(assistResult.blocks.length, 'block')} to "{activeNoteTitle}". Clarify can
                        also replace the selected block when a block is selected.
                      </p>
                      <div className="ai-composer__buttonRow">
                        {canReplaceSelection && (
                          <button type="button" className="ghost-button" onClick={onReplaceSelection}>
                            <Icon name="edit" />
                            <span>Replace block</span>
                          </button>
                        )}
                        <button type="button" className="primary-button" onClick={onAppendAssist}>
                          <Icon name="plus" />
                          <span>Append</span>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="ai-composer__empty">
                  <Icon name="spark" />
                  <strong>Context-aware help.</strong>
                  <span>Open a note, choose a focused action, and insert the result as editable blocks.</span>
                </div>
              )}
            </div>
          </>
        )}

        <ComposerHistoryList entries={composerHistory} onClear={onClearHistory} onRestore={onRestoreHistory} />

        <p className="ai-composer__footnote">
          Generated drafts can be useful starting points. Verify facts and sources before treating them as research.
        </p>
      </div>
    </aside>
  )
}

function ComposerHistoryList({
  entries,
  onClear,
  onRestore,
}: {
  entries: ComposerHistoryEntry[]
  onClear: () => void
  onRestore: (entry: ComposerHistoryEntry) => void
}) {
  if (entries.length === 0) {
    return (
      <section className="ai-composer__history ai-composer__history--empty">
        <div className="ai-composer__historyHeader">
          <div>
            <span>History</span>
            <h3>Composer history</h3>
          </div>
        </div>
        <p>Generated drafts and note assists will appear here for quick reuse.</p>
      </section>
    )
  }

  return (
    <section className="ai-composer__history">
      <div className="ai-composer__historyHeader">
        <div>
          <span>History</span>
          <h3>Composer history</h3>
        </div>
        <button type="button" className="text-link" onClick={onClear}>
          Clear
        </button>
      </div>

      <div className="ai-composer__historyList">
        {entries.slice(0, 6).map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="ai-composer__historyItem"
            onClick={() => onRestore(entry)}
          >
            <span className="ai-composer__historyMeta">
              <span>{entry.mode === 'draft' ? 'New draft' : entry.assist?.actionLabel ?? 'Assist note'}</span>
              <span>{formatComposerHistoryTimestamp(entry.createdAt)}</span>
            </span>
            <strong>{entry.title}</strong>
            <span className="ai-composer__historySource">{entry.sourceTitle}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function ComposerWaitingState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="ai-composer__working" role="status">
      <span className="ai-composer__workingSpinner" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <div className="ai-composer__workingLines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}

function AiOutputToolbar({
  mode,
  onChange,
  summary,
}: {
  mode: AiComposerOutputMode
  onChange: (mode: AiComposerOutputMode) => void
  summary: string
}) {
  return (
    <div className="ai-composer__outputToolbar">
      <span>{summary}</span>
      <div className="ai-composer__outputTabs" role="tablist" aria-label="Composer output">
        <button
          type="button"
          className={mode === 'preview' ? 'ai-composer__outputTab--active' : ''}
          onClick={() => onChange('preview')}
          role="tab"
          aria-selected={mode === 'preview'}
        >
          Preview
        </button>
        <button
          type="button"
          className={mode === 'insert' ? 'ai-composer__outputTab--active' : ''}
          onClick={() => onChange('insert')}
          role="tab"
          aria-selected={mode === 'insert'}
        >
          Insert
        </button>
      </div>
    </div>
  )
}

function AiBlocksPreview({ blocks }: { blocks: AiDraftBlock[] }) {
  return (
    <div className="ai-composer__blocks">
      {blocks.map((block, index) => (
        <AiDraftPreviewBlock key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  )
}

function AiDraftPreviewBlock({ block }: { block: AiDraftBlock }) {
  if (block.type === 'heading') {
    return <h4>{block.text}</h4>
  }

  if (block.type === 'quote') {
    return (
      <blockquote>
        <p>{block.text}</p>
        {block.citation && <cite>{block.citation}</cite>}
      </blockquote>
    )
  }

  if (block.type === 'bullet-list') {
    return (
      <ul>
        {(block.items ?? []).slice(0, 5).map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    )
  }

  if (block.type === 'code') {
    return <pre>{block.text}</pre>
  }

  return <p>{block.text}</p>
}

function formatComposerHistoryTimestamp(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  const elapsedMs = Date.now() - date.getTime()
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (elapsedMs < minuteMs) {
    return 'Just now'
  }

  if (elapsedMs < hourMs) {
    return `${Math.floor(elapsedMs / minuteMs)}m ago`
  }

  if (elapsedMs < dayMs) {
    return `${Math.floor(elapsedMs / hourMs)}h ago`
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function Icon({ name }: { name: 'close' | 'compose' | 'edit' | 'plus' | 'spark' }) {
  switch (name) {
    case 'close':
      return (
        <Glyph>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </Glyph>
      )
    case 'compose':
      return (
        <Glyph>
          <path d="M6 4h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          <path d="M14 4v4h4" />
          <path d="M8 14h8" />
          <path d="M12 10v8" />
        </Glyph>
      )
    case 'edit':
      return (
        <Glyph>
          <path d="m4 20 4-1 9-9-3-3-9 9-1 4Z" />
          <path d="m13 6 3 3" />
        </Glyph>
      )
    case 'plus':
      return (
        <Glyph>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </Glyph>
      )
    case 'spark':
      return (
        <Glyph>
          <path d="M12 3v5" />
          <path d="M12 16v5" />
          <path d="M3 12h5" />
          <path d="M16 12h5" />
          <path d="m5.6 5.6 3.1 3.1" />
          <path d="m15.3 15.3 3.1 3.1" />
          <path d="m18.4 5.6-3.1 3.1" />
          <path d="m8.7 15.3-3.1 3.1" />
        </Glyph>
      )
  }
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}
