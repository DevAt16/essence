import { lazy, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { JSONContent } from '@tiptap/core'
import './App.css'

const ModernRichEditor = lazy(() => import('./editor/ModernRichEditor'))
const AiComposerPanel = lazy(() => import('./composer/AiComposerPanel'))

type ViewMode = 'library' | 'collections' | 'favorites' | 'archive' | 'editor'
type NavMode = Exclude<ViewMode, 'editor'>
type CollectionId = 'work' | 'personal' | 'research' | 'ideas'
type CollectionIcon = 'briefcase' | 'person' | 'flask' | 'bulb'
type NoteLayout = 'feature' | 'standard' | 'quote'
type NoteType = 'quote' | undefined
type BlockType = 'paragraph' | 'heading' | 'quote' | 'bullet-list' | 'code'
type NoteViewMode = 'read' | 'edit'
type NoteSourceKind = 'book' | 'paper' | 'article' | 'web' | 'dataset' | 'other'
type AiDraftCategory = 'essay' | 'article' | 'research-topic' | 'quote'
type AiComposerMode = 'draft' | 'assist'
type AiAssistAction =
  | 'continue-writing'
  | 'improve-clarity'
  | 'create-outline'
  | 'study-questions'
  | 'counterarguments'
  | 'reading-list'
type AiAssistActionGroup = 'Write' | 'Review'
type EditorContextSectionId = 'details' | 'topics' | 'sources'
type AmbienceMode = 'still' | 'subtle' | 'cosmic'
type ReaderExplorationAction = 'expand' | 'questions' | 'counterarguments' | 'reading-list'
type LibraryDisplayMode = 'cards' | 'list'
type LibraryQuickFilter = 'all' | 'drafts' | 'pinned' | 'favorites' | 'essays' | 'topics'

interface NoteBlock {
  id: string
  type: BlockType
  text?: string
  items?: string[]
  citation?: string
}

interface NoteSource {
  id: string
  sourceType: NoteSourceKind
  title: string
  author: string
  year: string
  publisher: string
  url: string
  note: string
}

interface BlockFocusRequest {
  blockId: string
  placement: 'start' | 'end' | number
}

interface SlashMenuItem {
  type: BlockType
  title: string
  description: string
  keywords: string[]
}

interface SlashMenuState {
  blockId: string
  query: string
  activeIndex: number
}

interface LinkMenuState {
  blockId: string
  query: string
  activeIndex: number
  replacementStart: number
  replacementEnd: number
}

type InlineFormat = 'bold' | 'italic' | 'underline' | 'code' | 'link'

interface TextSelectionRange {
  start: number
  end: number
}

interface Note {
  id: string
  title: string
  collectionId: CollectionId
  folderId: string | null
  status: string
  blocks: NoteBlock[]
  editorDoc?: JSONContent | null
  sources: NoteSource[]
  tags: string[]
  previewDate: string
  updatedAt: string
  isFavorite: boolean
  isPinned: boolean
  isArchived?: boolean
  type?: NoteType
  layout: NoteLayout
}

interface CollectionSummary {
  id: CollectionId
  name: string
  description: string
  icon: CollectionIcon
}

interface Folder {
  id: string
  name: string
  parentId: string | null
  collectionId: CollectionId
}

interface FilterOptions {
  collectionId: CollectionId | null
  folderId: string | null
  foldersById: Record<string, Folder>
  query: string
  tag: string | null
}

interface PersistedAppState {
  activeNoteId: string | null
  composerHistory: ComposerHistoryEntry[]
  folders: Folder[]
  notes: Note[]
}

interface AuthUser {
  displayName: string
  email: string
  id: string
  isLocal: boolean
}

interface RemoteAppSnapshot {
  state: PersistedAppState | null
  user: AuthUser | null
}

type RemoteSignInResult =
  | { kind: 'magic-link'; email: string }
  | { kind: 'session'; snapshot: RemoteAppSnapshot }

interface ImportedMarkdownNote {
  note: Note
  folderPath: string[]
}

interface HistorySnapshot {
  activeCollectionId: CollectionId | null
  activeFolderId: string | null
  activeNoteId: string | null
  activeTag: string | null
  editorContext: NavMode
  expandedFolderIds: string[]
  folders: Folder[]
  noteViewMode: NoteViewMode
  notes: Note[]
  view: ViewMode
}

interface NoteRevision {
  createdAt: string
  id: string
  noteId: string
  noteTitle: string
  revisionKind: string
  snapshot: Note
}

interface PendingRevisionEvent {
  noteId: string
  revisionKind: string
}

interface SearchResult {
  matchedFields: string[]
  noteId: string
  score: number
}

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

interface ComposerContextItem {
  actionLabel?: string
  blocksPreview: string
  createdAt: string
  mode: AiComposerMode
  prompt: string
  sourceTitle: string
  summary: string
  title: string
}

interface ComposerRequestContext {
  recent: ComposerContextItem[]
}

type AppDialogState =
  | {
      confirmLabel: string
      message: string
      title: string
      tone?: 'default' | 'danger'
      type: 'alert'
    }
  | {
      confirmLabel: string
      message: string
      onConfirm: () => void
      title: string
      tone?: 'default' | 'danger'
      type: 'confirm'
    }
  | {
      confirmLabel: string
      initialValue: string
      label: string
      message: string
      onConfirm: (value: string) => void
      placeholder?: string
      title: string
      type: 'prompt'
    }

type QuickSwitcherItemKind = 'action' | 'collection' | 'folder' | 'note' | 'tag'

type QuickSwitcherTarget =
  | { type: 'collection'; collectionId: CollectionId }
  | { type: 'create-note' }
  | { type: 'folder'; folderId: string }
  | { type: 'navigate'; view: NavMode }
  | { type: 'note'; noteId: string }
  | { type: 'tag'; tagName: string }

interface QuickSwitcherItem {
  id: string
  kind: QuickSwitcherItemKind
  keywords: string
  subtitle: string
  target: QuickSwitcherTarget
  title: string
}

const storageKey = 'lucid-notes-state'
const authGateStorageKey = 'essence-auth-gate-dismissed'
const ambienceStorageKey = 'essence-ambience-mode'
const navigationSidebarStorageKey = 'essence-navigation-sidebar-visible'
const historyLimit = 120
const composerHistoryLimit = 18
const composerRequestContextLimit = 3
const composerRequestContextPreviewLength = 700
const apiBaseUrl = normalizeApiBaseUrl(getViteEnvString('VITE_API_BASE_URL'))
const apiFetchCredentials = getApiFetchCredentials()
const supabaseClient = createSupabaseBrowserClient()
const devEmailLoginEnabled = getViteEnvString('VITE_AUTH_DEV_EMAIL_LOGIN') === 'true'
const waitlistUrl = getViteEnvString('VITE_WAITLIST_URL')

const ambienceOptions: Array<{ description: string; label: string; value: AmbienceMode }> = [
  { description: 'No moving stars for deep reading.', label: 'Still', value: 'still' },
  { description: 'Quiet stars with rare motion.', label: 'Subtle', value: 'subtle' },
  { description: 'Full cosmic field with shooting stars.', label: 'Cosmic', value: 'cosmic' },
]

const sourceTypeOptions: Array<{ label: string; value: NoteSourceKind }> = [
  { label: 'Book', value: 'book' },
  { label: 'Paper', value: 'paper' },
  { label: 'Article', value: 'article' },
  { label: 'Web', value: 'web' },
  { label: 'Dataset', value: 'dataset' },
  { label: 'Other', value: 'other' },
]

function createEmptyPersistedState(): PersistedAppState {
  return {
    activeNoteId: null,
    composerHistory: [],
    folders: [],
    notes: [],
  }
}

function hasWorkspaceData(state: PersistedAppState) {
  return state.notes.length > 0 || state.folders.length > 0 || state.composerHistory.length > 0
}

const collections: CollectionSummary[] = [
  {
    id: 'work',
    name: 'Work',
    description: 'Projects, meetings, and strategy.',
    icon: 'briefcase',
  },
  {
    id: 'personal',
    name: 'Personal',
    description: 'Journaling and personal goals.',
    icon: 'person',
  },
  {
    id: 'research',
    name: 'Research',
    description: 'Essays, references, and literature.',
    icon: 'flask',
  },
  {
    id: 'ideas',
    name: 'Ideas',
    description: 'Fleeting thoughts and concepts.',
    icon: 'bulb',
  },
]

const collectionNameById = collections.reduce<Record<CollectionId, string>>(
  (accumulator, collection) => {
    accumulator[collection.id] = collection.name
    return accumulator
  },
  {} as Record<CollectionId, string>,
)

const tagPool = [
  'design-system',
  'typography',
  'q1-planning',
  'reading-list',
  'drafts',
  'philosophy',
  'personal',
  'writing',
  'ai-draft',
  'essay',
  'article',
  'research-topic',
  'quote',
] as const

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

const readerExplorationActions: Array<{
  action: ReaderExplorationAction
  description: string
  label: string
}> = [
  {
    action: 'expand',
    label: 'Expand',
    description: 'Continue the essay with the next coherent layer.',
  },
  {
    action: 'questions',
    label: 'Questions',
    description: 'Create study questions and review prompts.',
  },
  {
    action: 'counterarguments',
    label: 'Counterpoints',
    description: 'Surface objections and alternate interpretations.',
  },
  {
    action: 'reading-list',
    label: 'Reading list',
    description: 'Build a research path without fake citations.',
  },
]

const readerExplorationAssistActionByAction: Record<ReaderExplorationAction, AiAssistAction> = {
  expand: 'continue-writing',
  questions: 'study-questions',
  counterarguments: 'counterarguments',
  'reading-list': 'reading-list',
}

const browseViewMeta: Record<NavMode, { heading: string; description: string }> = {
  library: {
    heading: 'Library',
    description: 'Your recent thoughts and collections.',
  },
  collections: {
    heading: 'Collections',
    description: 'Collections, nested folders, and tags.',
  },
  favorites: {
    heading: 'Starred',
    description: 'Notes worth returning to.',
  },
  archive: {
    heading: 'Archive',
    description: 'Earlier drafts and retired directions.',
  },
}

const libraryQuickFilters: Array<{ id: LibraryQuickFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'essays', label: 'Essays' },
  { id: 'topics', label: 'Topics' },
]

const slashMenuOptions: SlashMenuItem[] = [
  {
    type: 'paragraph',
    title: 'Paragraph',
    description: 'Long-form body text for notes and reflections.',
    keywords: ['text', 'body', 'writing'],
  },
  {
    type: 'heading',
    title: 'Heading',
    description: 'Introduce a new section with editorial emphasis.',
    keywords: ['title', 'section', 'header'],
  },
  {
    type: 'quote',
    title: 'Quote',
    description: 'Set apart a quotation or reflective line.',
    keywords: ['citation', 'pull quote', 'blockquote'],
  },
  {
    type: 'bullet-list',
    title: 'Bullet List',
    description: 'Capture a short sequence of points or tasks.',
    keywords: ['list', 'bullets', 'items'],
  },
  {
    type: 'code',
    title: 'Code',
    description: 'Preserve syntax, snippets, or structured notes.',
    keywords: ['snippet', 'monospace', 'preformatted'],
  },
]

const noteBody = {
  aesthetics: `
    <p>In a world characterized by an incessant barrage of sensory input, silence has transitioned from a natural state of being into a luxury commodity. The modern mind is constantly tethered to digital tethers, pulled in myriad directions by notifications, endless scrolling, and the societal pressure to remain perpetually connected.</p>
    <p>We often consider silence merely as the absence of noise. However, true silence is an active presence. It is the canvas upon which profound thought is painted. Without the negative space of silence, the music of our daily lives becomes a cacophony.</p>
    <blockquote>
      <p>All of humanity's problems stem from man's inability to sit quietly in a room alone.</p>
      <cite>Blaise Pascal</cite>
    </blockquote>
    <p>Consider the architecture of a cathedral or the vastness of a desert. The power of these spaces lies not just in what is there, but in what is absent. They force a confrontation with the self.</p>
    <h2>Designing for Focus</h2>
    <p>To design for focus is to respect the user's cognitive load. Every icon, every border, every subtle gradient must justify its existence.</p>
  `,
  minimalism: `
    <p>The removal of non-essential visual noise is not merely an aesthetic choice, but a cognitive necessity. When interface elements compete for attention, the user's focus is fragmented.</p>
    <p>Whitespace is not empty. It is the mechanism by which rhythm emerges and thought is paced.</p>
    <ul>
      <li>Reduce structural noise.</li>
      <li>Refine spacing before adding features.</li>
      <li>Repeat only what reinforces clarity.</li>
    </ul>
  `,
  horizon: `
    <p>Initial thoughts on the new branding project. They want something that feels grounded but forward-looking.</p>
    <ul>
      <li>Reference editorial print systems instead of tech dashboards.</li>
      <li>Keep the palette warm and nearly monochrome.</li>
      <li>Explore a restrained serif for major headlines.</li>
    </ul>
    <p>Need a first-pass moodboard before Monday and a typography route that feels intentional without turning nostalgic.</p>
  `,
  morning: `
    <p>Woke up early. The light hitting the studio desk was perfect. Need to capture that exact tone of warm grey for the interface background.</p>
    <p>Also worth remembering: the best writing setup in the world is still only useful if it gets out of the way.</p>
  `,
  perfection: `
    <blockquote>
      <p>Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.</p>
      <cite>Antoine de Saint-Exupery</cite>
    </blockquote>
  `,
  gorakh: `
    <blockquote>
      <p>मरो हे जोगी मरो, मरण है मीठा। तिस मरणी मरो, जिस मरणी गोरष मरि दीठा॥</p>
      <cite>Gorakhnath</cite>
    </blockquote>
  `,
  typography: `
    <p>Typography should separate voice from system. Let the note title carry a literary cadence while the surrounding controls remain neutral and restrained.</p>
    <p>Newsreader feels right for the long-form note canvas because it introduces softness without sacrificing rigor.</p>
  `,
  reading: `
    <p>Reading list for the month:</p>
    <ul>
      <li>The Poetics of Space</li>
      <li>Silence by Erling Kagge</li>
      <li>In Praise of Shadows</li>
    </ul>
    <p>Cross-reference the strongest passages with the focus-mode prototype.</p>
  `,
  archive: `
    <p>Retired iteration notes from the first grid experiment. The layout was serviceable, but too dense to support a reflective writing posture.</p>
    <p>Keep only the spacing ratios and discard the ornamental card shadows.</p>
  `,
}

const initialFolders: Folder[] = [
  { id: 'work-clients', name: 'Clients', parentId: null, collectionId: 'work' },
  { id: 'work-clients-horizon', name: 'Horizon', parentId: 'work-clients', collectionId: 'work' },
  { id: 'work-clients-horizon-briefs', name: 'Briefs', parentId: 'work-clients-horizon', collectionId: 'work' },
  { id: 'work-strategy', name: 'Strategy', parentId: null, collectionId: 'work' },
  { id: 'work-archive', name: 'Archive', parentId: null, collectionId: 'work' },
  { id: 'personal-journal', name: 'Journal', parentId: null, collectionId: 'personal' },
  { id: 'personal-journal-2026', name: '2026', parentId: 'personal-journal', collectionId: 'personal' },
  { id: 'personal-journal-2026-april', name: 'April', parentId: 'personal-journal-2026', collectionId: 'personal' },
  { id: 'research-essays', name: 'Essays', parentId: null, collectionId: 'research' },
  { id: 'research-essays-silence', name: 'Silence', parentId: 'research-essays', collectionId: 'research' },
  { id: 'research-essays-digital', name: 'Digital Spaces', parentId: 'research-essays', collectionId: 'research' },
  { id: 'research-library', name: 'Library', parentId: null, collectionId: 'research' },
  { id: 'research-library-reading', name: 'Reading Lists', parentId: 'research-library', collectionId: 'research' },
  { id: 'ideas-systems', name: 'Systems', parentId: null, collectionId: 'ideas' },
  { id: 'ideas-systems-type', name: 'Typography', parentId: 'ideas-systems', collectionId: 'ideas' },
  { id: 'ideas-quotes', name: 'Quotes', parentId: null, collectionId: 'ideas' },
  { id: 'ideas-quotes-essential', name: 'Essentialism', parentId: 'ideas-quotes', collectionId: 'ideas' },
]

const initialNotes: Note[] = [
  {
    id: 'aesthetics',
    title: 'The Aesthetics of Silence',
    collectionId: 'research',
    folderId: 'research-essays-silence',
    status: 'Philosophy',
    blocks: createBlocksFromHtml(noteBody.aesthetics),
    sources: [
      {
        id: 'source-aesthetics-pascal',
        sourceType: 'book',
        title: 'Pensees',
        author: 'Blaise Pascal',
        year: '1670',
        publisher: 'Posthumous collection',
        url: '',
        note: 'Useful anchor for the silence and solitude argument.',
      },
    ],
    tags: ['philosophy', 'draft'],
    previewDate: 'Today, 9:41 AM',
    updatedAt: '2026-04-25T09:41:00.000Z',
    isFavorite: true,
    isPinned: true,
    layout: 'feature',
  },
  {
    id: 'minimalism',
    title: 'Subtractive Minimalism in Digital Spaces',
    collectionId: 'research',
    folderId: 'research-essays-digital',
    status: 'Research',
    blocks: createBlocksFromHtml(noteBody.minimalism),
    sources: [
      {
        id: 'source-minimalism-saint-exupery',
        sourceType: 'book',
        title: 'Airman’s Odyssey',
        author: 'Antoine de Saint-Exupery',
        year: '1942',
        publisher: 'Reynal & Hitchcock',
        url: '',
        note: 'Often cited for the subtraction and clarity principle.',
      },
    ],
    tags: ['design-system', 'typography'],
    previewDate: 'Today, 9:41 AM',
    updatedAt: '2026-04-25T09:28:00.000Z',
    isFavorite: true,
    isPinned: false,
    layout: 'feature',
  },
  {
    id: 'horizon',
    title: 'Client Brief: Horizon',
    collectionId: 'work',
    folderId: 'work-clients-horizon-briefs',
    status: 'Draft',
    blocks: createBlocksFromHtml(noteBody.horizon),
    sources: [],
    tags: ['q1-planning', 'drafts'],
    previewDate: 'Yesterday',
    updatedAt: '2026-04-24T16:12:00.000Z',
    isFavorite: false,
    isPinned: true,
    layout: 'standard',
  },
  {
    id: 'morning',
    title: 'Morning Reflections',
    collectionId: 'personal',
    folderId: 'personal-journal-2026-april',
    status: 'Journal',
    blocks: createBlocksFromHtml(noteBody.morning),
    sources: [],
    tags: ['personal', 'drafts'],
    previewDate: 'Oct 24, 2023',
    updatedAt: '2026-04-24T06:45:00.000Z',
    isFavorite: false,
    isPinned: false,
    layout: 'standard',
  },
  {
    id: 'perfection',
    title: 'Perfection is achieved',
    collectionId: 'ideas',
    folderId: 'ideas-quotes-essential',
    status: 'Quote',
    blocks: createBlocksFromHtml(noteBody.perfection),
    sources: [
      {
        id: 'source-perfection-saint-exupery',
        sourceType: 'book',
        title: 'Airman’s Odyssey',
        author: 'Antoine de Saint-Exupery',
        year: '1942',
        publisher: 'Reynal & Hitchcock',
        url: '',
        note: 'Source for the quote card.',
      },
    ],
    tags: ['reading-list'],
    previewDate: 'Oct 20, 2023',
    updatedAt: '2026-04-20T12:00:00.000Z',
    isFavorite: true,
    isPinned: true,
    type: 'quote',
    layout: 'quote',
  },
  {
    id: 'gorakh-quote',
    title: 'मरो हे जोगी मरो',
    collectionId: 'ideas',
    folderId: 'ideas-quotes',
    status: 'Quote',
    blocks: createBlocksFromHtml(noteBody.gorakh),
    sources: [
      {
        id: 'source-gorakh-bani',
        sourceType: 'book',
        title: 'Gorakh Bani',
        author: 'Gorakhnath',
        year: '',
        publisher: 'Traditional Nath literature',
        url: '',
        note: 'Seed quote card with the original verse in Devanagari.',
      },
    ],
    tags: ['gorakhnath', 'sanatan-dharma', 'eastern-philosophy'],
    previewDate: 'May 3, 2026',
    updatedAt: '2026-05-03T16:30:00.000Z',
    isFavorite: true,
    isPinned: false,
    type: 'quote',
    layout: 'quote',
  },
  {
    id: 'typography',
    title: 'Editorial Typography Notes',
    collectionId: 'ideas',
    folderId: 'ideas-systems-type',
    status: 'Ideas',
    blocks: createBlocksFromHtml(noteBody.typography),
    sources: [],
    tags: ['typography', 'design-system'],
    previewDate: 'Apr 18, 2026',
    updatedAt: '2026-04-18T14:05:00.000Z',
    isFavorite: true,
    isPinned: false,
    layout: 'standard',
  },
  {
    id: 'reading',
    title: 'Quiet Reading List',
    collectionId: 'research',
    folderId: 'research-library-reading',
    status: 'Reference',
    blocks: createBlocksFromHtml(noteBody.reading),
    sources: [],
    tags: ['reading-list'],
    previewDate: 'Apr 10, 2026',
    updatedAt: '2026-04-10T08:30:00.000Z',
    isFavorite: false,
    isPinned: false,
    layout: 'standard',
  },
  {
    id: 'archive-grid',
    title: 'Archived Grid Notes',
    collectionId: 'work',
    folderId: 'work-archive',
    status: 'Archive',
    blocks: createBlocksFromHtml(noteBody.archive),
    sources: [],
    tags: ['design-system'],
    previewDate: 'Jan 11, 2026',
    updatedAt: '2026-01-11T11:15:00.000Z',
    isFavorite: false,
    isPinned: false,
    isArchived: true,
    layout: 'standard',
  },
]

export const sampleSeedState: PersistedAppState = {
  activeNoteId: initialNotes[0]?.id ?? null,
  composerHistory: [],
  folders: initialFolders,
  notes: initialNotes,
}

function App() {
  const [view, setView] = useState<ViewMode>('library')
  const [editorContext, setEditorContext] = useState<NavMode>('library')
  const [folders, setFolders] = useState<Folder[]>(loadStoredFolders)
  const [notes, setNotes] = useState<Note[]>(loadStoredNotes)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(loadStoredActiveNoteId)
  const [composerHistory, setComposerHistory] = useState<ComposerHistoryEntry[]>(loadStoredComposerHistory)
  const [activeCollectionId, setActiveCollectionId] = useState<CollectionId | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [dialogState, setDialogState] = useState<AppDialogState | null>(null)
  const [editorActionsOpen, setEditorActionsOpen] = useState(false)
  const [editorSidebarOpen, setEditorSidebarOpen] = useState(true)
  const [navigationSidebarVisible, setNavigationSidebarVisible] = useState(loadStoredNavigationSidebarVisible)
  const [searchQuery, setSearchQuery] = useState('')
  const [saveMessage, setSaveMessage] = useState('Saved just now')
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authGateDismissed, setAuthGateDismissed] = useState(loadAuthGateDismissed)
  const [aiAssistAction, setAiAssistAction] = useState<AiAssistAction>('continue-writing')
  const [aiAssistError, setAiAssistError] = useState<string | null>(null)
  const [aiAssistResult, setAiAssistResult] = useState<AiAssistResult | null>(null)
  const [aiAssisting, setAiAssisting] = useState(false)
  const [aiComposerOpen, setAiComposerOpen] = useState(false)
  const [aiComposerMode, setAiComposerMode] = useState<AiComposerMode>('draft')
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null)
  const [aiDraftCategory, setAiDraftCategory] = useState<AiDraftCategory>('essay')
  const [aiDraftError, setAiDraftError] = useState<string | null>(null)
  const [aiDraftTopic, setAiDraftTopic] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [ambienceMode, setAmbienceMode] = useState<AmbienceMode>(loadStoredAmbienceMode)
  const [zenMode, setZenMode] = useState(false)
  const [noteViewMode, setNoteViewMode] = useState<NoteViewMode>('edit')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [, setBlockFocusRequest] = useState<BlockFocusRequest | null>(null)
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState | null>(null)
  const [linkMenuState, setLinkMenuState] = useState<LinkMenuState | null>(null)
  const [remoteSyncReady, setRemoteSyncReady] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([])
  const [historyState, setHistoryState] = useState({ canRedo: false, canUndo: false })
  const [noteHistoryEntries, setNoteHistoryEntries] = useState<NoteRevision[]>([])
  const [noteHistoryError, setNoteHistoryError] = useState<string | null>(null)
  const [noteHistoryLoading, setNoteHistoryLoading] = useState(false)
  const [noteHistoryOpen, setNoteHistoryOpen] = useState(false)
  const [remoteBrowseSearchResults, setRemoteBrowseSearchResults] = useState<SearchResult[] | null>(null)
  const [remoteQuickSearchResults, setRemoteQuickSearchResults] = useState<SearchResult[] | null>(null)
  const [remoteSyncVersion, setRemoteSyncVersion] = useState(0)
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null)
  const [selectedNoteRevisionId, setSelectedNoteRevisionId] = useState<string | null>(null)
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [quickSwitcherQuery, setQuickSwitcherQuery] = useState('')
  const [quickSwitcherActiveIndex, setQuickSwitcherActiveIndex] = useState(0)
  const [searchFocusSignal, setSearchFocusSignal] = useState(0)
  const [readingProgress, setReadingProgress] = useState(0)
  const [readerExplorationAwake, setReaderExplorationAwake] = useState(false)
  const [readerExplorationPendingAction, setReaderExplorationPendingAction] = useState<ReaderExplorationAction | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const remoteSyncTimerRef = useRef<number | null>(null)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const topbarSearchInputRef = useRef<HTMLInputElement | null>(null)
  const editorScreenRef = useRef<HTMLElement | null>(null)
  const historyInitializedRef = useRef(false)
  const historyRef = useRef<{ future: HistorySnapshot[]; past: HistorySnapshot[] }>({
    future: [],
    past: [],
  })
  const isRestoringHistoryRef = useRef(false)
  const lastHistorySnapshotJsonRef = useRef<string | null>(null)
  const lastHistorySnapshotRef = useRef<HistorySnapshot | null>(null)
  const lastRemoteSnapshotRef = useRef<string | null>(null)
  const pendingRevisionEventRef = useRef<PendingRevisionEvent | null>(null)
  const initialLocalStateRef = useRef<PersistedAppState | null>(null)
  const keyboardShortcutStateRef = useRef<{
    activeNote: Note | null
    aiComposerOpen: boolean
    dialogState: AppDialogState | null
    editorActionsOpen: boolean
    noteHistoryOpen: boolean
    noteViewMode: NoteViewMode
    quickSwitcherOpen: boolean
    view: ViewMode
  }>({
    activeNote: null as Note | null,
    aiComposerOpen: false,
    dialogState: null as AppDialogState | null,
    editorActionsOpen: false,
    noteHistoryOpen: false,
    noteViewMode: 'edit' as NoteViewMode,
    quickSwitcherOpen: false,
    view: 'library' as ViewMode,
  })
  const keyboardShortcutActionsRef = useRef<{
    closeNoteHistory: () => void
    closeQuickSwitcher: () => void
    createNote: () => void
    openQuickSwitcher: () => void
    openSearchView: () => void
    redo: () => void
    switchNoteViewMode: (nextMode: NoteViewMode) => void
    toggleFocusMode: () => void
    undo: () => void
  }>({
    closeNoteHistory: () => undefined,
    closeQuickSwitcher: () => undefined,
    createNote: () => undefined,
    openQuickSwitcher: () => undefined,
    openSearchView: () => undefined,
    redo: () => undefined,
    switchNoteViewMode: () => undefined,
    toggleFocusMode: () => undefined,
    undo: () => undefined,
  })
  const deferredSearch = useDeferredValue(searchQuery.trim().toLowerCase())
  const deferredQuickSwitcherQuery = useDeferredValue(quickSwitcherQuery.trim().toLowerCase())
  const remoteAccountActive = Boolean(currentUser && !currentUser.isLocal)
  const composerLockedMessage =
    'Composer is available after invite sign-in. Local mode keeps manual notes on this device and does not run AI.'

  if (initialLocalStateRef.current == null) {
    initialLocalStateRef.current = {
      activeNoteId,
      composerHistory,
      folders,
      notes,
    }
  }

  const handleRemoteAccessEnded = useCallback((error: unknown) => {
    void clearRemoteBrowserSession()

    if (remoteSyncTimerRef.current && typeof window !== 'undefined') {
      window.clearTimeout(remoteSyncTimerRef.current)
      remoteSyncTimerRef.current = null
    }

    pendingRevisionEventRef.current = null
    lastRemoteSnapshotRef.current = null
    setCurrentUser(createLocalAuthUser())
    setAuthGateDismissed(false)
    clearAuthGateDismissed()
    setAuthNotice(null)
    setAuthError(getRemoteAccessEndedMessage(error))
    setRemoteBrowseSearchResults(null)
    setRemoteQuickSearchResults(null)
    setSaveMessage('Sign in required')
  }, [])

  const foldersById = useMemo(() => buildFolderLookup(folders), [folders])

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? notes[0] ?? null,
    [activeNoteId, notes],
  )

  useEffect(() => {
    setEditorActionsOpen(false)
  }, [activeNoteId, view])

  const activeFolder = activeFolderId ? foldersById[activeFolderId] ?? null : null
  const selectedBlock = useMemo(
    () => activeNote?.blocks.find((block) => block.id === selectedBlockId) ?? null,
    [activeNote, selectedBlockId],
  )
  const selectedBlockText = selectedBlock ? getBlockTextValue(selectedBlock) : ''

  const createHistorySnapshot = useCallback(
    (): HistorySnapshot => ({
      activeCollectionId,
      activeFolderId,
      activeNoteId,
      activeTag,
      editorContext,
      expandedFolderIds,
      folders,
      noteViewMode,
      notes,
      view,
    }),
    [
      activeCollectionId,
      activeFolderId,
      activeNoteId,
      activeTag,
      editorContext,
      expandedFolderIds,
      folders,
      noteViewMode,
      notes,
      view,
    ],
  )

  const updateHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: historyRef.current.past.length > 0,
      canRedo: historyRef.current.future.length > 0,
    })
  }, [])

  useEffect(() => {
    setSelectedBlockId(activeNote?.blocks[0]?.id ?? null)
    setSlashMenuState(null)
    setLinkMenuState(null)
  }, [activeNoteId, activeNote])

  useEffect(() => {
    setAiAssistResult(null)
    setAiAssistError(null)
  }, [activeNoteId])

  useEffect(() => {
    if (slashMenuState && slashMenuState.blockId !== selectedBlockId) {
      setSlashMenuState(null)
    }
  }, [selectedBlockId, slashMenuState])

  useEffect(() => {
    if (linkMenuState && linkMenuState.blockId !== selectedBlockId) {
      setLinkMenuState(null)
    }
  }, [linkMenuState, selectedBlockId])

  useEffect(() => {
    if (slashMenuState && !(activeNote?.blocks ?? []).some((block) => block.id === slashMenuState.blockId)) {
      setSlashMenuState(null)
    }
  }, [activeNote, slashMenuState])

  useEffect(() => {
    if (linkMenuState && !(activeNote?.blocks ?? []).some((block) => block.id === linkMenuState.blockId)) {
      setLinkMenuState(null)
    }
  }, [activeNote, linkMenuState])

  useEffect(() => {
    if (zenMode) {
      setAiComposerOpen(false)
    }
  }, [zenMode])

  useEffect(() => {
    if (!remoteAccountActive) {
      setAiComposerOpen(false)
      setReaderExplorationPendingAction(null)
    }
  }, [remoteAccountActive])

  useEffect(() => {
    setReadingProgress(0)
    setReaderExplorationAwake(false)

    if (editorScreenRef.current) {
      editorScreenRef.current.scrollTop = 0
    }

    const frameId = window.requestAnimationFrame(() => {
      const editorScreen = editorScreenRef.current

      if (!editorScreen) {
        return
      }

      const maxScrollTop = editorScreen.scrollHeight - editorScreen.clientHeight
      setReadingProgress(maxScrollTop <= 0 ? 1 : 0)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [activeNoteId, noteViewMode, zenMode])

  useEffect(() => {
    if (!quickSwitcherOpen) {
      setQuickSwitcherQuery('')
      setQuickSwitcherActiveIndex(0)
      return
    }

    setQuickSwitcherActiveIndex(0)
  }, [quickSwitcherOpen, quickSwitcherQuery])

  useEffect(() => {
    let isCancelled = false

    const hydrateRemoteState = async () => {
      try {
        const remoteSnapshot = await fetchRemoteAppState()

        if (isCancelled) {
          return
        }

        const remoteUser = remoteSnapshot.user ?? createLocalAuthUser()
        setCurrentUser(remoteUser)

        if (remoteUser.isLocal) {
          lastRemoteSnapshotRef.current = null
          setRemoteBrowseSearchResults(null)
          setRemoteQuickSearchResults(null)
          return
        }

        let resolvedState = remoteSnapshot.state

        if (!resolvedState) {
          const localState = initialLocalStateRef.current ?? createEmptyPersistedState()

          if (hasWorkspaceData(localState)) {
            await persistRemoteAppState(localState)
            resolvedState = localState
          } else {
            resolvedState = createEmptyPersistedState()
          }
        }

        lastRemoteSnapshotRef.current = JSON.stringify(resolvedState)
        setComposerHistory(resolvedState.composerHistory)
        setFolders(resolvedState.folders)
        setNotes(resolvedState.notes)
        setActiveNoteId(resolvedState.activeNoteId)
        setRemoteSyncVersion((currentValue) => currentValue + 1)
      } catch (error) {
        if (isRemoteAccessError(error)) {
          console.warn('Remote account access ended.', error)
          if (!isCancelled) {
            handleRemoteAccessEnded(error)
          }
          return
        }

        console.warn('PostgreSQL sync unavailable, continuing with local storage.', error)
        if (!isCancelled) {
          setCurrentUser(createLocalAuthUser())
        }
      } finally {
        if (!isCancelled) {
          setRemoteSyncReady(true)
        }
      }
    }

    void hydrateRemoteState()

    return () => {
      isCancelled = true
    }
  }, [handleRemoteAccessEnded])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        activeNoteId,
        composerHistory,
        folders,
        notes,
      }),
    )
  }, [activeNoteId, composerHistory, folders, notes])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(ambienceStorageKey, ambienceMode)
    document.documentElement.dataset.essenceAmbience = ambienceMode
  }, [ambienceMode])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      navigationSidebarStorageKey,
      navigationSidebarVisible ? 'visible' : 'hidden',
    )
  }, [navigationSidebarVisible])

  useEffect(() => {
    if (!remoteSyncReady) {
      return
    }

    const nextSnapshot = createHistorySnapshot()
    const nextSnapshotJson = JSON.stringify(nextSnapshot)

    if (!historyInitializedRef.current) {
      historyInitializedRef.current = true
      lastHistorySnapshotRef.current = cloneHistorySnapshot(nextSnapshot)
      lastHistorySnapshotJsonRef.current = nextSnapshotJson
      updateHistoryState()
      return
    }

    if (isRestoringHistoryRef.current) {
      isRestoringHistoryRef.current = false
      lastHistorySnapshotRef.current = cloneHistorySnapshot(nextSnapshot)
      lastHistorySnapshotJsonRef.current = nextSnapshotJson
      updateHistoryState()
      return
    }

    if (lastHistorySnapshotJsonRef.current === nextSnapshotJson) {
      return
    }

    if (lastHistorySnapshotRef.current) {
      historyRef.current.past = [
        ...historyRef.current.past.slice(-(historyLimit - 1)),
        cloneHistorySnapshot(lastHistorySnapshotRef.current),
      ]
    }

    historyRef.current.future = []
    lastHistorySnapshotRef.current = cloneHistorySnapshot(nextSnapshot)
    lastHistorySnapshotJsonRef.current = nextSnapshotJson
    updateHistoryState()
  }, [
    createHistorySnapshot,
    remoteSyncReady,
    updateHistoryState,
  ])

  useEffect(() => {
    if (typeof window === 'undefined' || !remoteSyncReady || !remoteAccountActive) {
      return
    }

    const nextState: PersistedAppState = {
      activeNoteId,
      composerHistory,
      folders,
      notes,
    }
    const nextSnapshot = JSON.stringify(nextState)

    if (lastRemoteSnapshotRef.current === nextSnapshot) {
      return
    }

    if (remoteSyncTimerRef.current) {
      window.clearTimeout(remoteSyncTimerRef.current)
    }

    const pendingRevisionEvent = pendingRevisionEventRef.current

    remoteSyncTimerRef.current = window.setTimeout(() => {
      void persistRemoteAppState(nextState, pendingRevisionEvent ? [pendingRevisionEvent] : [])
        .then(() => {
          lastRemoteSnapshotRef.current = nextSnapshot
          setRemoteSyncVersion((currentValue) => currentValue + 1)

          if (
            pendingRevisionEvent &&
            pendingRevisionEventRef.current?.noteId === pendingRevisionEvent.noteId &&
            pendingRevisionEventRef.current?.revisionKind === pendingRevisionEvent.revisionKind
          ) {
            pendingRevisionEventRef.current = null
          }
        })
        .catch((error) => {
          if (isRemoteAccessError(error)) {
            handleRemoteAccessEnded(error)
            return
          }

          setSaveMessage('Saved locally')
        })
    }, 700)

    return () => {
      if (remoteSyncTimerRef.current) {
        window.clearTimeout(remoteSyncTimerRef.current)
      }
    }
  }, [activeNoteId, composerHistory, folders, handleRemoteAccessEnded, notes, remoteAccountActive, remoteSyncReady])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }

      if (remoteSyncTimerRef.current) {
        window.clearTimeout(remoteSyncTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!remoteSyncReady || !remoteAccountActive || !deferredSearch) {
      setRemoteBrowseSearchResults(null)
      return
    }

    let isCancelled = false
    setRemoteBrowseSearchResults(null)

    void fetchRemoteSearchResults(deferredSearch, 48)
      .then((results) => {
        if (!isCancelled) {
          setRemoteBrowseSearchResults(results)
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          if (isRemoteAccessError(error)) {
            handleRemoteAccessEnded(error)
            return
          }

          setRemoteBrowseSearchResults(null)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [deferredSearch, handleRemoteAccessEnded, remoteAccountActive, remoteSyncReady, remoteSyncVersion])

  useEffect(() => {
    if (!remoteSyncReady || !remoteAccountActive || !deferredQuickSwitcherQuery) {
      setRemoteQuickSearchResults(null)
      return
    }

    let isCancelled = false
    setRemoteQuickSearchResults(null)

    void fetchRemoteSearchResults(deferredQuickSwitcherQuery, 20)
      .then((results) => {
        if (!isCancelled) {
          setRemoteQuickSearchResults(results)
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          if (isRemoteAccessError(error)) {
            handleRemoteAccessEnded(error)
            return
          }

          setRemoteQuickSearchResults(null)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [deferredQuickSwitcherQuery, handleRemoteAccessEnded, remoteAccountActive, remoteSyncReady, remoteSyncVersion])

  const availableTags = useMemo(() => {
    return Array.from(new Set([...tagPool, ...notes.flatMap((note) => note.tags)])).sort((left, right) =>
      left.localeCompare(right),
    )
  }, [notes])

  const collectionCounts = useMemo(() => {
    return collections.reduce<Record<CollectionId, number>>((accumulator, collection) => {
      accumulator[collection.id] = notes.filter(
        (note) => note.collectionId === collection.id && !note.isArchived,
      ).length
      return accumulator
    }, {} as Record<CollectionId, number>)
  }, [notes])

  const tagSummaries = useMemo(() => {
    const counts = new Map<string, number>()

    notes
      .filter((note) => !note.isArchived)
      .forEach((note) => {
        note.tags.forEach((tag) => {
          counts.set(tag, (counts.get(tag) ?? 0) + 1)
        })
      })

    return availableTags
      .filter((tag) => counts.has(tag))
      .map((tag) => ({
        name: tag,
        count: counts.get(tag) ?? 0,
      }))
  }, [availableTags, notes])

  const browseContext: NavMode = view === 'editor' ? editorContext : view
  const remoteBrowseSearchNoteIds = useMemo(
    () => remoteBrowseSearchResults?.map((result) => result.noteId) ?? [],
    [remoteBrowseSearchResults],
  )
  const remoteQuickSearchNoteIds = useMemo(
    () => remoteQuickSearchResults?.map((result) => result.noteId) ?? [],
    [remoteQuickSearchResults],
  )

  const filteredNotes = useMemo(() => {
    const scopedNotes = notes.filter((note) =>
      noteMatchesBrowseScope(note, browseContext, {
        collectionId: activeCollectionId,
        folderId: activeFolderId,
        foldersById,
        tag: activeTag,
      }),
    )

    return orderNotesBySearch(scopedNotes, remoteBrowseSearchNoteIds, deferredSearch, foldersById)
  }, [activeCollectionId, activeFolderId, activeTag, browseContext, deferredSearch, foldersById, notes, remoteBrowseSearchNoteIds])

  const editorSidebarNotes = useMemo(() => {
    const scopedNotes = notes.filter((note) =>
      noteMatchesBrowseScope(note, editorContext, {
        collectionId: activeCollectionId,
        folderId: activeFolderId,
        foldersById,
        tag: activeTag,
      }),
    )
    const searchedNotes = orderNotesBySearch(scopedNotes, remoteBrowseSearchNoteIds, deferredSearch, foldersById)

    if (searchedNotes.some((note) => note.id === activeNoteId)) {
      return searchedNotes
    }

    return activeNote ? [activeNote, ...searchedNotes] : searchedNotes
  }, [
    activeCollectionId,
    activeFolderId,
    activeNote,
    activeNoteId,
    activeTag,
    deferredSearch,
    editorContext,
    foldersById,
    notes,
    remoteBrowseSearchNoteIds,
  ])

  const editorPaneTitle = activeFolderId
    ? getFolderPathLabel(activeFolderId, foldersById)
    : activeCollectionId
      ? collectionNameById[activeCollectionId]
      : activeTag
        ? `#${activeTag}`
        : browseViewMeta[editorContext].heading

  const editorPaneCaption = activeFolderId
    ? `${formatCount(editorSidebarNotes.length, 'note')} in this branch`
    : activeCollectionId
      ? `${formatCount(editorSidebarNotes.length, 'note')} in this collection`
      : activeTag
        ? `${formatCount(editorSidebarNotes.length, 'note')} with this tag`
        : browseViewMeta[editorContext].description

  const activeCollectionOptions = useMemo(
    () => collections.map((collection) => ({ value: collection.id, label: collection.name })),
    [],
  )
  const notesById = useMemo(
    () =>
      notes.reduce<Record<string, Note>>((lookup, note) => {
        lookup[note.id] = note
        return lookup
      }, {}),
    [notes],
  )
  const notesByNormalizedTitle = useMemo(() => buildNoteTitleLookup(notes), [notes])

  const activeFolderOptions = useMemo(() => {
    if (!activeNote) {
      return []
    }

    const foldersInCollection = folders
      .filter((folder) => folder.collectionId === activeNote.collectionId)
      .sort((left, right) =>
        getFolderPathLabel(left.id, foldersById).localeCompare(getFolderPathLabel(right.id, foldersById)),
      )

    return foldersInCollection.map((folder) => ({
      value: folder.id,
      label: getFolderPathLabel(folder.id, foldersById),
    }))
  }, [activeNote, folders, foldersById])

  const activeWordCount = activeNote ? countWordsFromBlocks(activeNote.blocks) : 0
  const activeLinkedNotes = useMemo(
    () => (activeNote ? getResolvedLinkedNotes(activeNote, notesByNormalizedTitle, notesById) : []),
    [activeNote, notesById, notesByNormalizedTitle],
  )
  const activeBacklinks = useMemo(
    () =>
      activeNote
        ? notes.filter((note) =>
            note.id !== activeNote.id && getResolvedLinkedNoteIds(note, notesByNormalizedTitle).includes(activeNote.id),
          )
        : [],
    [activeNote, notes, notesByNormalizedTitle],
  )
  const selectedNoteRevision = useMemo(
    () => noteHistoryEntries.find((entry) => entry.id === selectedNoteRevisionId) ?? noteHistoryEntries[0] ?? null,
    [noteHistoryEntries, selectedNoteRevisionId],
  )
  const noteHistoryActiveNoteId = activeNote?.id ?? null
  const quickSwitcherNotes = useMemo(
    () =>
      deferredQuickSwitcherQuery
        ? orderNotesBySearch(notes, remoteQuickSearchNoteIds, deferredQuickSwitcherQuery, foldersById)
        : sortNotesForDailyUse(notes),
    [deferredQuickSwitcherQuery, foldersById, notes, remoteQuickSearchNoteIds],
  )

  useEffect(() => {
    if (view === 'editor' && activeNote) {
      return
    }

    setNoteHistoryOpen(false)
    setNoteHistoryEntries([])
    setNoteHistoryError(null)
    setNoteHistoryLoading(false)
    setRestoringRevisionId(null)
    setSelectedNoteRevisionId(null)
  }, [activeNote, view])

  useEffect(() => {
    if (!noteHistoryOpen || view !== 'editor' || !noteHistoryActiveNoteId) {
      return
    }

    if (!remoteAccountActive) {
      setNoteHistoryEntries([])
      setSelectedNoteRevisionId(null)
      setNoteHistoryError('Version history is available after signing in.')
      setNoteHistoryLoading(false)
      return
    }

    let isCancelled = false

    setNoteHistoryLoading(true)
    setNoteHistoryError(null)

    void fetchRemoteNoteRevisions(noteHistoryActiveNoteId, 24)
      .then((revisions) => {
        if (isCancelled) {
          return
        }

        setNoteHistoryEntries(revisions)
        setSelectedNoteRevisionId((currentId) =>
          currentId && revisions.some((revision) => revision.id === currentId) ? currentId : revisions[0]?.id ?? null,
        )
      })
      .catch((error) => {
        if (isCancelled) {
          return
        }

        if (isRemoteAccessError(error)) {
          handleRemoteAccessEnded(error)
          return
        }

        setNoteHistoryEntries([])
        setSelectedNoteRevisionId(null)
        setNoteHistoryError(error instanceof Error ? error.message : 'Unable to load note history.')
      })
      .finally(() => {
        if (!isCancelled) {
          setNoteHistoryLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [handleRemoteAccessEnded, noteHistoryActiveNoteId, noteHistoryOpen, remoteAccountActive, remoteSyncVersion, view])

  const quickSwitcherItems = useMemo(() => {
    const baseItems: QuickSwitcherItem[] = [
      {
        id: 'action-create-note',
        kind: 'action',
        title: 'Create new note',
        subtitle: 'Start a fresh draft anywhere in the workspace.',
        keywords: 'new note write draft create',
        target: { type: 'create-note' },
      },
      {
        id: 'action-library',
        kind: 'action',
        title: 'Go to Library',
        subtitle: 'Browse recent thoughts and long-form notes.',
        keywords: 'library home browse notes',
        target: { type: 'navigate', view: 'library' },
      },
      {
        id: 'action-collections',
        kind: 'action',
        title: 'Go to Collections',
        subtitle: 'Open collections, folders, and research branches.',
        keywords: 'collections folders browse structure',
        target: { type: 'navigate', view: 'collections' },
      },
      ...quickSwitcherNotes.map((note) => ({
        id: `note-${note.id}`,
        kind: 'note' as const,
        title: note.title,
        subtitle: `${note.status} · ${getFolderPathLabel(note.folderId, foldersById) || collectionNameById[note.collectionId]}`,
        keywords: `${note.title} ${note.status} ${note.tags.join(' ')} ${getPlainTextFromBlocks(note.blocks)} ${getPlainTextFromSources(note.sources)}`.toLowerCase(),
        target: { type: 'note', noteId: note.id } as QuickSwitcherTarget,
      })),
      ...collections.map((collection) => ({
        id: `collection-${collection.id}`,
        kind: 'collection' as const,
        title: collection.name,
        subtitle: collection.description,
        keywords: `${collection.name} ${collection.description}`.toLowerCase(),
        target: { type: 'collection', collectionId: collection.id } as QuickSwitcherTarget,
      })),
      ...folders
        .slice()
        .sort((left, right) =>
          getFolderPathLabel(left.id, foldersById).localeCompare(getFolderPathLabel(right.id, foldersById)),
        )
        .map((folder) => ({
          id: `folder-${folder.id}`,
          kind: 'folder' as const,
          title: folder.name,
          subtitle: `${collectionNameById[folder.collectionId]} · ${getFolderPathLabel(folder.id, foldersById)}`,
          keywords: `${folder.name} ${getFolderPathLabel(folder.id, foldersById)} ${folder.collectionId}`.toLowerCase(),
          target: { type: 'folder', folderId: folder.id } as QuickSwitcherTarget,
        })),
      ...tagSummaries.map((tag) => ({
        id: `tag-${tag.name}`,
        kind: 'tag' as const,
        title: `#${tag.name}`,
        subtitle: `${formatCount(tag.count, 'note')} with this tag`,
        keywords: `${tag.name} tag ${tag.count}`.toLowerCase(),
        target: { type: 'tag', tagName: tag.name } as QuickSwitcherTarget,
      })),
    ]

    if (!quickSwitcherQuery.trim()) {
      return [
        ...baseItems.filter((item) => item.kind === 'action').slice(0, 4),
        ...baseItems.filter((item) => item.kind === 'note').slice(0, 6),
        ...baseItems.filter((item) => item.kind === 'folder').slice(0, 3),
        ...baseItems.filter((item) => item.kind === 'tag').slice(0, 3),
      ]
    }

    const query = quickSwitcherQuery.trim().toLowerCase()

    return baseItems
      .filter((item) => {
        const haystack = `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, 14)
  }, [folders, foldersById, quickSwitcherNotes, quickSwitcherQuery, tagSummaries])

  const markSaving = () => {
    setSaveMessage('Saving...')

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      setSaveMessage('Saved just now')
    }, 500)
  }

  const flashSaveFeedback = (message: string) => {
    setSaveMessage(message)

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      setSaveMessage('Saved just now')
    }, 1800)
  }

  const showComposerLockedDialog = () => {
    setDialogState({
      type: 'alert',
      title: 'Composer needs invite access',
      message: composerLockedMessage,
      confirmLabel: 'Got it',
    })
  }

  const toggleComposerPanel = () => {
    if (!remoteAccountActive) {
      showComposerLockedDialog()
      return
    }

    setAiComposerOpen((isOpen) => !isOpen)
    setQuickSwitcherOpen(false)
  }

  const resetHistoryTracking = () => {
    historyRef.current = { future: [], past: [] }
    historyInitializedRef.current = false
    isRestoringHistoryRef.current = false
    lastHistorySnapshotJsonRef.current = null
    lastHistorySnapshotRef.current = null
    updateHistoryState()
  }

  const applyWorkspaceState = (nextState: PersistedAppState, message: string) => {
    const normalizedState = normalizePersistedAppState(nextState)

    setAiComposerOpen(false)

    startTransition(() => {
      setFolders(normalizedState.folders)
      setNotes(normalizedState.notes)
      setActiveNoteId(normalizedState.activeNoteId)
      setComposerHistory(normalizedState.composerHistory)
      setActiveCollectionId(null)
      setActiveFolderId(null)
      setActiveTag(null)
      setEditorContext('library')
      setView('library')
      setNoteViewMode('edit')
      setNoteHistoryOpen(false)
      setNoteHistoryEntries([])
      setNoteHistoryError(null)
      setSelectedNoteRevisionId(null)
      setSearchQuery('')
    })

    pendingRevisionEventRef.current = null
    lastRemoteSnapshotRef.current = JSON.stringify(normalizedState)
    resetHistoryTracking()
    setRemoteBrowseSearchResults(null)
    setRemoteQuickSearchResults(null)
    setRemoteSyncVersion((currentValue) => currentValue + 1)
    flashSaveFeedback(message)
  }

  const getCurrentPersistedState = (): PersistedAppState => ({
    activeNoteId,
    composerHistory,
    folders,
    notes,
  })

  const handleSignIn = async () => {
    if (!authEmail.trim()) {
      setAuthError('Enter an email to continue.')
      return
    }

    setAuthError(null)
    setAuthNotice(null)
    setAuthBusy(true)

    try {
      const result = await signInRemote(authEmail, getCurrentPersistedState())

      if (result.kind === 'magic-link') {
        setAuthNotice(`Check ${result.email} for the Essence sign-in link, then return here.`)
        flashSaveFeedback('Sign-in link sent')
        return
      }

      const { snapshot } = result
      setCurrentUser(snapshot.user)
      setAuthEmail('')
      setAuthGateDismissed(false)
      clearAuthGateDismissed()
      applyWorkspaceState(snapshot.state ?? createEmptyPersistedState(), 'Account synced')
    } catch (error) {
      if (isRemoteAccessError(error)) {
        handleRemoteAccessEnded(error)
      }

      console.warn('Unable to sign in.', error)
      setAuthError(
        error instanceof Error && error.message
          ? error.message
          : 'We could not open that workspace. Check the email and try again.',
      )
      flashSaveFeedback('Sign in failed')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignOut = async () => {
    setAuthBusy(true)

    try {
      await signOutRemote()
      setCurrentUser(createLocalAuthUser())
      setAuthEmail('')
      setAuthNotice(null)
      setAuthGateDismissed(false)
      clearAuthGateDismissed()
      applyWorkspaceState(createEmptyPersistedState(), 'Signed out')
    } catch (error) {
      console.warn('Unable to sign out.', error)
      flashSaveFeedback('Sign out failed')
    } finally {
      setAuthBusy(false)
    }
  }

  const continueLocally = () => {
    setAuthError(null)
    setAuthNotice(null)
    setAuthGateDismissed(true)
    persistAuthGateDismissed()
  }

  const openAuthScreen = () => {
    setAuthError(null)
    setAuthNotice(null)
    setAiComposerOpen(false)
    setAuthGateDismissed(false)
    clearAuthGateDismissed()
  }

  const closeQuickSwitcher = () => {
    setQuickSwitcherOpen(false)
  }

  const openQuickSwitcher = () => {
    setAiComposerOpen(false)
    setEditorActionsOpen(false)
    setQuickSwitcherOpen(true)
    setQuickSwitcherQuery('')
    setQuickSwitcherActiveIndex(0)
    setNoteHistoryOpen(false)
    setSlashMenuState(null)
    setLinkMenuState(null)
  }

  const closeNoteHistory = () => {
    setNoteHistoryOpen(false)
  }

  const closeDialog = () => {
    setDialogState(null)
  }

  const moveToLibrarySearchSurface = () => {
    setActiveCollectionId(null)
    setActiveFolderId(null)
    setActiveTag(null)
    startTransition(() => setView('library'))
  }

  const toggleNoteHistory = () => {
    if (!activeNote || view !== 'editor') {
      return
    }

    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    setEditorActionsOpen(false)
    setSlashMenuState(null)
    setLinkMenuState(null)
    setNoteHistoryOpen((currentValue) => !currentValue)
  }

  const openSearchView = () => {
    setZenMode(false)
    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    setEditorActionsOpen(false)
    moveToLibrarySearchSurface()
    setSearchFocusSignal((currentValue) => currentValue + 1)
  }

  const updateGlobalSearchQuery = (value: string) => {
    setSearchQuery(value)

    if (view === 'collections') {
      moveToLibrarySearchSurface()
    }
  }

  const applyHistorySnapshot = (snapshot: HistorySnapshot, message: string) => {
    const restoredSnapshot = cloneHistorySnapshot(snapshot)

    isRestoringHistoryRef.current = true
    setView(restoredSnapshot.view)
    setEditorContext(restoredSnapshot.editorContext)
    setFolders(restoredSnapshot.folders)
    setNotes(restoredSnapshot.notes)
    setActiveNoteId(restoredSnapshot.activeNoteId)
    setActiveCollectionId(restoredSnapshot.activeCollectionId)
    setActiveFolderId(restoredSnapshot.activeFolderId)
    setActiveTag(restoredSnapshot.activeTag)
    setExpandedFolderIds(restoredSnapshot.expandedFolderIds)
    setNoteViewMode(restoredSnapshot.noteViewMode)
    setSelectedBlockId(null)
    setBlockFocusRequest(null)
    setSlashMenuState(null)
    setLinkMenuState(null)
    setSearchQuery('')
    setZenMode(false)
    flashSaveFeedback(message)
  }

  const undo = () => {
    const previousSnapshot = historyRef.current.past[historyRef.current.past.length - 1]

    if (!previousSnapshot) {
      return
    }

    historyRef.current.past = historyRef.current.past.slice(0, -1)
    historyRef.current.future = [
      ...historyRef.current.future.slice(-(historyLimit - 1)),
      cloneHistorySnapshot(createHistorySnapshot()),
    ]
    updateHistoryState()
    applyHistorySnapshot(previousSnapshot, 'Undid last change')
  }

  const redo = () => {
    const nextSnapshot = historyRef.current.future[historyRef.current.future.length - 1]

    if (!nextSnapshot) {
      return
    }

    historyRef.current.future = historyRef.current.future.slice(0, -1)
    historyRef.current.past = [
      ...historyRef.current.past.slice(-(historyLimit - 1)),
      cloneHistorySnapshot(createHistorySnapshot()),
    ]
    updateHistoryState()
    applyHistorySnapshot(nextSnapshot, 'Reapplied change')
  }

  const restoreNoteRevision = (revision: NoteRevision) => {
    if (!activeNote) {
      return
    }

    const restoredNote = normalizeStoredNote({
      ...revision.snapshot,
      id: activeNote.id,
    })

    pendingRevisionEventRef.current = {
      noteId: activeNote.id,
      revisionKind: 'restored',
    }

    setRestoringRevisionId(revision.id)
    setActiveCollectionId(restoredNote.collectionId)
    setActiveFolderId(restoredNote.folderId)
    setActiveTag(null)
    setSelectedBlockId(restoredNote.blocks[0]?.id ?? null)
    setBlockFocusRequest(null)
    setSlashMenuState(null)
    setLinkMenuState(null)
    setZenMode(false)
    setNoteViewMode(getDefaultNoteViewMode(restoredNote))
    patchNote(activeNote.id, () => restoredNote)
    setNoteHistoryOpen(false)
    flashSaveFeedback(`Restored version from ${formatRevisionTimestamp(revision.createdAt)}`)

    window.setTimeout(() => {
      setRestoringRevisionId((currentValue) => (currentValue === revision.id ? null : currentValue))
    }, 900)
  }

  const patchNote = (noteId: string | null, updater: (note: Note) => Note, markAsEdited = true) => {
    if (!noteId) {
      return
    }

    const nextUpdatedAt = new Date().toISOString()

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === noteId
          ? {
              ...updater(note),
              previewDate: markAsEdited ? 'Just now' : note.previewDate,
              updatedAt: markAsEdited ? nextUpdatedAt : note.updatedAt,
            }
          : note,
      ),
    )

    if (markAsEdited) {
      markSaving()
    }
  }

  const focusCollectionFilter = (collectionId: CollectionId, preserveEditor = false) => {
    setActiveCollectionId(collectionId)
    setActiveFolderId(null)
    setActiveTag(null)

    if (preserveEditor) {
      setEditorContext('library')
      return
    }

    startTransition(() => setView('library'))
  }

  const focusFolderFilter = (folderId: string, preserveEditor = false) => {
    const folder = foldersById[folderId]

    if (!folder) {
      return
    }

    setActiveCollectionId(folder.collectionId)
    setActiveFolderId(folderId)
    setActiveTag(null)

    if (preserveEditor) {
      setEditorContext('library')
      return
    }

    startTransition(() => setView('library'))
  }

  const renameFolder = (folderId: string, nextName: string) => {
    const trimmedName = nextName.trim()

    setFolders((currentFolders) =>
      currentFolders.map((folder) =>
        folder.id === folderId
          ? {
              ...folder,
              name: trimmedName || 'Untitled Folder',
            }
          : folder,
      ),
    )

    markSaving()
  }

  const requestRenameFolder = (folderId: string) => {
    const folder = foldersById[folderId]

    if (!folder) {
      return
    }

    setDialogState({
      type: 'prompt',
      title: 'Rename Folder',
      message: 'Give this branch a clearer name. Notes and nested folders will stay exactly where they are.',
      label: 'Folder name',
      initialValue: folder.name,
      placeholder: 'Folder name',
      confirmLabel: 'Save name',
      onConfirm: (nextName) => renameFolder(folder.id, nextName),
    })
  }

  const moveFolder = (
    folderId: string,
    nextCollectionId: CollectionId,
    requestedParentId: string | null,
  ) => {
    const folder = foldersById[folderId]

    if (!folder) {
      return
    }

    const descendantIds = new Set(getDescendantFolderIds(folderId, folders))
    let nextParentId = requestedParentId

    if (nextParentId === folderId || (nextParentId && descendantIds.has(nextParentId))) {
      nextParentId = null
    }

    if (nextParentId && foldersById[nextParentId]?.collectionId !== nextCollectionId) {
      nextParentId = null
    }

    const subtreeIds = new Set([folderId, ...descendantIds])

    setFolders((currentFolders) =>
      currentFolders.map((currentFolder) => {
        if (currentFolder.id === folderId) {
          return {
            ...currentFolder,
            collectionId: nextCollectionId,
            parentId: nextParentId,
          }
        }

        if (subtreeIds.has(currentFolder.id)) {
          return {
            ...currentFolder,
            collectionId: nextCollectionId,
          }
        }

        return currentFolder
      }),
    )

    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.folderId && subtreeIds.has(note.folderId)
          ? {
              ...note,
              collectionId: nextCollectionId,
            }
          : note,
      ),
    )

    if (activeFolderId && subtreeIds.has(activeFolderId)) {
      setActiveCollectionId(nextCollectionId)
    }

    setExpandedFolderIds((currentIds) =>
      Array.from(new Set([...currentIds, ...(nextParentId ? [nextParentId] : [])])),
    )

    markSaving()
  }

  const deleteFolder = (folderId: string) => {
    const folder = foldersById[folderId]

    if (!folder) {
      return
    }

    const parentId = folder.parentId
    const branchNoteCount = notes.filter((note) => isNoteInFolderBranch(note.folderId, folderId, foldersById)).length

    setDialogState({
      type: 'confirm',
      tone: 'danger',
      title: `Delete "${folder.name}"?`,
      message: `${formatCount(branchNoteCount, 'note')} will move to ${parentId ? 'the parent folder' : 'the collection root'}. Nested folders will be preserved.`,
      confirmLabel: 'Delete folder',
      onConfirm: () => {
        setFolders((currentFolders) =>
          currentFolders
            .filter((currentFolder) => currentFolder.id !== folderId)
            .map((currentFolder) =>
              currentFolder.parentId === folderId
                ? {
                    ...currentFolder,
                    parentId,
                  }
                : currentFolder,
            ),
        )

        setNotes((currentNotes) =>
          currentNotes.map((note) =>
            note.folderId === folderId
              ? {
                  ...note,
                  folderId: parentId,
                }
              : note,
          ),
        )

        setExpandedFolderIds((currentIds) => currentIds.filter((id) => id !== folderId))

        if (activeFolderId === folderId) {
          setActiveFolderId(parentId)
          setActiveCollectionId(parentId ? foldersById[parentId]?.collectionId ?? folder.collectionId : folder.collectionId)
        }

        markSaving()
      },
    })
  }

  const deleteNote = (noteId: string) => {
    const note = notes.find((candidate) => candidate.id === noteId)

    if (!note) {
      return
    }

    setDialogState({
      type: 'confirm',
      tone: 'danger',
      title: 'Delete this note?',
      message: `"${note.title || 'Untitled Note'}" will be removed from this workspace after the next sync.`,
      confirmLabel: 'Delete note',
      onConfirm: () => {
        const remainingNotes = notes.filter((candidate) => candidate.id !== noteId)
        const nextActiveNote = remainingNotes.find((candidate) => !candidate.isArchived) ?? remainingNotes[0] ?? null

        setNotes(remainingNotes)

        if (activeNoteId === noteId) {
          setActiveNoteId(nextActiveNote?.id ?? null)
          setSelectedBlockId(null)
          setBlockFocusRequest(null)
          setSlashMenuState(null)
          setLinkMenuState(null)
          setNoteHistoryOpen(false)
          setNoteHistoryEntries([])
          setSelectedNoteRevisionId(null)

          if (nextActiveNote) {
            setNoteViewMode(getDefaultNoteViewMode(nextActiveNote))
          } else if (view === 'editor') {
            startTransition(() => setView(editorContext))
          }
        }

        markSaving()
      },
    })
  }

  const openNote = (noteId: string) => {
    const note = notes.find((candidate) => candidate.id === noteId)

    if (!note) {
      return
    }

    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)

    if (view !== 'editor') {
      setEditorContext(view === 'collections' ? 'library' : view)
    }

    setActiveNoteId(noteId)
    setNoteHistoryOpen(false)
    setNoteViewMode(view === 'editor' ? noteViewMode : getDefaultNoteViewMode(note))
    setZenMode(false)
    setSaveMessage('Saved just now')
    startTransition(() => setView('editor'))
  }

  const createNote = () => {
    const currentFolder = activeFolderId ? foldersById[activeFolderId] : null
    const collectionId = currentFolder?.collectionId ?? activeCollectionId ?? activeNote?.collectionId ?? 'ideas'
    const blocks = [createEmptyBlock('paragraph')]
    const newNote: Note = {
      id: generateId('note'),
      title: 'Untitled Note',
      collectionId,
      folderId: currentFolder?.id ?? null,
      status: 'Draft',
      blocks,
      editorDoc: noteBlocksToTiptapContent(blocks),
      sources: [],
      tags: [],
      previewDate: 'Just now',
      updatedAt: new Date().toISOString(),
      isFavorite: false,
      isPinned: false,
      layout: 'standard',
    }

    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    setEditorContext(view === 'editor' ? editorContext : view === 'collections' ? 'library' : view)
    setNotes((currentNotes) => [newNote, ...currentNotes])
    setActiveNoteId(newNote.id)
    setNoteHistoryOpen(false)
    setNoteViewMode('edit')
    queueBlockFocus(newNote.blocks[0].id, 'start')
    setZenMode(false)
    setSaveMessage('Saved just now')
    startTransition(() => setView('editor'))
  }

  const generateAiDraft = async () => {
    const topic = aiDraftTopic.trim()

    if (topic.length < 3) {
      setAiDraftError('Give Composer a topic with at least 3 characters.')
      return
    }

    if (!remoteAccountActive) {
      setAiDraftError(composerLockedMessage)
      return
    }

    setAiGenerating(true)
    setAiDraftError(null)

    try {
      const draft = await generateRemoteAiDraft({
        category: aiDraftCategory,
        context: buildComposerRequestContext(composerHistory, { targetText: topic }),
        topic,
      })

      setAiDraft(draft)
      setComposerHistory((currentHistory) =>
        addComposerHistoryEntry(
          createDraftComposerHistoryEntry(draft, {
            category: aiDraftCategory,
            topic,
          }),
          currentHistory,
        ),
      )
      flashSaveFeedback('Draft generated')
    } catch (error) {
      console.warn('Unable to generate AI draft.', error)
      setAiDraftError(
        error instanceof Error && error.message
          ? error.message
          : 'Composer could not create a draft. Check the server and Gemini key.',
      )
    } finally {
      setAiGenerating(false)
    }
  }

  const createNoteFromAiDraft = () => {
    if (!aiDraft) {
      return
    }

    const now = new Date().toISOString()
    const newBlocks = aiDraft.blocks.map(convertAiDraftBlockToNoteBlock)
    const safeBlocks = newBlocks.length > 0 ? newBlocks : [createEmptyBlock('paragraph')]
    const newNote: Note = {
      id: generateId('note'),
      title: aiDraft.title || 'Untitled AI Draft',
      collectionId: aiDraft.collectionId,
      folderId: null,
      status: aiDraft.status || aiDraftCategories.find((category) => category.value === aiDraftCategory)?.label || 'Draft',
      blocks: safeBlocks,
      editorDoc: noteBlocksToTiptapContent(safeBlocks),
      sources: [],
      tags: dedupeStrings(aiDraft.tags.length > 0 ? aiDraft.tags : ['ai-draft']),
      previewDate: 'Just now',
      updatedAt: now,
      isFavorite: false,
      isPinned: false,
      layout: aiDraft.layout,
      type: aiDraft.noteType,
    }

    setNotes((currentNotes) => [newNote, ...currentNotes])
    setActiveCollectionId(newNote.collectionId)
    setActiveFolderId(null)
    setActiveTag(null)
    setActiveNoteId(newNote.id)
    setSelectedBlockId(newNote.blocks[0]?.id ?? null)
    setNoteHistoryOpen(false)
    setNoteHistoryEntries([])
    setSelectedNoteRevisionId(null)
    setNoteViewMode('edit')
    setAiComposerOpen(false)
    setAiDraft(null)
    setAiDraftTopic('')
    setEditorContext('library')
    setZenMode(false)
    markSaving()
    startTransition(() => setView('editor'))
  }

  const generateAiAssist = async (actionOverride: AiAssistAction = aiAssistAction) => {
    if (!activeNote) {
      setAiAssistError('Open a note before using active-note Composer.')
      return
    }

    const effectiveAction = actionOverride
    const selectedText = noteViewMode === 'edit' ? selectedBlockText : ''
    const noteText = getPlainTextFromBlocks(activeNote.blocks)

    if (noteText.length < 3 && selectedText.length < 3) {
      setAiAssistError('Write a little in this note first, then Composer can help.')
      return
    }

    if (!remoteAccountActive) {
      setAiAssistError(composerLockedMessage)
      return
    }

    setAiAssisting(true)
    setAiAssistError(null)

    try {
      const result = await generateRemoteAiAssist({
        action: effectiveAction,
        context: buildComposerRequestContext(composerHistory, {
          activeNoteTitle: activeNote.title,
          targetText: `${activeNote.title} ${activeNote.status} ${activeNote.tags.join(' ')} ${selectedText} ${noteText}`,
        }),
        note: {
          selectedText,
          status: activeNote.status,
          tags: activeNote.tags,
          text: noteText,
          title: activeNote.title,
        },
      })

      setAiAssistResult(result)
      setComposerHistory((currentHistory) =>
        addComposerHistoryEntry(
          createAssistComposerHistoryEntry(result, {
            action: effectiveAction,
            noteTitle: activeNote.title,
            selectedText,
          }),
          currentHistory,
        ),
      )
      flashSaveFeedback('Composer response ready')
    } catch (error) {
      console.warn('Unable to generate active-note assistance.', error)
      setAiAssistError(
        error instanceof Error && error.message
          ? error.message
          : 'Composer could not assist this note. Check the server and Gemini key.',
      )
    } finally {
      setAiAssisting(false)
    }
  }

  const appendAiAssistToActiveNote = () => {
    if (!activeNote || !aiAssistResult) {
      return
    }

    const nextBlocks = aiAssistResult.blocks.map(convertAiDraftBlockToNoteBlock)

    if (nextBlocks.length === 0) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: [...note.blocks, ...nextBlocks],
      editorDoc: appendBlocksToEditorDocument(note, nextBlocks),
    }))
    setSelectedBlockId(nextBlocks[0].id)
    setNoteViewMode('edit')
    queueBlockFocus(nextBlocks[0].id, 'start')
    flashSaveFeedback('Inserted Composer blocks')
  }

  const replaceSelectedBlockWithAiAssist = () => {
    if (!activeNote || !selectedBlockId || !aiAssistResult) {
      return
    }

    const nextBlocks = aiAssistResult.blocks.map(convertAiDraftBlockToNoteBlock)

    if (nextBlocks.length === 0) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: note.blocks.flatMap((block) => (block.id === selectedBlockId ? nextBlocks : [block])),
      editorDoc: replaceBlockInEditorDocument(note, selectedBlockId, nextBlocks),
    }))
    setSelectedBlockId(nextBlocks[0].id)
    setNoteViewMode('edit')
    queueBlockFocus(nextBlocks[0].id, 'start')
    flashSaveFeedback('Replaced selected block')
  }

  const restoreComposerHistoryEntry = (entry: ComposerHistoryEntry) => {
    if (!remoteAccountActive) {
      showComposerLockedDialog()
      return
    }

    setAiComposerOpen(true)
    setAiComposerMode(entry.mode)
    setAiDraftError(null)
    setAiAssistError(null)

    if (entry.mode === 'draft' && entry.draft) {
      setAiDraftCategory(entry.draft.category)
      setAiDraftTopic(entry.prompt)
      setAiDraft({
        blocks: entry.blocks,
        collectionId: entry.draft.collectionId,
        layout: entry.draft.layout,
        noteType: entry.draft.noteType,
        status: entry.draft.status,
        summary: entry.summary,
        tags: entry.draft.tags,
        title: entry.title,
      })
      return
    }

    if (entry.mode === 'assist' && entry.assist) {
      setAiAssistAction(entry.assist.action)
      setAiAssistResult({
        action: entry.assist.action,
        actionLabel: entry.assist.actionLabel,
        blocks: entry.blocks,
        canReplaceSelection: false,
        summary: entry.summary,
        title: entry.title,
      })
    }
  }

  const clearComposerHistory = () => {
    setDialogState({
      type: 'confirm',
      tone: 'danger',
      title: 'Clear Composer history?',
      message: 'Recent generated drafts and assist results will be removed. Notes already created or edited will stay untouched.',
      confirmLabel: 'Clear history',
      onConfirm: () => {
        setComposerHistory([])
        flashSaveFeedback('Composer history cleared')
      },
    })
  }

  const focusImportedNote = (note: Note, message: string) => {
    setAiComposerOpen(false)
    setActiveCollectionId(note.collectionId)
    setActiveFolderId(note.folderId)
    setActiveTag(null)
    setSearchQuery('')
    setEditorContext('library')
    setActiveNoteId(note.id)
    setNoteHistoryOpen(false)
    setNoteViewMode(getDefaultNoteViewMode(note))
    setZenMode(false)
    flashSaveFeedback(message)
    startTransition(() => setView('editor'))
  }

  const openImportDialog = () => {
    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    importFileInputRef.current?.click()
  }

  const exportLibraryAsJson = () => {
    setAiComposerOpen(false)
    downloadTextFile(
      `essence-export-${getExportDateStamp()}.json`,
      JSON.stringify(
        {
          activeNoteId,
          composerHistory,
          folders,
          notes,
        },
        null,
        2,
      ),
      'application/json;charset=utf-8',
    )
  }

  const exportActiveNoteAsMarkdown = () => {
    if (!activeNote) {
      return
    }

    downloadTextFile(
      `${createFileSlug(activeNote.title)}.md`,
      serializeNoteToMarkdown(activeNote, foldersById),
      'text/markdown;charset=utf-8',
    )
    flashSaveFeedback('Markdown exported')
  }

  const importJsonState = (rawText: string) => {
    const importedState = cloneImportedStateWithFreshIds(parseImportedJsonState(rawText))
    const importedLeadNote =
      importedState.notes.find((note) => note.id === importedState.activeNoteId) ?? importedState.notes[0] ?? null

    if (!importedLeadNote) {
      throw new Error('This JSON file does not contain any notes.')
    }

    setFolders((currentFolders) => [...currentFolders, ...importedState.folders])
    setNotes((currentNotes) => [...importedState.notes, ...currentNotes])
    setComposerHistory((currentHistory) =>
      mergeComposerHistory(importedState.composerHistory, currentHistory),
    )
    focusImportedNote(importedLeadNote, `Imported ${formatCount(importedState.notes.length, 'note')} from JSON`)
  }

  const importMarkdownNote = (rawText: string, fileName: string) => {
    const imported = parseMarkdownNote(rawText, fileName)
    const ensuredFolders = ensureFolderPath(imported.folderPath, imported.note.collectionId, folders)
    const importedNote: Note = {
      ...imported.note,
      folderId: ensuredFolders.folderId,
    }

    setFolders(ensuredFolders.folders)
    setNotes((currentNotes) => [importedNote, ...currentNotes])
    focusImportedNote(importedNote, 'Imported Markdown note')
  }

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const rawText = await file.text()
      const normalizedName = file.name.toLowerCase()

      if (normalizedName.endsWith('.json')) {
        importJsonState(rawText)
      } else if (normalizedName.endsWith('.md') || normalizedName.endsWith('.markdown')) {
        importMarkdownNote(rawText, file.name)
      } else {
        throw new Error('Please choose a Markdown or JSON file.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The selected file could not be imported.'
      setDialogState({
        confirmLabel: 'Close',
        message,
        title: 'Import failed',
        tone: 'danger',
        type: 'alert',
      })
    } finally {
      event.currentTarget.value = ''
    }
  }

  const switchNoteViewMode = (nextMode: NoteViewMode) => {
    setNoteViewMode(nextMode)
  }

  const toggleFocusMode = () => {
    if (!activeNote || view !== 'editor') {
      return
    }

    setZenMode((isFocused) => {
      const nextIsFocused = !isFocused

      if (nextIsFocused) {
        setAiComposerOpen(false)
        setEditorActionsOpen(false)
        setQuickSwitcherOpen(false)
        setNoteHistoryOpen(false)
        setSlashMenuState(null)
        setLinkMenuState(null)
      }

      return nextIsFocused
    })
  }

  const updateReadingProgress = () => {
    const editorScreen = editorScreenRef.current

    if (!editorScreen) {
      setReadingProgress(0)
      return
    }

    const maxScrollTop = editorScreen.scrollHeight - editorScreen.clientHeight
    const nextProgress = maxScrollTop <= 0 ? 1 : editorScreen.scrollTop / maxScrollTop
    const boundedProgress = Math.min(1, Math.max(0, nextProgress))

    setReadingProgress(boundedProgress)

    if (boundedProgress < 0.9) {
      setReaderExplorationAwake(false)
    }
  }

  const handleEditorWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!activeNote || view !== 'editor' || noteViewMode !== 'read' || event.deltaY <= 8) {
      return
    }

    const editorScreen = event.currentTarget
    const distanceFromBottom = editorScreen.scrollHeight - editorScreen.scrollTop - editorScreen.clientHeight

    if (distanceFromBottom <= 28) {
      setReaderExplorationAwake(true)
    }
  }

  const exploreReaderDepth = async (action: ReaderExplorationAction) => {
    if (!activeNote) {
      return
    }

    if (!remoteAccountActive) {
      showComposerLockedDialog()
      return
    }

    const assistAction = readerExplorationAssistActionByAction[action]

    setReaderExplorationAwake(true)
    setReaderExplorationPendingAction(action)
    setAiComposerMode('assist')
    setAiAssistAction(assistAction)
    setAiAssistResult(null)
    setAiAssistError(null)
    setAiDraftError(null)
    setSelectedBlockId(null)
    setZenMode(false)
    setAiComposerOpen(true)

    try {
      await generateAiAssist(assistAction)
    } finally {
      setReaderExplorationPendingAction(null)
    }
  }

  const navigate = (nextView: NavMode) => {
    setZenMode(false)
    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    setEditorActionsOpen(false)

    startTransition(() => {
      setView(nextView)
      setSearchQuery('')
      if (nextView !== 'library') {
        setActiveCollectionId(null)
        setActiveFolderId(null)
        setActiveTag(null)
      }
    })
  }

  const openCollection = (collectionId: CollectionId) => {
    setZenMode(false)
    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    setEditorActionsOpen(false)
    focusCollectionFilter(collectionId)
  }

  const openFolder = (folderId: string) => {
    setZenMode(false)
    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    setEditorActionsOpen(false)
    focusFolderFilter(folderId)
  }

  const openTag = (tagName: string) => {
    setZenMode(false)
    setAiComposerOpen(false)
    setQuickSwitcherOpen(false)
    setEditorActionsOpen(false)
    setActiveCollectionId(null)
    setActiveFolderId(null)
    setActiveTag(tagName)
    startTransition(() => setView('library'))
  }

  const selectQuickSwitcherItem = (item: QuickSwitcherItem) => {
    closeQuickSwitcher()

    switch (item.target.type) {
      case 'create-note':
        createNote()
        return
      case 'navigate':
        navigate(item.target.view)
        return
      case 'note':
        openNote(item.target.noteId)
        return
      case 'collection':
        openCollection(item.target.collectionId)
        return
      case 'folder':
        openFolder(item.target.folderId)
        return
      case 'tag':
        openTag(item.target.tagName)
        return
      default:
        return
    }
  }

  useEffect(() => {
    keyboardShortcutStateRef.current = {
      activeNote,
      aiComposerOpen,
      dialogState,
      editorActionsOpen,
      noteHistoryOpen,
      noteViewMode,
      quickSwitcherOpen,
      view,
    }

    keyboardShortcutActionsRef.current = {
      closeNoteHistory,
      closeQuickSwitcher,
      createNote,
      openQuickSwitcher,
      openSearchView,
      redo,
      switchNoteViewMode,
      toggleFocusMode,
      undo,
    }
  })

  useEffect(() => {
    const handleKeyboardShortcuts = (event: KeyboardEvent) => {
      const state = keyboardShortcutStateRef.current
      const actions = keyboardShortcutActionsRef.current
      const key = event.key.toLowerCase()
      const isModifierPressed = event.metaKey || event.ctrlKey

      if (state.dialogState) {
        return
      }

      if (state.quickSwitcherOpen) {
        if (event.key === 'Escape' || (isModifierPressed && key === 'k')) {
          event.preventDefault()
          actions.closeQuickSwitcher()
        }

        return
      }

      if (event.key === 'Escape') {
        if (state.editorActionsOpen) {
          event.preventDefault()
          setEditorActionsOpen(false)
          return
        }

        if (state.aiComposerOpen) {
          event.preventDefault()
          setAiComposerOpen(false)
          return
        }

        if (state.noteHistoryOpen) {
          event.preventDefault()
          actions.closeNoteHistory()
          return
        }

        setZenMode(false)
        return
      }

      if (
        key === 'f' &&
        state.view === 'editor' &&
        state.activeNote &&
        !isModifierPressed &&
        !isEditableKeyboardTarget(event.target)
      ) {
        event.preventDefault()
        actions.toggleFocusMode()
        return
      }

      if (!isModifierPressed) {
        return
      }

      if (key === 'k') {
        event.preventDefault()
        actions.openQuickSwitcher()
        return
      }

      if (key === 'n') {
        event.preventDefault()
        actions.createNote()
        return
      }

      if (key === 'f' && event.shiftKey) {
        event.preventDefault()
        actions.openSearchView()
        return
      }

      if (key === 'e' && state.view === 'editor' && state.activeNote) {
        event.preventDefault()
        actions.switchNoteViewMode(state.noteViewMode === 'edit' ? 'read' : 'edit')
        return
      }

      if (key === 'z') {
        event.preventDefault()

        if (event.shiftKey) {
          actions.redo()
        } else {
          actions.undo()
        }

        return
      }

      if (key === 'y' && !event.shiftKey) {
        event.preventDefault()
        actions.redo()
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcuts)
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts)
  }, [])

  const clearFilters = () => {
    setActiveCollectionId(null)
    setActiveFolderId(null)
    setActiveTag(null)
    setSearchQuery('')
  }

  const toggleFavorite = () => {
    if (!activeNote) {
      return
    }

    patchNote(
      activeNote.id,
      (note) => ({
        ...note,
        isFavorite: !note.isFavorite,
      }),
      false,
    )
    setSaveMessage('Saved just now')
  }

  const togglePinned = () => {
    if (!activeNote) {
      return
    }

    patchNote(
      activeNote.id,
      (note) => ({
        ...note,
        isPinned: !note.isPinned,
      }),
      false,
    )
    flashSaveFeedback(activeNote.isPinned ? 'Removed from pinned notes' : 'Pinned note')
  }

  const publishActiveNote = () => {
    if (!activeNote) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      status: 'Published',
      tags: removeDraftTags(note.tags),
    }))
    setNoteViewMode('read')
    flashSaveFeedback('Published note')
  }

  const moveActiveNoteToDraft = () => {
    if (!activeNote) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      status: 'Draft',
    }))
    setNoteViewMode('edit')
    flashSaveFeedback('Moved back to drafts')
  }

  const handleTitleChange = (value: string) => {
    if (!activeNote) {
      return
    }

    patchNote(activeNote.id, (note) => ({ ...note, title: value }))
  }

  const queueBlockFocus = (blockId: string, placement: BlockFocusRequest['placement']) => {
    void placement
    setSelectedBlockId(blockId)
  }

  const handleCollectionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!activeNote) {
      return
    }

    const nextCollectionId = event.target.value as CollectionId

    patchNote(activeNote.id, (note) => ({
      ...note,
      collectionId: nextCollectionId,
      folderId:
        note.folderId && foldersById[note.folderId]?.collectionId === nextCollectionId
          ? note.folderId
          : null,
    }))
  }

  const handleFolderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!activeNote) {
      return
    }

    const nextFolderId = event.target.value || null
    const nextFolder = nextFolderId ? foldersById[nextFolderId] : null

    patchNote(activeNote.id, (note) => ({
      ...note,
      collectionId: nextFolder?.collectionId ?? note.collectionId,
      folderId: nextFolderId,
    }))
  }

  const addTagToActiveNote = () => {
    if (!activeNote) {
      return
    }

    const noteId = activeNote.id

    setDialogState({
      type: 'prompt',
      title: 'Add topic',
      message: 'Create a short topic label for this note. Spaces will be converted to hyphens.',
      label: 'Topic',
      initialValue: '',
      placeholder: 'philosophy-of-mind',
      confirmLabel: 'Add topic',
      onConfirm: (value) => {
        const nextTag = normalizeTopicTag(value)

        if (!nextTag) {
          flashSaveFeedback('Topic was empty')
          return
        }

        if (activeNote.tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
          flashSaveFeedback('Topic already on note')
          return
        }

        patchNote(noteId, (note) => {
          const hasTopic = note.tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())

          if (hasTopic) {
            return note
          }

          return {
            ...note,
            tags: [...note.tags, nextTag],
          }
        })

        flashSaveFeedback('Topic added')
      },
    })
  }

  const removeTagFromActiveNote = (tagName: string) => {
    if (!activeNote || !activeNote.tags.includes(tagName)) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      tags: note.tags.filter((tag) => tag !== tagName),
    }))
  }

  const addSourceToActiveNote = () => {
    if (!activeNote) {
      return
    }

    const nextSource = createEmptySourceCard()

    patchNote(activeNote.id, (note) => ({
      ...note,
      sources: [...note.sources, nextSource],
    }))
    flashSaveFeedback('Source card added')
  }

  const updateSourceOnActiveNote = (sourceId: string, changes: Partial<NoteSource>) => {
    if (!activeNote) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      sources: note.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              ...changes,
            }
          : source,
      ),
    }))
  }

  const deleteSourceFromActiveNote = (sourceId: string) => {
    if (!activeNote) {
      return
    }

    const source = activeNote.sources.find((candidate) => candidate.id === sourceId)

    if (!source) {
      return
    }

    setDialogState({
      type: 'confirm',
      tone: 'danger',
      title: 'Delete source card?',
      message: `"${source.title || 'Untitled source'}" will be removed from this note. The note body will stay unchanged.`,
      confirmLabel: 'Delete source',
      onConfirm: () => {
        patchNote(activeNote.id, (note) => ({
          ...note,
          sources: note.sources.filter((candidate) => candidate.id !== sourceId),
        }))
      },
    })
  }

  const deleteTag = (tagName: string) => {
    const affectedNotes = notes.filter((note) => note.tags.includes(tagName))

    if (affectedNotes.length === 0) {
      return
    }

    setDialogState({
      type: 'confirm',
      tone: 'danger',
      title: `Delete "${tagName}"?`,
      message: `"${tagName}" will be removed from ${formatCount(affectedNotes.length, 'note')}. Notes themselves will not be deleted.`,
      confirmLabel: 'Delete topic',
      onConfirm: () => {
        setNotes((currentNotes) =>
          currentNotes.map((note) =>
            note.tags.includes(tagName)
              ? {
                  ...note,
                  previewDate: 'Just now',
                  tags: note.tags.filter((tag) => tag !== tagName),
                  updatedAt: new Date().toISOString(),
                }
              : note,
          ),
        )

        if (activeTag === tagName) {
          setActiveTag(null)
        }

        markSaving()
      },
    })
  }

  const replaceActiveNoteBlocks = (nextBlocks: NoteBlock[], nextEditorDoc: JSONContent) => {
    if (!activeNote) {
      return
    }

    const safeBlocks = nextBlocks.length > 0 ? nextBlocks : [createEmptyBlock('paragraph')]

    setSlashMenuState(null)
    setLinkMenuState(null)
    setSelectedBlockId(safeBlocks[0]?.id ?? null)
    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: safeBlocks,
      editorDoc: normalizeEditorDocument(nextEditorDoc, safeBlocks),
    }))
  }

  const createFolder = (collectionId: CollectionId, parentId: string | null) => {
    const siblingCount = folders.filter(
      (folder) => folder.collectionId === collectionId && folder.parentId === parentId,
    ).length

    const newFolder: Folder = {
      id: generateId('folder'),
      name: `New Folder ${siblingCount + 1}`,
      parentId,
      collectionId,
    }

    setFolders((currentFolders) => [...currentFolders, newFolder])
    setExpandedFolderIds((currentIds) =>
      Array.from(new Set([...currentIds, newFolder.id, ...(parentId ? [parentId] : [])])),
    )
    setActiveCollectionId(collectionId)
    setActiveFolderId(newFolder.id)
    setAiComposerOpen(false)
    startTransition(() => setView('collections'))
  }

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((currentIds) =>
      currentIds.includes(folderId)
        ? currentIds.filter((id) => id !== folderId)
        : [...currentIds, folderId],
    )
  }

  const activeFilterLabel = activeFolderId
    ? getFolderPathLabel(activeFolderId, foldersById)
    : activeCollectionId
      ? collectionNameById[activeCollectionId]
      : activeTag
        ? `#${activeTag}`
        : null
  const showGlobalTopbarTools = view !== 'editor'
  const showEditorHeaderLayout = view === 'editor'
  const editorHeaderModeLabel = noteViewMode === 'edit' ? 'Editing' : 'Reading'
  const navigationSidebarToggleLabel = navigationSidebarVisible ? 'Hide navigation sidebar' : 'Show navigation sidebar'
  const showAuthScreen = !remoteSyncReady || ((!currentUser || currentUser.isLocal) && !authGateDismissed)
  const readingProgressPercent = Math.round(readingProgress * 100)

  useEffect(() => {
    if (searchFocusSignal <= 0 || !showGlobalTopbarTools) {
      return
    }

    topbarSearchInputRef.current?.focus()
    topbarSearchInputRef.current?.select()
  }, [searchFocusSignal, showGlobalTopbarTools])

  if (showAuthScreen) {
    return (
      <AuthScreen
        disabled={authBusy || !remoteSyncReady}
        email={authEmail}
        error={authError}
        isLoading={!remoteSyncReady}
        notice={authNotice}
        onContinueLocally={continueLocally}
        onEmailChange={(value) => {
          setAuthEmail(value)
          setAuthError(null)
          setAuthNotice(null)
        }}
        onSubmit={handleSignIn}
        waitlistUrl={waitlistUrl}
      />
    )
  }

  return (
    <div
      className={`app-shell app-shell--ambience-${ambienceMode} ${
        navigationSidebarVisible ? '' : 'app-shell--navigationHidden'
      } ${zenMode ? 'is-zen' : ''}`}
    >
      <div className="cosmic-sky" aria-hidden="true">
        <span className="cosmic-sky__meteor" />
        <span className="cosmic-sky__meteor" />
        <span className="cosmic-sky__meteor" />
        <span className="cosmic-sky__meteor" />
        <span className="cosmic-sky__meteor" />
      </div>

      <input
        ref={importFileInputRef}
        type="file"
        accept=".json,.md,.markdown"
        hidden
        onChange={handleImportFileChange}
      />

      {!zenMode && navigationSidebarVisible && (
        <aside className={`rail ${showGlobalTopbarTools ? 'rail--globalToolsVisible' : ''}`}>
          <div className="rail__brand" aria-label="Essence">
            <EssenceMark framed compact />
          </div>

          <div className="rail__composeGroup">
            <button
              type="button"
              className="rail__compose"
              onClick={createNote}
              aria-label="Create new note"
              title="Create new note"
            >
              <Icon name="compose" />
            </button>
            <span className="rail__composeLabel">New note</span>
          </div>

          <nav className="rail__nav" aria-label="Primary">
            <RailButton isActive={view === 'library'} label="Library" onClick={() => navigate('library')}>
              <Icon name="library" />
            </RailButton>
            <RailButton isActive={view === 'collections'} label="Collections" onClick={() => navigate('collections')}>
              <Icon name="grid" />
            </RailButton>
            <RailButton isActive={view === 'favorites'} label="Favorites" onClick={() => navigate('favorites')}>
              <Icon name="star" />
            </RailButton>
            <RailButton isActive={view === 'archive'} label="Archive" onClick={() => navigate('archive')}>
              <Icon name="archive" />
            </RailButton>
          </nav>

          <div className="rail__footer">
            <AmbienceControl mode={ambienceMode} onChange={setAmbienceMode} />
          </div>
        </aside>
      )}

      {!zenMode && aiComposerOpen && (
        <Suspense fallback={<AiComposerPanelFallback />}>
          <AiComposerPanel
            activeNoteTitle={activeNote?.title ?? null}
            assistAction={aiAssistAction}
            assistError={aiAssistError}
            assistResult={aiAssistResult}
            category={aiDraftCategory}
            canReplaceSelection={
              Boolean(aiAssistResult?.canReplaceSelection && activeNote && selectedBlock && noteViewMode === 'edit')
            }
            composerHistory={composerHistory}
            draft={aiDraft}
            error={aiDraftError}
            isAssisting={aiAssisting}
            isGenerating={aiGenerating}
            isOpen={aiComposerOpen}
            mode={aiComposerMode}
            onAppendAssist={appendAiAssistToActiveNote}
            onAssistActionChange={(action) => {
              setAiAssistAction(action)
              setAiAssistResult(null)
              setAiAssistError(null)
            }}
            onCategoryChange={(category) => {
              setAiDraftCategory(category)
              setAiDraft(null)
              setAiDraftError(null)
            }}
            onClearHistory={clearComposerHistory}
            onClose={() => setAiComposerOpen(false)}
            onCreateNote={createNoteFromAiDraft}
            onGenerateAssist={generateAiAssist}
            onGenerate={generateAiDraft}
            onModeChange={(mode) => {
              setAiComposerMode(mode)
              setAiDraftError(null)
              setAiAssistError(null)
            }}
            onReplaceSelection={replaceSelectedBlockWithAiAssist}
            onRestoreHistory={restoreComposerHistoryEntry}
            onTopicChange={(value) => {
              setAiDraftTopic(value)
              setAiDraftError(null)
            }}
            selectedBlockPreview={noteViewMode === 'edit' ? summarizeInlineText(selectedBlockText, 120) : ''}
            topic={aiDraftTopic}
          />
        </Suspense>
      )}

      <div className="workspace">
        {!zenMode && (
          <header
            className={`topbar ${showEditorHeaderLayout ? 'topbar--editor' : ''} ${showGlobalTopbarTools ? 'topbar--dashboard' : ''}`}
          >
            {view === 'editor' ? (
              <>
                <div className="topbar__leading">
                  <button
                    type="button"
                    className={`icon-button topbar__sidebarToggle ${
                      navigationSidebarVisible ? 'icon-button--active' : ''
                    }`}
                    onClick={() => setNavigationSidebarVisible((currentValue) => !currentValue)}
                    aria-label={navigationSidebarToggleLabel}
                    aria-pressed={navigationSidebarVisible}
                    title={navigationSidebarToggleLabel}
                  >
                    <Icon name={navigationSidebarVisible ? 'panelLeftClose' : 'panelLeftOpen'} />
                  </button>
                  <button type="button" className="text-action" onClick={() => navigate(editorContext)}>
                    <Icon name="arrowLeft" />
                    <span>{`Back to ${browseViewMeta[editorContext].heading}`}</span>
                  </button>
                </div>

                {activeNote ? (
                  <div className="topbar__context topbar__context--editorMode" aria-label="Current editor note">
                    <span>{editorHeaderModeLabel}</span>
                    <strong>{activeNote.title || 'Untitled note'}</strong>
                  </div>
                ) : !activeNote ? (
                  <div className="topbar__context topbar__context--editorEmpty">No note selected yet.</div>
                ) : null}

                <div className="topbar__actions topbar__actions--editor">
                  <span className="save-state">
                    {activeNote ? saveMessage : 'Empty library'}
                  </span>
                  <div className="topbar__actionGroup">
                    {activeNote ? (
                      <>
                        <button
                          type="button"
                          className={`icon-button ${editorSidebarOpen ? 'icon-button--active' : ''}`}
                          onClick={() => setEditorSidebarOpen((currentValue) => !currentValue)}
                          aria-label={editorSidebarOpen ? 'Hide library panel' : 'Show library panel'}
                          aria-pressed={editorSidebarOpen}
                          title={editorSidebarOpen ? 'Hide library panel' : 'Show library panel'}
                        >
                          <Icon name="library" />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={undo}
                          aria-label="Undo last change"
                          title="Undo last change"
                          disabled={!historyState.canUndo}
                        >
                          <Icon name="undo" />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={redo}
                          aria-label="Redo change"
                          title="Redo change"
                          disabled={!historyState.canRedo}
                        >
                          <Icon name="redo" />
                        </button>
                        <button
                          type="button"
                          className={`utility-button ${zenMode ? 'utility-button--active' : ''}`}
                          onClick={toggleFocusMode}
                          aria-pressed={zenMode}
                          title="Toggle Focus Mode (F)"
                        >
                          <Icon name="focus" />
                          <span>Focus</span>
                        </button>
                        {isDraftNote(activeNote) && (
                          <button
                            type="button"
                            className="utility-button utility-button--accent"
                            onClick={publishActiveNote}
                            title="Publish this note"
                          >
                            <Icon name="check" />
                            <span>Publish</span>
                          </button>
                        )}
                        <ModeToggle mode={noteViewMode} onChange={switchNoteViewMode} />
                        <EditorActionsMenu
                          isOpen={editorActionsOpen}
                          note={activeNote}
                          noteHistoryOpen={noteHistoryOpen}
                          onClose={() => setEditorActionsOpen(false)}
                          onDelete={() => deleteNote(activeNote.id)}
                          onExportMarkdown={exportActiveNoteAsMarkdown}
                          onOpenQuickSwitcher={openQuickSwitcher}
                          onMoveToDraft={moveActiveNoteToDraft}
                          onPublish={publishActiveNote}
                          onToggleFavorite={toggleFavorite}
                          onToggleHistory={toggleNoteHistory}
                          onToggleOpen={() => setEditorActionsOpen((currentValue) => !currentValue)}
                          onTogglePinned={togglePinned}
                        />
                      </>
                    ) : (
                      <button type="button" className="ghost-button" onClick={createNote}>
                        <Icon name="plus" />
                        <span>New note</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="topbar__browseHeading">
                  <button
                    type="button"
                    className={`icon-button topbar__sidebarToggle ${
                      navigationSidebarVisible ? 'icon-button--active' : ''
                    }`}
                    onClick={() => setNavigationSidebarVisible((currentValue) => !currentValue)}
                    aria-label={navigationSidebarToggleLabel}
                    aria-pressed={navigationSidebarVisible}
                    title={navigationSidebarToggleLabel}
                  >
                    <Icon name={navigationSidebarVisible ? 'panelLeftClose' : 'panelLeftOpen'} />
                  </button>
                  {view === 'library' ? (
                    <div className="topbar__browseContext">
                      <span>Workspace</span>
                      <strong>Essence</strong>
                    </div>
                  ) : (
                    <div className="topbar__browseTitle">{browseViewMeta[view].heading}</div>
                  )}
                </div>
                {showGlobalTopbarTools && (
                  <div className="topbar__dashboardTools" aria-label="Library tools">
                    <label className="topbar-search">
                      <Icon name="search" />
                      <input
                        ref={topbarSearchInputRef}
                        type="search"
                        value={searchQuery}
                        onChange={(event) => updateGlobalSearchQuery(event.target.value)}
                        placeholder="Search notes, blocks, and tags"
                        aria-label="Search notes, blocks, and tags"
                      />
                    </label>

                    <div className="topbar__dashboardActions">
                      <button
                        type="button"
                        className="topbar-toolButton topbar-toolButton--primary"
                        onClick={createNote}
                        aria-label="Create new note"
                        title="Create new note"
                      >
                        <Icon name="plus" />
                        <span>New note</span>
                      </button>
                      <button
                        type="button"
                        className="topbar-toolButton"
                        onClick={openImportDialog}
                        aria-label="Import notes"
                        title="Import notes"
                      >
                        <Icon name="upload" />
                        <span>Import</span>
                      </button>
                      <button
                        type="button"
                        className="topbar-toolButton"
                        onClick={toggleComposerPanel}
                        aria-label="Open Composer"
                        title={remoteAccountActive ? 'Open Composer' : 'Sign in with an approved invite to use Composer'}
                      >
                        <Icon name={remoteAccountActive ? 'spark' : 'lock'} />
                        <span>Composer</span>
                      </button>
                    </div>
                  </div>
                )}
                <div className="topbar__actions topbar__actions--browser">
                  <div className="topbar__actionGroup topbar__actionGroup--browser">
                    <button
                      type="button"
                      className="utility-button"
                      onClick={exportLibraryAsJson}
                      aria-label="Export library as JSON"
                      title="Export library as JSON"
                    >
                      <Icon name="download" />
                      <span>Export JSON</span>
                    </button>
                  </div>
                  <AccountControl
                    disabled={authBusy}
                    onOpenAuth={openAuthScreen}
                    onSignOut={handleSignOut}
                    user={currentUser}
                  />
                </div>
              </>
            )}
          </header>
        )}

        <main className={`main ${view === 'editor' ? 'main--editor' : ''}`}>
          {zenMode && view === 'editor' && activeNote && (
            <FocusModeBar
              mode={noteViewMode}
              onExit={toggleFocusMode}
              onModeChange={switchNoteViewMode}
              progress={readingProgressPercent}
              wordCount={activeWordCount}
            />
          )}

          {(view === 'library' || view === 'favorites' || view === 'archive') && (
            <LibraryScreen
              activeCollectionId={activeCollectionId}
              activeFilterLabel={activeFilterLabel}
              activeFolderId={activeFolderId}
              cards={filteredNotes}
              collectionCounts={collectionCounts}
              foldersById={foldersById}
              onClearFilters={clearFilters}
              onCreateNote={createNote}
              onOpenCollection={openCollection}
              onOpenComposer={toggleComposerPanel}
              onOpenFolder={openFolder}
              onOpenImport={openImportDialog}
              onOpenNote={openNote}
              searchQuery={searchQuery}
              viewMode={browseContext}
            />
          )}

          {view === 'collections' && (
            <CollectionsScreen
              activeCollectionId={activeCollectionId}
              activeFolder={activeFolder}
              activeFolderId={activeFolderId}
              collectionCounts={collectionCounts}
              collections={collections}
              expandedFolderIds={expandedFolderIds}
              folders={folders}
              foldersById={foldersById}
              notes={notes}
              onCreateFolder={createFolder}
              onDeleteFolder={deleteFolder}
              onDeleteTag={deleteTag}
              onOpenCollection={openCollection}
              onOpenFolder={openFolder}
              onOpenTag={openTag}
              onRenameFolder={renameFolder}
              onRequestRenameFolder={requestRenameFolder}
              onToggleFolderExpanded={toggleFolderExpanded}
              onMoveFolder={moveFolder}
              tags={tagSummaries}
            />
          )}

          {view === 'editor' && (
            <section
              className={`editor-workspace ${
                !zenMode && editorSidebarOpen ? '' : 'editor-workspace--sidebarCollapsed'
              }`}
            >
              {!zenMode && editorSidebarOpen && (
                <EditorSidebar
                  activeNoteId={activeNoteId}
                  caption={editorPaneCaption}
                  foldersById={foldersById}
                  headingLabel={activeFolderId ? 'Folder' : activeCollectionId ? 'Collection' : browseViewMeta[editorContext].heading}
                  notes={editorSidebarNotes}
                  onOpenNote={openNote}
                  title={editorPaneTitle}
                />
              )}

              {!zenMode && !editorSidebarOpen && (
                <button
                  type="button"
                  className="editor-sidebar-restore"
                  onClick={() => setEditorSidebarOpen(true)}
                  aria-label="Show library panel"
                  title="Show library panel"
                >
                  <Icon name="library" />
                  <span>Notes</span>
                </button>
              )}

              <section
                ref={editorScreenRef}
                className={`editor-screen ${noteHistoryOpen && activeNote ? 'editor-screen--history' : ''} ${
                  zenMode ? 'editor-screen--focus' : ''
                }`}
                onScroll={updateReadingProgress}
                onWheel={handleEditorWheel}
                style={{ '--reading-progress': `${readingProgressPercent}%` } as CSSProperties}
              >
                {activeNote ? (
                  <div className={`editor-layout ${noteHistoryOpen ? 'editor-layout--history' : ''}`}>
                    <div className="editor-column">
                      {!zenMode && noteViewMode === 'edit' && (
                        <Breadcrumbs
                          collectionId={activeNote.collectionId}
                          folderId={activeNote.folderId}
                          foldersById={foldersById}
                          onOpenCollection={(collectionId) => focusCollectionFilter(collectionId, true)}
                          onOpenFolder={(folderId) => focusFolderFilter(folderId, true)}
                        />
                      )}

                      {noteViewMode === 'edit' ? (
                        <>
                          {!zenMode && (
                            <EditorContextPanel
                              activeCollectionOptions={activeCollectionOptions}
                              activeFolderOptions={activeFolderOptions}
                              key={activeNote.id}
                              note={activeNote}
                              onAddSource={addSourceToActiveNote}
                              onAddTag={addTagToActiveNote}
                              onCollectionChange={handleCollectionChange}
                              onDeleteSource={deleteSourceFromActiveNote}
                              onFolderChange={handleFolderChange}
                              onOpenTag={openTag}
                              onRemoveTag={removeTagFromActiveNote}
                              onUpdateSource={updateSourceOnActiveNote}
                            />
                          )}

                          <Suspense fallback={<ModernRichEditorFallback title={activeNote.title} />}>
                            <ModernRichEditor
                              blocks={activeNote.blocks}
                              editorDoc={activeNote.editorDoc}
                              key={activeNote.id}
                              onChange={replaceActiveNoteBlocks}
                              onFocus={() => setSelectedBlockId(activeNote.blocks[0]?.id ?? null)}
                              onTitleChange={handleTitleChange}
                              title={activeNote.title}
                            />
                          </Suspense>

                          {!zenMode && (
                            <NoteConnections
                              backlinks={activeBacklinks}
                              linkedNotes={activeLinkedNotes}
                              onOpenNote={openNote}
                            />
                          )}

                          <footer className="editor-footer">
                            <span>{`${activeWordCount} words / ${activeNote.blocks.length} blocks`}</span>
                            <button type="button" className="text-link" onClick={toggleFocusMode}>
                              {zenMode ? 'Exit Focus' : 'Focus Mode'}
                            </button>
                            {zenMode && <span>Press Esc to return</span>}
                          </footer>
                        </>
                      ) : (
                        <ReadModeNote
                          backlinks={activeBacklinks}
                          foldersById={foldersById}
                          linkedNotes={activeLinkedNotes}
                          note={activeNote}
                          notesByNormalizedTitle={notesByNormalizedTitle}
                          onOpenTag={openTag}
                          onOpenNote={openNote}
                          onExplore={exploreReaderDepth}
                          composerAvailable={remoteAccountActive}
                          explorationAwake={readerExplorationAwake || readingProgress > 0.96}
                          pendingExplorationAction={readerExplorationPendingAction}
                          isFocusMode={zenMode}
                          wordCount={activeWordCount}
                        />
                      )}
                    </div>

                    {noteHistoryOpen && (
                      <NoteHistoryPanel
                        activeRevision={selectedNoteRevision}
                        error={noteHistoryError}
                        isLoading={noteHistoryLoading}
                        note={activeNote}
                        onClose={closeNoteHistory}
                        onRestore={restoreNoteRevision}
                        onSelectRevision={setSelectedNoteRevisionId}
                        restoringRevisionId={restoringRevisionId}
                        revisions={noteHistoryEntries}
                      />
                    )}
                  </div>
                ) : (
                  <div className="empty-state empty-state--editor">
                    <div>
                      <h2>No notes yet</h2>
                      <p>Create your first note to start writing in Essence.</p>
                      <button type="button" className="primary-button" onClick={createNote}>
                        <Icon name="plus" />
                        <span>Create first note</span>
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </section>
          )}
        </main>
      </div>

      <QuickSwitcher
        activeIndex={quickSwitcherActiveIndex}
        isOpen={quickSwitcherOpen}
        items={quickSwitcherItems}
        onActiveIndexChange={setQuickSwitcherActiveIndex}
        onClose={closeQuickSwitcher}
        onQueryChange={setQuickSwitcherQuery}
        onSelect={selectQuickSwitcherItem}
        query={quickSwitcherQuery}
      />
      <AppDialog dialog={dialogState} onClose={closeDialog} />
    </div>
  )
}

function AppDialog({ dialog, onClose }: { dialog: AppDialogState | null; onClose: () => void }) {
  const [draftValue, setDraftValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!dialog) {
      return
    }

    if (dialog.type === 'prompt') {
      setDraftValue(dialog.initialValue)

      const frameId = window.requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })

      return () => window.cancelAnimationFrame(frameId)
    }

    if (dialog.type === 'alert') {
      const frameId = window.requestAnimationFrame(() => {
        primaryButtonRef.current?.focus()
      })

      return () => window.cancelAnimationFrame(frameId)
    }
  }, [dialog])

  useEffect(() => {
    if (!dialog) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dialog, onClose])

  if (!dialog) {
    return null
  }

  const isDanger = 'tone' in dialog && dialog.tone === 'danger'
  const dialogIconName = dialog.type === 'prompt' ? 'edit' : isDanger ? 'trash' : 'spark'

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (dialog.type === 'prompt') {
      dialog.onConfirm(draftValue)
    } else if (dialog.type === 'confirm') {
      dialog.onConfirm()
    }

    onClose()
  }

  return (
    <div className="app-dialog" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="app-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-description"
        onSubmit={handleSubmit}
      >
        <div className="app-dialog__header">
          <span className={`app-dialog__mark ${isDanger ? 'app-dialog__mark--danger' : ''}`} aria-hidden="true">
            <Icon name={dialogIconName} />
          </span>
          <div>
            <h2 id="app-dialog-title">{dialog.title}</h2>
            <p id="app-dialog-description">{dialog.message}</p>
          </div>
        </div>

        {dialog.type === 'prompt' && (
          <label className="app-dialog__field">
            <span>{dialog.label}</span>
            <input
              ref={inputRef}
              type="text"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              placeholder={dialog.placeholder}
            />
          </label>
        )}

        <div className="app-dialog__actions">
          {dialog.type !== 'alert' && (
            <button type="button" className="ghost-button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button ref={primaryButtonRef} type="submit" className={`primary-button ${isDanger ? 'primary-button--danger' : ''}`}>
            {dialog.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function ModernRichEditorFallback({ title }: { title: string }) {
  return (
    <section className="modern-editor modern-editor--loading" aria-busy="true" aria-label="Loading note editor">
      <div className="modern-editor__toolbarFrame">
        <div className="modern-editor__toolbar modern-editor__toolbar--loading">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="modern-editor__body">
        <div className="modern-editor__title modern-editor__title--loading">{title || 'Untitled note'}</div>
        <div className="modern-editor__surface modern-editor__surface--loading">
          <p>Preparing editor...</p>
        </div>
      </div>
    </section>
  )
}

function AiComposerPanelFallback() {
  return (
    <aside className="ai-composer ai-composer--open" aria-label="Loading Composer">
      <div className="ai-composer__panel ai-composer__panel--loading">
        <div className="ai-composer__header">
          <div>
            <span className="ai-composer__eyebrow">Essence Composer</span>
            <h2>Opening Composer...</h2>
            <p>Preparing the drafting side panel.</p>
          </div>
        </div>
        <div className="ai-composer__modeToggle" aria-hidden="true">
          <span className="ai-composer__loadingPill" />
          <span className="ai-composer__loadingPill" />
        </div>
        <div className="ai-composer__preview ai-composer__preview--loading" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </aside>
  )
}

function LibraryScreen({
  activeCollectionId,
  activeFilterLabel,
  activeFolderId,
  cards,
  collectionCounts,
  foldersById,
  onClearFilters,
  onCreateNote,
  onOpenCollection,
  onOpenComposer,
  onOpenFolder,
  onOpenImport,
  onOpenNote,
  searchQuery,
  viewMode,
}: {
  activeCollectionId: CollectionId | null
  activeFilterLabel: string | null
  activeFolderId: string | null
  cards: Note[]
  collectionCounts: Record<CollectionId, number>
  foldersById: Record<string, Folder>
  onClearFilters: () => void
  onCreateNote: () => void
  onOpenCollection: (collectionId: CollectionId) => void
  onOpenComposer: () => void
  onOpenFolder: (folderId: string) => void
  onOpenImport: () => void
  onOpenNote: (noteId: string) => void
  searchQuery: string
  viewMode: NavMode
}) {
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>('cards')
  const [quickFilter, setQuickFilter] = useState<LibraryQuickFilter>('all')
  const normalizedSearchQuery = searchQuery.trim()
  const visibleCards = useMemo(() => filterLibraryCards(cards, quickFilter), [cards, quickFilter])
  const visibleNoteCountLabel = `${formatCount(visibleCards.length, 'note')} in view`
  const isHomeView = viewMode === 'library' && normalizedSearchQuery.length === 0 && !activeFilterLabel && quickFilter === 'all'
  const homeSections = useMemo(() => buildLibraryHomeSections(visibleCards), [visibleCards])
  const emptyState = getLibraryEmptyState(viewMode, searchQuery, activeFilterLabel, quickFilter)
  const searchScopeLabel = activeFilterLabel ?? browseViewMeta[viewMode].heading
  const viewHeading = normalizedSearchQuery ? 'Search results' : browseViewMeta[viewMode].heading
  const viewDescription = normalizedSearchQuery
    ? `Searching ${searchScopeLabel.toLowerCase()} for "${normalizedSearchQuery}".`
    : activeFilterLabel
    ? `Filtered to ${activeFilterLabel.toLowerCase()}.`
    : browseViewMeta[viewMode].description

  useEffect(() => {
    setQuickFilter('all')
  }, [activeFilterLabel, normalizedSearchQuery, viewMode])

  return (
    <section className="library-screen">
      <header className="library-hero">
        <div className="library-hero__copy">
          <span className="section-heading__meta">{visibleNoteCountLabel}</span>
          <h1>{viewHeading}</h1>
          <p>{viewDescription}</p>

          {(activeCollectionId || activeFolderId) && (
            <Breadcrumbs
              collectionId={activeCollectionId}
              folderId={activeFolderId}
              foldersById={foldersById}
              onOpenCollection={onOpenCollection}
              onOpenFolder={onOpenFolder}
            />
          )}
        </div>

        <div className="library-spaces" aria-label="Collections">
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              className={`library-space ${activeCollectionId === collection.id ? 'library-space--active' : ''}`}
              onClick={() => onOpenCollection(collection.id)}
              aria-pressed={activeCollectionId === collection.id}
            >
              <CollectionGlyph icon={collection.icon} />
              <span>{collection.name}</span>
              <small>{collectionCounts[collection.id] ?? 0}</small>
            </button>
          ))}
        </div>
      </header>

      <div className="library-toolbar" aria-label="Library controls">
        <div className="library-filterChips" aria-label="Quick filters">
          {libraryQuickFilters.map((filter) => {
            const count = getLibraryQuickFilterCount(cards, filter.id)

            return (
              <button
                key={filter.id}
                type="button"
                className={`library-filterChip ${quickFilter === filter.id ? 'library-filterChip--active' : ''}`}
                onClick={() => setQuickFilter(filter.id)}
                aria-pressed={quickFilter === filter.id}
              >
                <span>{filter.label}</span>
                <small>{count}</small>
              </button>
            )
          })}
        </div>

        <div className="library-toolbar__actions">
          {activeFilterLabel && (
            <button type="button" className="library-clearFilter" onClick={onClearFilters}>
              <span>{activeFilterLabel}</span>
              <Icon name="close" />
            </button>
          )}

          <div className="library-viewToggle" role="tablist" aria-label="Library view">
            <button
              type="button"
              className={displayMode === 'cards' ? 'library-viewToggle__button--active' : ''}
              onClick={() => setDisplayMode('cards')}
              role="tab"
              aria-selected={displayMode === 'cards'}
            >
              Cards
            </button>
            <button
              type="button"
              className={displayMode === 'list' ? 'library-viewToggle__button--active' : ''}
              onClick={() => setDisplayMode('list')}
              role="tab"
              aria-selected={displayMode === 'list'}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {visibleCards.length === 0 ? (
        <div className="empty-state">
          <h2>{emptyState.title}</h2>
          <p>{emptyState.description}</p>
          <div className="empty-state__actions">
            <button type="button" className="primary-button" onClick={onCreateNote}>
              <Icon name="plus" />
              <span>New note</span>
            </button>
            <button type="button" className="ghost-button" onClick={onOpenImport}>
              <Icon name="upload" />
              <span>Import</span>
            </button>
            <button type="button" className="ghost-button" onClick={onOpenComposer}>
              <Icon name="spark" />
              <span>Composer</span>
            </button>
          </div>
        </div>
      ) : isHomeView ? (
        <div className="library-home">
          {homeSections.map((section) => (
            <section key={section.id} className="library-home__section">
              <div className="library-home__header">
                <div>
                  <span className="library-home__eyebrow">{section.eyebrow}</span>
                  <h2>{section.title}</h2>
                </div>
                <p>{section.description}</p>
              </div>

              {displayMode === 'list' || section.id === 'recent' ? (
                <div className="note-list">
                  {section.notes.map((note) => (
                    <NoteListItem key={note.id} note={note} foldersById={foldersById} onOpenNote={onOpenNote} />
                  ))}
                </div>
              ) : (
                <div className={`note-grid ${section.emphasize ? 'note-grid--hero' : ''}`}>
                  {section.notes.map((note) => (
                    <NoteCard key={note.id} note={note} foldersById={foldersById} onOpenNote={onOpenNote} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : displayMode === 'list' ? (
        <div className="note-list">
          {visibleCards.map((note) => (
            <NoteListItem key={note.id} note={note} foldersById={foldersById} onOpenNote={onOpenNote} />
          ))}
        </div>
      ) : (
        <div className="note-grid">
          {visibleCards.map((note) => (
            <NoteCard key={note.id} note={note} foldersById={foldersById} onOpenNote={onOpenNote} />
          ))}
        </div>
      )}

      <footer className="library-footer">
        <p>Copyright 2026 Essence. A lucid space for thought.</p>
      </footer>
    </section>
  )
}

function getLibraryEmptyState(
  viewMode: NavMode,
  searchQuery: string,
  activeFilterLabel: string | null,
  quickFilter: LibraryQuickFilter = 'all',
): { description: string; title: string } {
  if (searchQuery.trim()) {
    return {
      title: 'No matching notes',
      description: 'Try a softer keyword, or jump back to the full library when the thread is ready.',
    }
  }

  if (activeFilterLabel) {
    return {
      title: 'This view is quiet',
      description: 'No notes match the current filter yet. Clear it, or create a note for this space.',
    }
  }

  if (quickFilter !== 'all') {
    const label = libraryQuickFilters.find((filter) => filter.id === quickFilter)?.label.toLowerCase() ?? 'notes'

    return {
      title: `No ${label} here`,
      description: 'Try another quick filter, or return to All when you want the full library back.',
    }
  }

  if (viewMode === 'favorites') {
    return {
      title: 'No favorites yet',
      description: 'Star the notes you return to often and they will gather here.',
    }
  }

  if (viewMode === 'archive') {
    return {
      title: 'Archive is empty',
      description: 'Archived notes will live here when you want them out of the main flow.',
    }
  }

  return {
    title: 'Start with one clear note',
    description: 'Create a note from the rail, import Markdown, or ask Composer for a first draft.',
  }
}

function NoteCard({
  note,
  foldersById,
  onOpenNote,
}: {
  note: Note
  foldersById: Record<string, Folder>
  onOpenNote: (noteId: string) => void
}) {
  const excerpt = summarizeBlocks(note.blocks)
  const folderPath = getFolderPathLabel(note.folderId, foldersById)
  const locationLabel = folderPath || collectionNameById[note.collectionId]
  const isCompact = note.layout === 'standard' && excerpt.length < 90
  const displayExcerpt =
    excerpt.length > 0 ? excerpt : note.status.toLowerCase() === 'draft' ? 'A fresh page waiting for a first line.' : ''

  return (
    <button
      type="button"
      className={`note-card note-card--${note.layout} ${note.type === 'quote' ? 'note-card--quote' : ''} ${isCompact ? 'note-card--compact' : ''} ${displayExcerpt.length === 0 ? 'note-card--bare' : ''}`}
      onClick={() => onOpenNote(note.id)}
    >
      <div className="note-card__top">
        <span className="badge">{note.status}</span>
        <span className="note-card__dateGroup">
          {note.isPinned && (
            <span className="note-card__pin" aria-label="Pinned note" title="Pinned note">
              <Icon name="pin" />
            </span>
          )}
          <span className="note-card__date">{note.previewDate}</span>
        </span>
      </div>

      {note.type === 'quote' ? (
        <>
          <div className="note-card__body note-card__body--quote">
            <div className="quote-mark">
              <Icon name="quote" />
            </div>
            <p className="quote-text">{excerpt}</p>
          </div>
          <div className="note-card__bottom">
            <span className="note-card__footer">{locationLabel}</span>
            <NoteTagSummary tags={note.tags} className="note-card__meta" />
          </div>
        </>
      ) : (
        <>
          <div className="note-card__body">
            <h2>{note.title}</h2>
            {displayExcerpt.length > 0 && <p className="note-card__excerpt">{displayExcerpt}</p>}
          </div>
          <div className="note-card__bottom">
            <span className="note-card__footer">{locationLabel}</span>
            <NoteTagSummary tags={note.tags} className="note-card__meta" />
          </div>
        </>
      )}
    </button>
  )
}

function NoteListItem({
  note,
  foldersById,
  onOpenNote,
}: {
  note: Note
  foldersById: Record<string, Folder>
  onOpenNote: (noteId: string) => void
}) {
  const excerpt = summarizeBlocks(note.blocks)
  const folderPath = getFolderPathLabel(note.folderId, foldersById)
  const locationLabel = folderPath || collectionNameById[note.collectionId]
  const wordCount = countWordsFromBlocks(note.blocks)
  const displayExcerpt =
    excerpt.length > 0 ? excerpt : note.status.toLowerCase() === 'draft' ? 'A fresh page waiting for a first line.' : ''

  return (
    <button type="button" className="note-list-item" onClick={() => onOpenNote(note.id)}>
      <div className="note-list-item__main">
        <div className="note-list-item__meta">
          <span className="badge">{note.status}</span>
          <span>{note.previewDate}</span>
          {note.isPinned && (
            <span className="note-list-item__pin" aria-label="Pinned note" title="Pinned note">
              <Icon name="pin" />
            </span>
          )}
        </div>
        <h3>{note.title}</h3>
        {displayExcerpt && <p>{displayExcerpt}</p>}
      </div>

      <div className="note-list-item__side">
        <span>{locationLabel}</span>
        <small>{`${formatCount(wordCount, 'word')} / ${formatCount(note.blocks.length, 'block')}`}</small>
        <NoteTagSummary tags={note.tags} className="note-list-item__tags" />
      </div>
    </button>
  )
}

function NoteTagSummary({ className, tags }: { className: string; tags: string[] }) {
  if (tags.length === 0) {
    return null
  }

  const visibleTags = tags.slice(0, 1)
  const hiddenTagCount = Math.max(tags.length - visibleTags.length, 0)

  return (
    <span className={className}>
      {visibleTags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
      {hiddenTagCount > 0 && <span>{`+${hiddenTagCount}`}</span>}
    </span>
  )
}

function Breadcrumbs({
  collectionId,
  folderId,
  foldersById,
  onOpenCollection,
  onOpenFolder,
}: {
  collectionId: CollectionId | null
  folderId: string | null
  foldersById: Record<string, Folder>
  onOpenCollection: (collectionId: CollectionId) => void
  onOpenFolder: (folderId: string) => void
}) {
  const trail = folderId ? getFolderTrail(folderId, foldersById) : []

  if (!collectionId && trail.length === 0) {
    return null
  }

  return (
    <nav className="breadcrumbs" aria-label="Folder path">
      {collectionId && (
        <button type="button" className="breadcrumbs__segment" onClick={() => onOpenCollection(collectionId)}>
          {collectionNameById[collectionId]}
        </button>
      )}

      {trail.map((folder) => (
        <div key={folder.id} className="breadcrumbs__node">
          <span className="breadcrumbs__separator">/</span>
          <button type="button" className="breadcrumbs__segment" onClick={() => onOpenFolder(folder.id)}>
            {folder.name}
          </button>
        </div>
      ))}
    </nav>
  )
}

function EditorSidebar({
  activeNoteId,
  caption,
  foldersById,
  headingLabel,
  notes,
  onOpenNote,
  title,
}: {
  activeNoteId: string | null
  caption: string
  foldersById: Record<string, Folder>
  headingLabel: string
  notes: Note[]
  onOpenNote: (noteId: string) => void
  title: string
}) {
  return (
    <aside className="note-sidebar">
      <div className="note-sidebar__header">
        <span className="note-sidebar__eyebrow">{headingLabel}</span>
        <h2>{title}</h2>
        <p>{caption}</p>
      </div>

      <div className="note-sidebar__list">
        {notes.length === 0 ? (
          <div className="note-sidebar__empty">No notes in this view yet.</div>
        ) : (
          notes.map((note) => {
            const location = getFolderPathLabel(note.folderId, foldersById) || collectionNameById[note.collectionId]

            return (
              <button
                key={note.id}
                type="button"
                className={`note-sidebar__item ${note.id === activeNoteId ? 'note-sidebar__item--active' : ''}`}
                onClick={() => onOpenNote(note.id)}
              >
                <div className="note-sidebar__metaRow">
                  <span className="note-sidebar__status">{note.status}</span>
                  <span>{note.previewDate}</span>
                </div>
                <h3>{note.title}</h3>
                <p>{summarizeBlocks(note.blocks)}</p>
                <span className="note-sidebar__collection">{location}</span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}

function FolderInspector({
  activeFolder,
  folders,
  foldersById,
  onDeleteFolder,
  onMoveFolder,
  onRenameFolder,
}: {
  activeFolder: Folder | null
  folders: Folder[]
  foldersById: Record<string, Folder>
  onDeleteFolder: (folderId: string) => void
  onMoveFolder: (folderId: string, nextCollectionId: CollectionId, nextParentId: string | null) => void
  onRenameFolder: (folderId: string, nextName: string) => void
}) {
  const [draftName, setDraftName] = useState(activeFolder?.name ?? '')

  useEffect(() => {
    setDraftName(activeFolder?.name ?? '')
  }, [activeFolder?.id, activeFolder?.name])

  const parentOptions = useMemo(() => {
    if (!activeFolder) {
      return []
    }

    const invalidIds = new Set([activeFolder.id, ...getDescendantFolderIds(activeFolder.id, folders)])

    return folders
      .filter(
        (folder) =>
          folder.collectionId === activeFolder.collectionId && !invalidIds.has(folder.id),
      )
      .sort((left, right) =>
        getFolderPathLabel(left.id, foldersById).localeCompare(getFolderPathLabel(right.id, foldersById)),
      )
      .map((folder) => ({
        value: folder.id,
        label: getFolderPathLabel(folder.id, foldersById),
      }))
  }, [activeFolder, folders, foldersById])

  if (!activeFolder) {
    return (
      <section className="folder-inspector">
        <div className="panel-header">
          <div>
            <h1>Selected Folder</h1>
            <p>Choose a folder to rename it, move it, or delete it safely.</p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="folder-inspector">
      <div className="panel-header">
        <div>
          <h1>Selected Folder</h1>
          <p>Rename, reposition, or remove this branch without losing descendants.</p>
        </div>
      </div>

      <div className="folder-inspector__form">
        <label className="meta-field">
          <span>Name</span>
          <input
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={() => onRenameFolder(activeFolder.id, draftName)}
            placeholder="Folder name"
          />
        </label>

        <label className="meta-field">
          <span>Collection</span>
          <select
            value={activeFolder.collectionId}
            onChange={(event) => onMoveFolder(activeFolder.id, event.target.value as CollectionId, null)}
          >
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </label>

        <label className="meta-field">
          <span>Parent Folder</span>
          <select
            value={activeFolder.parentId ?? ''}
            onChange={(event) =>
              onMoveFolder(activeFolder.id, activeFolder.collectionId, event.target.value || null)
            }
          >
            <option value="">No parent</option>
            {parentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="folder-inspector__path">
          <span>Current Path</span>
          <strong>{getFolderPathLabel(activeFolder.id, foldersById)}</strong>
        </div>

        <button
          type="button"
          className="danger-button"
          onClick={() => onDeleteFolder(activeFolder.id)}
        >
          Delete Folder
        </button>
      </div>
    </section>
  )
}

function CollectionsScreen({
  activeCollectionId,
  activeFolder,
  activeFolderId,
  collectionCounts,
  collections,
  expandedFolderIds,
  folders,
  foldersById,
  notes,
  onCreateFolder,
  onDeleteFolder,
  onDeleteTag,
  onOpenCollection,
  onOpenFolder,
  onOpenTag,
  onRenameFolder,
  onRequestRenameFolder,
  onToggleFolderExpanded,
  onMoveFolder,
  tags,
}: {
  activeCollectionId: CollectionId | null
  activeFolder: Folder | null
  activeFolderId: string | null
  collectionCounts: Record<CollectionId, number>
  collections: CollectionSummary[]
  expandedFolderIds: string[]
  folders: Folder[]
  foldersById: Record<string, Folder>
  notes: Note[]
  onCreateFolder: (collectionId: CollectionId, parentId: string | null) => void
  onDeleteFolder: (folderId: string) => void
  onDeleteTag: (tagName: string) => void
  onOpenCollection: (collectionId: CollectionId) => void
  onOpenFolder: (folderId: string) => void
  onOpenTag: (tagName: string) => void
  onRenameFolder: (folderId: string, nextName: string) => void
  onRequestRenameFolder: (folderId: string) => void
  onToggleFolderExpanded: (folderId: string) => void
  onMoveFolder: (folderId: string, nextCollectionId: CollectionId, nextParentId: string | null) => void
  tags: Array<{ name: string; count: number }>
}) {
  const [showAllTags, setShowAllTags] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const deferredTagQuery = useDeferredValue(tagQuery)
  const sortedTags = useMemo(
    () =>
      [...tags].sort(
        (left, right) => right.count - left.count || left.name.localeCompare(right.name),
      ),
    [tags],
  )
  const normalizedTagQuery = deferredTagQuery.trim().toLowerCase()
  const filteredTags = useMemo(() => {
    if (!normalizedTagQuery) {
      return sortedTags
    }

    return sortedTags.filter((tag) => tag.name.toLowerCase().includes(normalizedTagQuery))
  }, [normalizedTagQuery, sortedTags])
  const tagPreviewLimit = 8
  const visibleTags = showAllTags ? filteredTags : filteredTags.slice(0, tagPreviewLimit)
  const hiddenTagCount = Math.max(filteredTags.length - visibleTags.length, 0)

  return (
    <section className="collections-screen">
      <div className="collections-panel">
        <div className="panel-header">
          <div>
            <h1>Collections & Folders</h1>
            <p>Nested structure for projects, journals, research, and ideas.</p>

            {(activeCollectionId || activeFolderId) && (
              <Breadcrumbs
                collectionId={activeCollectionId}
                folderId={activeFolderId}
                foldersById={foldersById}
                onOpenCollection={onOpenCollection}
                onOpenFolder={onOpenFolder}
              />
            )}
          </div>
        </div>

        <div className="section-divider" />

        <div className="collections-grid">
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              className={`collection-card ${activeCollectionId === collection.id ? 'collection-card--active' : ''}`}
              onClick={() => onOpenCollection(collection.id)}
            >
              <div className="collection-card__top">
                <span className="collection-card__icon">
                  <CollectionGlyph icon={collection.icon} />
                </span>
                <span className="count-pill">{collectionCounts[collection.id]} notes</span>
              </div>
              <h2>{collection.name}</h2>
              <p>{collection.description}</p>
            </button>
          ))}
        </div>

        <div className="section-divider" />

        <div className="folder-sections">
          {collections.map((collection) => (
            <FolderSection
              key={collection.id}
              activeFolderId={activeFolderId}
              collection={collection}
              expandedFolderIds={expandedFolderIds}
              folders={folders}
              foldersById={foldersById}
              notes={notes}
              onCreateFolder={onCreateFolder}
              onDeleteFolder={onDeleteFolder}
              onOpenCollection={onOpenCollection}
              onOpenFolder={onOpenFolder}
              onRenameFolder={onRenameFolder}
              onRequestRenameFolder={onRequestRenameFolder}
              onToggleFolderExpanded={onToggleFolderExpanded}
            />
          ))}
        </div>
      </div>

      <aside className="tags-panel">
        <FolderInspector
          activeFolder={activeFolder}
          folders={folders}
          foldersById={foldersById}
          onDeleteFolder={onDeleteFolder}
          onMoveFolder={onMoveFolder}
          onRenameFolder={onRenameFolder}
        />

        <section className="tags-panel__section">
          <div className="panel-header">
            <div>
              <h1>Tags</h1>
              <p>Cross-cutting themes that move across folders.</p>
            </div>
          </div>

          <div className="section-divider" />

          {sortedTags.length > 0 && (
            <div className="tag-list-toolbar">
              <div className="tag-list-toolbar__summary">
                <span className="tag-list-toolbar__eyebrow">Top topics</span>
                <span>
                  {showAllTags
                    ? `Showing ${formatCount(filteredTags.length, 'topic')}`
                    : `Showing ${formatCount(visibleTags.length, 'topic')}`}
                </span>
                {normalizedTagQuery && (
                  <span className="tag-list-toolbar__filter">Filtered by “{tagQuery.trim()}”</span>
                )}
                {!showAllTags && hiddenTagCount > 0 && (
                  <span className="tag-list-toolbar__more">+{hiddenTagCount} more</span>
                )}
              </div>

              {sortedTags.length > tagPreviewLimit && (
                <button
                  type="button"
                  className="tag-list-toolbar__toggle"
                  onClick={() => setShowAllTags((currentValue) => !currentValue)}
                  aria-expanded={showAllTags}
                >
                  {showAllTags ? 'Show less' : 'Show all tags'}
                </button>
              )}
            </div>
          )}

          {sortedTags.length > tagPreviewLimit && (
            <label className="tag-list-search" htmlFor="tag-browser-search">
              <Icon name="search" />
              <input
                id="tag-browser-search"
                type="search"
                value={tagQuery}
                onChange={(event) => setTagQuery(event.target.value)}
                placeholder="Search topics"
                autoComplete="off"
                spellCheck={false}
              />
              {tagQuery.trim() && (
                <button
                  type="button"
                  className="tag-list-search__clear"
                  onClick={() => setTagQuery('')}
                  aria-label="Clear topic search"
                >
                  <Icon name="close" />
                </button>
              )}
            </label>
          )}

          <div className={`tag-list ${showAllTags ? 'tag-list--expanded' : ''}`}>
            {visibleTags.map((tag) => (
              <div key={tag.name} className="tag-row">
                <button type="button" className="tag-row__main" onClick={() => onOpenTag(tag.name)}>
                  <span className="tag-row__name">
                    <Icon name="hash" />
                    <span>{tag.name}</span>
                  </span>
                  <span className="tag-row__count">{tag.count}</span>
                </button>
                <button
                  type="button"
                  className="tag-row__delete"
                  onClick={() => onDeleteTag(tag.name)}
                  aria-label={`Delete topic ${tag.name}`}
                  title="Delete topic"
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>

          {filteredTags.length === 0 && (
            <div className="tag-list-empty">
              <strong>No matching topics</strong>
              <span>Try a broader keyword or clear the filter to see the full field.</span>
            </div>
          )}

          {!showAllTags && hiddenTagCount > 0 && (
            <button
              type="button"
              className="tag-list-more-card"
              onClick={() => setShowAllTags(true)}
            >
              <span className="tag-list-more-card__count">+{hiddenTagCount}</span>
              <span className="tag-list-more-card__label">Reveal the rest of the topic field</span>
            </button>
          )}
        </section>
      </aside>
    </section>
  )
}

function FolderSection({
  activeFolderId,
  collection,
  expandedFolderIds,
  folders,
  foldersById,
  notes,
  onCreateFolder,
  onDeleteFolder,
  onOpenCollection,
  onOpenFolder,
  onRenameFolder,
  onRequestRenameFolder,
  onToggleFolderExpanded,
}: {
  activeFolderId: string | null
  collection: CollectionSummary
  expandedFolderIds: string[]
  folders: Folder[]
  foldersById: Record<string, Folder>
  notes: Note[]
  onCreateFolder: (collectionId: CollectionId, parentId: string | null) => void
  onDeleteFolder: (folderId: string) => void
  onOpenCollection: (collectionId: CollectionId) => void
  onOpenFolder: (folderId: string) => void
  onRenameFolder: (folderId: string, nextName: string) => void
  onRequestRenameFolder: (folderId: string) => void
  onToggleFolderExpanded: (folderId: string) => void
}) {
  const rootFolders = folders.filter(
    (folder) => folder.collectionId === collection.id && folder.parentId === null,
  )

  return (
    <section className="folder-section">
      <div className="folder-section__header">
        <button type="button" className="folder-section__collection" onClick={() => onOpenCollection(collection.id)}>
          <span>{collection.name}</span>
          <span>{collection.description}</span>
        </button>
        <button
          type="button"
          className="folder-section__add"
          onClick={() => onCreateFolder(collection.id, null)}
          aria-label={`Add folder to ${collection.name}`}
        >
          <Icon name="plus" />
        </button>
      </div>

      <div className="folder-tree">
        {rootFolders.map((folder) => (
          <FolderBranch
            key={folder.id}
            activeFolderId={activeFolderId}
            depth={0}
            expandedFolderIds={expandedFolderIds}
            folder={folder}
            folders={folders}
            foldersById={foldersById}
            notes={notes}
            onCreateFolder={onCreateFolder}
            onDeleteFolder={onDeleteFolder}
            onOpenFolder={onOpenFolder}
            onRenameFolder={onRenameFolder}
            onRequestRenameFolder={onRequestRenameFolder}
            onToggleFolderExpanded={onToggleFolderExpanded}
          />
        ))}
      </div>
    </section>
  )
}

function FolderBranch({
  activeFolderId,
  depth,
  expandedFolderIds,
  folder,
  folders,
  foldersById,
  notes,
  onCreateFolder,
  onDeleteFolder,
  onOpenFolder,
  onRenameFolder,
  onRequestRenameFolder,
  onToggleFolderExpanded,
}: {
  activeFolderId: string | null
  depth: number
  expandedFolderIds: string[]
  folder: Folder
  folders: Folder[]
  foldersById: Record<string, Folder>
  notes: Note[]
  onCreateFolder: (collectionId: CollectionId, parentId: string | null) => void
  onDeleteFolder: (folderId: string) => void
  onOpenFolder: (folderId: string) => void
  onRenameFolder: (folderId: string, nextName: string) => void
  onRequestRenameFolder: (folderId: string) => void
  onToggleFolderExpanded: (folderId: string) => void
}) {
  const children = folders.filter((candidate) => candidate.parentId === folder.id)
  const isExpanded = expandedFolderIds.includes(folder.id)
  const branchCount = notes.filter(
    (note) => !note.isArchived && isNoteInFolderBranch(note.folderId, folder.id, foldersById),
  ).length

  return (
    <div className="folder-branch">
      <div className={`folder-row ${activeFolderId === folder.id ? 'folder-row--active' : ''}`} style={{ paddingLeft: `${depth * 18}px` }}>
        {children.length > 0 ? (
          <button
            type="button"
            className="folder-row__toggle"
            onClick={() => onToggleFolderExpanded(folder.id)}
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          >
            <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} />
          </button>
        ) : (
          <span className="folder-row__spacer" />
        )}

        <button type="button" className="folder-row__main" onClick={() => onOpenFolder(folder.id)}>
          <Icon name={isExpanded ? 'folderOpen' : 'folder'} />
          <span>{folder.name}</span>
        </button>

        <span className="folder-row__count">{branchCount}</span>

        <button
          type="button"
          className="folder-row__add"
          onClick={() => onCreateFolder(folder.collectionId, folder.id)}
          aria-label={`Add child folder to ${folder.name}`}
        >
          <Icon name="plus" />
        </button>

        <button
          type="button"
          className="folder-row__rename"
          onClick={() => onRequestRenameFolder(folder.id)}
          aria-label={`Rename folder ${folder.name}`}
          title="Rename folder"
        >
          <Icon name="edit" />
        </button>

        <button
          type="button"
          className="folder-row__delete"
          onClick={() => onDeleteFolder(folder.id)}
          aria-label={`Delete folder ${folder.name}`}
          title="Delete folder"
        >
          <Icon name="trash" />
        </button>
      </div>

      {children.length > 0 && isExpanded && (
        <div className="folder-row__children">
          {children.map((childFolder) => (
            <FolderBranch
              key={childFolder.id}
              activeFolderId={activeFolderId}
              depth={depth + 1}
              expandedFolderIds={expandedFolderIds}
              folder={childFolder}
              folders={folders}
              foldersById={foldersById}
              notes={notes}
              onCreateFolder={onCreateFolder}
              onDeleteFolder={onDeleteFolder}
              onOpenFolder={onOpenFolder}
              onRenameFolder={onRenameFolder}
              onRequestRenameFolder={onRequestRenameFolder}
              onToggleFolderExpanded={onToggleFolderExpanded}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BlockRow({
  block,
  canMoveDown,
  canMoveUp,
  focusRequest,
  isActive,
  linkMenu,
  onAddBelow,
  onFocusRequestHandled,
  onChangeCitation,
  onChangeText,
  onChangeType,
  onFocus,
  onKeyDown,
  onLinkSelect,
  onMoveDown,
  onMoveUp,
  onRemove,
  onSlashSelect,
  slashMenu,
}: {
  block: NoteBlock
  canMoveDown: boolean
  canMoveUp: boolean
  focusRequest: BlockFocusRequest | null
  isActive: boolean
  linkMenu: { activeIndex: number; notes: Note[]; query: string } | null
  onAddBelow: () => void
  onFocusRequestHandled: () => void
  onChangeCitation: (value: string) => void
  onChangeText: (value: string, selectionStart: number | null) => void
  onChangeType: (nextType: BlockType) => void
  onFocus: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onLinkSelect: (note: Note) => void
  onMoveDown: () => void
  onMoveUp: () => void
  onRemove: () => void
  onSlashSelect: (type: BlockType) => void
  slashMenu: { activeIndex: number; items: SlashMenuItem[]; query: string } | null
}) {
  const blockValue = getBlockTextValue(block)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [selectionRange, setSelectionRange] = useState<TextSelectionRange | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    textarea.style.height = '0px'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [block.type, blockValue])

  useEffect(() => {
    if (!focusRequest || focusRequest.blockId !== block.id) {
      return
    }

    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    textarea.focus()
    const nextPosition =
      focusRequest.placement === 'start'
        ? 0
        : focusRequest.placement === 'end'
          ? textarea.value.length
          : Math.min(focusRequest.placement, textarea.value.length)
    textarea.setSelectionRange(nextPosition, nextPosition)
    onFocus()
    onFocusRequestHandled()
  }, [block.id, focusRequest, onFocus, onFocusRequestHandled])

  const updateSelectionRange = () => {
    const textarea = textareaRef.current

    if (!textarea || document.activeElement !== textarea) {
      setSelectionRange(null)
      return
    }

    const nextRange = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    }

    setSelectionRange(nextRange.end > nextRange.start ? nextRange : null)
  }

  const applyInlineFormat = (format: InlineFormat) => {
    const textarea = textareaRef.current
    const range = selectionRange

    if (!textarea || !range || range.end <= range.start) {
      return
    }

    const nextValue = applyInlineFormatToText(textarea.value, range, format)
    onChangeText(nextValue.value, nextValue.selectionStart)

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextValue.selectionStart, nextValue.selectionEnd)
      updateSelectionRange()
    })
  }

  const showInlineToolbar = Boolean(selectionRange && block.type !== 'code')

  return (
    <div className={`block-row block-row--${block.type} ${isActive ? 'block-row--active' : ''}`}>
      <div className="block-row__controls">
        <label className="block-row__kind">
          <span>Type</span>
          <select value={block.type} onChange={(event) => onChangeType(event.target.value as BlockType)} onFocus={onFocus}>
            <option value="paragraph">Paragraph</option>
            <option value="heading">Heading</option>
            <option value="quote">Quote</option>
            <option value="bullet-list">Bullet list</option>
            <option value="code">Code</option>
          </select>
        </label>

        <div className="block-row__actions">
          <button
            type="button"
            className="block-row__action"
            onClick={onMoveUp}
            onMouseDown={preventButtonFocus}
            aria-label="Move block up"
            disabled={!canMoveUp}
          >
            <Icon name="chevronUp" />
          </button>
          <button
            type="button"
            className="block-row__action"
            onClick={onMoveDown}
            onMouseDown={preventButtonFocus}
            aria-label="Move block down"
            disabled={!canMoveDown}
          >
            <Icon name="chevronDown" />
          </button>
          <button
            type="button"
            className="block-row__action"
            onClick={onAddBelow}
            onMouseDown={preventButtonFocus}
            aria-label="Add block below"
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            className="block-row__action"
            onClick={onRemove}
            onMouseDown={preventButtonFocus}
            aria-label="Remove block"
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>

      <div className="block-row__content">
        {showInlineToolbar && (
          <InlineFormatToolbar onApplyFormat={applyInlineFormat} />
        )}

        <textarea
          ref={textareaRef}
          className={`block-input block-input--${block.type}`}
          value={blockValue}
          onChange={(event) => onChangeText(event.target.value, event.target.selectionStart)}
          onFocus={() => {
            onFocus()
            updateSelectionRange()
          }}
          onKeyDown={onKeyDown}
          onKeyUp={updateSelectionRange}
          onMouseUp={updateSelectionRange}
          onSelect={updateSelectionRange}
          placeholder={getBlockPlaceholder(block.type)}
          rows={getBlockRows(block)}
        />

        {slashMenu && (
          <div className="slash-menu" role="listbox" aria-label="Block commands">
            {slashMenu.items.length > 0 ? (
              slashMenu.items.map((item, index) => (
                <button
                  key={item.type}
                  type="button"
                  className={`slash-menu__item ${index === slashMenu.activeIndex ? 'slash-menu__item--active' : ''}`}
                  onClick={() => onSlashSelect(item.type)}
                  onMouseDown={preventButtonFocus}
                  role="option"
                  aria-selected={index === slashMenu.activeIndex}
                >
                  <span className="slash-menu__title">{item.title}</span>
                  <span className="slash-menu__description">{item.description}</span>
                </button>
              ))
            ) : (
              <p className="slash-menu__empty">{`No block commands match "${slashMenu.query}".`}</p>
            )}
          </div>
        )}

        {linkMenu && (
          <div className="link-menu" role="listbox" aria-label="Linked notes">
            {linkMenu.notes.length > 0 ? (
              linkMenu.notes.map((note, index) => (
                <button
                  key={note.id}
                  type="button"
                  className={`link-menu__item ${index === linkMenu.activeIndex ? 'link-menu__item--active' : ''}`}
                  onClick={() => onLinkSelect(note)}
                  onMouseDown={preventButtonFocus}
                  role="option"
                  aria-selected={index === linkMenu.activeIndex}
                >
                  <span className="link-menu__title">{note.title}</span>
                  <span className="link-menu__description">
                    {note.status} · {collectionNameById[note.collectionId]}
                  </span>
                </button>
              ))
            ) : (
              <p className="link-menu__empty">{`No notes match "${linkMenu.query}".`}</p>
            )}
          </div>
        )}

        {block.type === 'quote' && (
          <input
            className="block-input block-input--citation"
            value={block.citation ?? ''}
            onChange={(event) => onChangeCitation(event.target.value)}
            onFocus={onFocus}
            placeholder="Attribution"
          />
        )}

        {block.type === 'bullet-list' && (
          <p className="block-row__hint">One bullet per line.</p>
        )}
      </div>
    </div>
  )
}

function InlineFormatToolbar({ onApplyFormat }: { onApplyFormat: (format: InlineFormat) => void }) {
  return (
    <div className="inline-format-toolbar" role="toolbar" aria-label="Inline formatting">
      <button type="button" onMouseDown={preventButtonFocus} onClick={() => onApplyFormat('bold')} aria-label="Bold">
        <strong>B</strong>
      </button>
      <button type="button" onMouseDown={preventButtonFocus} onClick={() => onApplyFormat('italic')} aria-label="Italic">
        <em>I</em>
      </button>
      <button type="button" onMouseDown={preventButtonFocus} onClick={() => onApplyFormat('underline')} aria-label="Underline">
        <span className="inline-format-toolbar__underline">U</span>
      </button>
      <button type="button" onMouseDown={preventButtonFocus} onClick={() => onApplyFormat('code')} aria-label="Inline code">
        <span>{'`'}</span>
      </button>
      <button type="button" onMouseDown={preventButtonFocus} onClick={() => onApplyFormat('link')} aria-label="Link">
        <Icon name="link" />
      </button>
    </div>
  )
}

function EditorContextPanel({
  activeCollectionOptions,
  activeFolderOptions,
  note,
  onAddSource,
  onAddTag,
  onCollectionChange,
  onDeleteSource,
  onFolderChange,
  onOpenTag,
  onRemoveTag,
  onUpdateSource,
}: {
  activeCollectionOptions: Array<{ label: string; value: CollectionId }>
  activeFolderOptions: Array<{ label: string; value: string }>
  note: Note
  onAddSource: () => void
  onAddTag: () => void
  onCollectionChange: (event: ChangeEvent<HTMLSelectElement>) => void
  onDeleteSource: (sourceId: string) => void
  onFolderChange: (event: ChangeEvent<HTMLSelectElement>) => void
  onOpenTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onUpdateSource: (sourceId: string, changes: Partial<NoteSource>) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [openSections, setOpenSections] = useState<Record<EditorContextSectionId, boolean>>({
    details: true,
    sources: false,
    topics: false,
  })
  const collectionLabel = collectionNameById[note.collectionId]
  const folderLabel = activeFolderOptions.find((option) => option.value === note.folderId)?.label ?? 'No folder'
  const hasSources = note.sources.length > 0
  const topicSummary = note.tags.length > 0 ? formatCount(note.tags.length, 'topic') : 'No topics'
  const sourceSummary = hasSources ? formatCount(note.sources.length, 'source') : 'No sources'

  const toggleSection = (sectionId: EditorContextSectionId) => {
    setOpenSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId],
    }))
  }

  return (
    <section className={`editor-context ${isExpanded ? 'editor-context--expanded' : 'editor-context--collapsed'}`} aria-label="Note context">
      <button
        type="button"
        className="editor-context__toggle"
        onClick={() => setIsExpanded((currentValue) => !currentValue)}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Hide' : 'Show'} note context`}
      >
        <span className="editor-context__toggleMain">
          <span>Note context</span>
          <strong>{`${collectionLabel} / ${folderLabel}`}</strong>
        </span>
        <span className="editor-context__summary" aria-hidden="true">
          <span className="badge">{note.status}</span>
          <span>{note.previewDate}</span>
          {note.isPinned && <span>Pinned</span>}
          {note.isFavorite && <span>Favorited</span>}
          <span>{topicSummary}</span>
          <span>{sourceSummary}</span>
        </span>
        <span className="editor-context__toggleAction">{isExpanded ? 'Hide' : 'Show'}</span>
      </button>

      {isExpanded && (
        <div className="editor-context__sections">
          <section className="editor-context__section" data-open={openSections.details}>
            <button
              type="button"
              className="editor-context__sectionToggle"
              onClick={() => toggleSection('details')}
              aria-expanded={openSections.details}
            >
              <span>Location</span>
              <small>{`${collectionLabel} / ${folderLabel}`}</small>
            </button>
            {openSections.details && (
              <div className="editor-context__body editor-context__body--location">
                <div className="editor-location-grid">
                  <label className="meta-field">
                    <span>Collection</span>
                    <select value={note.collectionId} onChange={onCollectionChange}>
                      {activeCollectionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="meta-field">
                    <span>Folder</span>
                    <select value={note.folderId ?? ''} onChange={onFolderChange}>
                      <option value="">No folder</option>
                      {activeFolderOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </section>

          <section className="editor-context__section" data-open={openSections.topics}>
            <button
              type="button"
              className="editor-context__sectionToggle"
              onClick={() => toggleSection('topics')}
              aria-expanded={openSections.topics}
            >
              <span>Topics</span>
              <small>{topicSummary}</small>
            </button>
            {openSections.topics && (
              <div className="editor-context__body">
                <div className="editor-tags">
                  {note.tags.map((tag) => (
                    <span key={tag} className="chip chip--editable">
                      <button type="button" className="chip__label" onClick={() => onOpenTag(tag)}>
                        {tag}
                      </button>
                      <button
                        type="button"
                        className="chip__remove"
                        onClick={() => onRemoveTag(tag)}
                        aria-label={`Remove ${tag} from this note`}
                      >
                        <Icon name="close" />
                      </button>
                    </span>
                  ))}
                  {note.tags.length === 0 && <span className="editor-tags__empty">No topics yet</span>}
                  <button type="button" className="tag-add tag-add--inline" onClick={onAddTag} aria-label="Add tag">
                    <Icon name="plus" />
                    <span>Add topic</span>
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="editor-context__section" data-open={openSections.sources}>
            <button
              type="button"
              className="editor-context__sectionToggle"
              onClick={() => toggleSection('sources')}
              aria-expanded={openSections.sources}
            >
              <span>Sources</span>
              <small>{sourceSummary}</small>
            </button>
            {openSections.sources && (
              <div className="editor-context__body">
                <SourceCardsEditor
                  showHeader={false}
                  sources={note.sources}
                  onAddSource={onAddSource}
                  onDeleteSource={onDeleteSource}
                  onUpdateSource={onUpdateSource}
                />
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function SourceCardsEditor({
  showHeader = true,
  sources,
  onAddSource,
  onDeleteSource,
  onUpdateSource,
}: {
  showHeader?: boolean
  sources: NoteSource[]
  onAddSource: () => void
  onDeleteSource: (sourceId: string) => void
  onUpdateSource: (sourceId: string, changes: Partial<NoteSource>) => void
}) {
  return (
    <section className="source-cards source-cards--editor" aria-label="Research source cards">
      {showHeader ? (
        <div className="source-cards__header">
          <div>
            <span>Sources</span>
            <strong>{sources.length > 0 ? formatCount(sources.length, 'reference') : 'No sources yet'}</strong>
          </div>
          <button type="button" className="utility-button" onClick={onAddSource}>
            <Icon name="plus" />
            <span>Add source</span>
          </button>
        </div>
      ) : (
        <div className="source-cards__compactActions">
          <div>
            <span>Reference shelf</span>
            <strong>{sources.length > 0 ? formatCount(sources.length, 'source') : 'No sources yet'}</strong>
          </div>
          <button type="button" className="utility-button utility-button--accent" onClick={onAddSource}>
            <Icon name="plus" />
            <span>Add source</span>
          </button>
        </div>
      )}

      {sources.length > 0 ? (
        <div className="source-cards__grid">
          {sources.map((source) => (
            <article key={source.id} className="source-card source-card--editable">
              <div className="source-card__top source-card__top--editable">
                <label className="source-field source-field--type">
                  <span>Type</span>
                  <select
                    value={source.sourceType}
                    onChange={(event) =>
                      onUpdateSource(source.id, {
                        sourceType: event.target.value as NoteSourceKind,
                      })
                    }
                  >
                    {sourceTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="source-field source-field--title">
                  <span>Title</span>
                  <input
                    value={source.title}
                    onChange={(event) => onUpdateSource(source.id, { title: event.target.value })}
                    placeholder="Paper, article, book, dataset..."
                  />
                </label>

                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => onDeleteSource(source.id)}
                  aria-label={`Delete source ${source.title || 'Untitled source'}`}
                  title="Delete source"
                >
                  <Icon name="trash" />
                </button>
              </div>

              <div className="source-card__columns source-card__columns--compact">
                <label className="source-field">
                  <span>Author</span>
                  <input
                    value={source.author}
                    onChange={(event) => onUpdateSource(source.id, { author: event.target.value })}
                    placeholder="Author"
                  />
                </label>
                <label className="source-field">
                  <span>Year</span>
                  <input
                    value={source.year}
                    onChange={(event) => onUpdateSource(source.id, { year: event.target.value })}
                    placeholder="2026"
                  />
                </label>
                <label className="source-field">
                  <span>Publication / Journal</span>
                  <input
                    value={source.publisher}
                    onChange={(event) => onUpdateSource(source.id, { publisher: event.target.value })}
                    placeholder="Journal, publisher, archive, course..."
                  />
                </label>
              </div>

              <label className="source-field source-field--wide">
                <span>URL / DOI</span>
                <input
                  value={source.url}
                  onChange={(event) => onUpdateSource(source.id, { url: event.target.value })}
                  placeholder="https:// or doi:"
                />
              </label>

              <label className="source-field source-field--wide">
                <span>Research note</span>
                <textarea
                  value={source.note}
                  onChange={(event) => onUpdateSource(source.id, { note: event.target.value })}
                  placeholder="Why this source matters, caveats, useful pages..."
                  rows={2}
                />
              </label>
            </article>
          ))}
        </div>
      ) : (
        <p className="source-cards__empty">
          Add books, papers, URLs, datasets, or interviews that support this note.
        </p>
      )}
    </section>
  )
}

function SourceReferences({ sources }: { sources: NoteSource[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const visibleSources = sources.filter((source) => hasSourceContent(source))

  if (visibleSources.length === 0) {
    return null
  }

  return (
    <section className={`source-cards source-cards--reader ${isExpanded ? 'source-cards--readerExpanded' : ''}`} aria-label="Research sources">
      <button
        type="button"
        className="source-cards__readerToggle"
        onClick={() => setIsExpanded((currentValue) => !currentValue)}
        aria-expanded={isExpanded}
      >
        <div>
          <span>Sources</span>
          <strong>{formatCount(visibleSources.length, 'reference')}</strong>
        </div>
        <span className="source-cards__readerHint">
          {isExpanded ? 'Hide' : 'View'}
        </span>
      </button>

      {isExpanded && (
        <div className="source-cards__grid">
          {visibleSources.map((source) => (
            <article key={source.id} className="source-card source-card--compact">
              <div className="source-card__readerTop">
                <span className="badge badge--soft">{formatSourceTypeLabel(source.sourceType)}</span>
                {source.year && <span>{source.year}</span>}
              </div>
              <h3>{source.title || 'Untitled source'}</h3>
              <p className="source-card__byline">{formatSourceByline(source)}</p>
              <div className="source-card__compactBottom">
                {source.note ? <p className="source-card__note">{source.note}</p> : <span />}
                {source.url && (
                  <a className="source-card__link source-card__link--icon" href={source.url} target="_blank" rel="noreferrer" aria-label={`Open source ${source.title || 'Untitled source'}`}>
                    <Icon name="link" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function FocusModeBar({
  mode,
  onExit,
  onModeChange,
  progress,
  wordCount,
}: {
  mode: NoteViewMode
  onExit: () => void
  onModeChange: (mode: NoteViewMode) => void
  progress: number
  wordCount: number
}) {
  return (
    <div
      className="focus-mode-bar"
      style={{ '--reading-progress': `${progress}%` } as CSSProperties}
      aria-label="Focus mode controls"
    >
      <div className="focus-mode-bar__progress" aria-hidden="true">
        <span />
      </div>

      <div className="focus-mode-bar__state">
        <Icon name="focus" />
        <div className="focus-mode-bar__stateCopy">
          <span>Focus Mode</span>
          <strong>{mode === 'read' ? 'Reading view' : 'Writing view'}</strong>
        </div>
      </div>

      <div className="focus-mode-bar__actions">
        <span className="focus-mode-bar__meta">{`${progress}% read / ${wordCount} words`}</span>
        <ModeToggle mode={mode} onChange={onModeChange} />
        <button type="button" className="utility-button" onClick={onExit} title="Exit Focus Mode (Esc)">
          <Icon name="close" />
          <span>Exit</span>
        </button>
      </div>
    </div>
  )
}

function ReadModeNote({
  backlinks,
  composerAvailable,
  explorationAwake,
  foldersById,
  isFocusMode,
  linkedNotes,
  note,
  notesByNormalizedTitle,
  onExplore,
  onOpenTag,
  onOpenNote,
  pendingExplorationAction,
  wordCount,
}: {
  backlinks: Note[]
  composerAvailable: boolean
  explorationAwake: boolean
  foldersById: Record<string, Folder>
  isFocusMode: boolean
  linkedNotes: Note[]
  note: Note
  notesByNormalizedTitle: Record<string, Note>
  onExplore: (action: ReaderExplorationAction) => void
  onOpenTag: (tagName: string) => void
  onOpenNote: (noteId: string) => void
  pendingExplorationAction: ReaderExplorationAction | null
  wordCount: number
}) {
  const folderPath = getFolderPathLabel(note.folderId, foldersById)
  const locationLabel = [collectionNameById[note.collectionId], folderPath].filter(Boolean).join(' / ')
  const visibleTags = note.tags.slice(0, 2)
  const hiddenTagCount = Math.max(note.tags.length - visibleTags.length, 0)

  return (
    <div className={`reader-column ${isFocusMode ? 'reader-column--focus' : ''}`}>
      <header className="reader-header">
        {!isFocusMode && (
          <div className="reader-kicker" aria-label="Note details">
            {locationLabel && <span>{locationLabel}</span>}
            <span>{note.status}</span>
            <span>{note.previewDate}</span>
            {note.isPinned && <span>Pinned</span>}
            {note.isFavorite && <span>Favorited</span>}
          </div>
        )}
        <h1 className="reader-title">{note.title}</h1>
        {!isFocusMode && note.tags.length > 0 && (
          <div className="reader-topics" aria-label="Topics">
            <span>Topics</span>
            {visibleTags.map((tag) => (
              <button key={tag} type="button" className="reader-topic" onClick={() => onOpenTag(tag)}>
                {tag}
              </button>
            ))}
            {hiddenTagCount > 0 && <span className="reader-topic reader-topic--count">{`+${hiddenTagCount}`}</span>}
          </div>
        )}
      </header>

      <article className="reader-content">
        {note.blocks.map((block) => (
          <ReadBlock key={block.id} block={block} notesByNormalizedTitle={notesByNormalizedTitle} onOpenNote={onOpenNote} />
        ))}
      </article>

      <SourceReferences sources={note.sources} />

      {!isFocusMode && <NoteConnections backlinks={backlinks} linkedNotes={linkedNotes} onOpenNote={onOpenNote} />}

      <ReaderExplorationPanel
        composerAvailable={composerAvailable}
        isAwake={explorationAwake}
        onExplore={onExplore}
        pendingAction={pendingExplorationAction}
      />

      <footer className="reader-footer">
        <span>{`${wordCount} words / ${note.blocks.length} blocks`}</span>
      </footer>
    </div>
  )
}

function ReaderExplorationPanel({
  composerAvailable,
  isAwake,
  onExplore,
  pendingAction,
}: {
  composerAvailable: boolean
  isAwake: boolean
  onExplore: (action: ReaderExplorationAction) => void
  pendingAction: ReaderExplorationAction | null
}) {
  const isLocked = !composerAvailable

  return (
    <section
      className={`reader-depth ${isAwake ? 'reader-depth--awake' : ''} ${isLocked ? 'reader-depth--locked' : ''}`}
      aria-label="Continue exploring"
    >
      <div className="reader-depth__threshold" aria-hidden="true">
        <span />
      </div>
      <div className="reader-depth__copy">
        <span className="reader-depth__eyebrow">{isLocked ? 'Invite-only Composer' : 'You have reached the edge of this thought.'}</span>
        <h2>{isLocked ? 'Sign in to use Composer.' : 'Continue deeper?'}</h2>
        <p>
          {isLocked
            ? 'Local mode keeps reading and writing private to this browser. AI actions are reserved for approved accounts.'
            : 'Ask Essence Composer to extend the argument, test it, or turn the ending into a research path.'}
        </p>
      </div>

      <div className="reader-depth__actions">
        {readerExplorationActions.map((action) => {
          const isPending = pendingAction === action.action

          return (
            <button
              key={action.action}
              type="button"
              className="reader-depth__action"
              onClick={() => onExplore(action.action)}
              disabled={isLocked || pendingAction !== null}
            >
              <span>{isLocked ? 'Locked' : isPending ? 'Thinking...' : action.label}</span>
              <small>{action.description}</small>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ReadBlock({
  block,
  notesByNormalizedTitle,
  onOpenNote,
}: {
  block: NoteBlock
  notesByNormalizedTitle: Record<string, Note>
  onOpenNote: (noteId: string) => void
}) {
  const text = getBlockTextValue(block)

  if (block.type === 'heading') {
    return (
      <h2 className="reader-block reader-block--heading">
        <LinkedText text={text} notesByNormalizedTitle={notesByNormalizedTitle} onOpenNote={onOpenNote} />
      </h2>
    )
  }

  if (block.type === 'quote') {
    return (
      <figure className="reader-block reader-block--quote">
        <blockquote>
          <LinkedText text={text} notesByNormalizedTitle={notesByNormalizedTitle} onOpenNote={onOpenNote} />
        </blockquote>
        {block.citation && (
          <figcaption>
            <LinkedText text={block.citation} notesByNormalizedTitle={notesByNormalizedTitle} onOpenNote={onOpenNote} />
          </figcaption>
        )}
      </figure>
    )
  }

  if (block.type === 'bullet-list') {
    const items = (block.items ?? []).filter((item) => item.trim().length > 0)

    if (items.length === 0) {
      return null
    }

    return (
      <ul className="reader-block reader-block--list">
        {items.map((item, index) => (
          <li key={`${block.id}-${index}`}>
            <LinkedText text={item} notesByNormalizedTitle={notesByNormalizedTitle} onOpenNote={onOpenNote} />
          </li>
        ))}
      </ul>
    )
  }

  if (block.type === 'code') {
    return (
      <pre className="reader-block reader-block--code">
        <code>{text}</code>
      </pre>
    )
  }

  if (text.trim().length === 0) {
    return null
  }

  return (
    <p className="reader-block reader-block--paragraph">
      <LinkedText text={text} notesByNormalizedTitle={notesByNormalizedTitle} onOpenNote={onOpenNote} />
    </p>
  )
}

function LinkedText({
  text,
  notesByNormalizedTitle,
  onOpenNote,
}: {
  text: string
  notesByNormalizedTitle: Record<string, Note>
  onOpenNote: (noteId: string) => void
}) {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  const inlinePattern = /(\[\[([^[\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|<u>([\s\S]+?)<\/u>|\*\*([^*]+)\*\*|\*([^*]+)\*)/g

  lines.forEach((line, lineIndex) => {
    let lastIndex = 0

    for (const match of line.matchAll(inlinePattern)) {
      const matchedText = match[0]
      const startIndex = match.index ?? 0

      if (startIndex > lastIndex) {
        nodes.push(<span key={`text-${lineIndex}-${lastIndex}`}>{line.slice(lastIndex, startIndex)}</span>)
      }

      if (match[2]) {
        const linkedTitle = match[2].trim()
        const linkedNote = notesByNormalizedTitle[normalizeNoteLinkTitle(linkedTitle)]

        if (linkedNote) {
          nodes.push(
            <button
              key={`note-link-${lineIndex}-${startIndex}`}
              type="button"
              className="note-link"
              onClick={() => onOpenNote(linkedNote.id)}
            >
              {linkedNote.title}
            </button>,
          )
        } else {
          nodes.push(
            <span key={`missing-${lineIndex}-${startIndex}`} className="note-link note-link--missing">
              {matchedText}
            </span>,
          )
        }
      } else if (match[3] && match[4]) {
        nodes.push(
          <a
            key={`external-link-${lineIndex}-${startIndex}`}
            className="reader-inline-link"
            href={normalizeExternalHref(match[4])}
            target="_blank"
            rel="noreferrer"
          >
            {match[3]}
          </a>,
        )
      } else if (match[5]) {
        nodes.push(<code key={`code-${lineIndex}-${startIndex}`} className="reader-inline-code">{match[5]}</code>)
      } else if (match[6]) {
        nodes.push(<u key={`underline-${lineIndex}-${startIndex}`}>{match[6]}</u>)
      } else if (match[7]) {
        nodes.push(<strong key={`bold-${lineIndex}-${startIndex}`}>{match[7]}</strong>)
      } else if (match[8]) {
        nodes.push(<em key={`italic-${lineIndex}-${startIndex}`}>{match[8]}</em>)
      } else {
        nodes.push(<span key={`raw-${lineIndex}-${startIndex}`}>{matchedText}</span>)
      }

      lastIndex = startIndex + matchedText.length
    }

    if (lastIndex < line.length) {
      nodes.push(<span key={`tail-${lineIndex}-${lastIndex}`}>{line.slice(lastIndex)}</span>)
    }

    if (lineIndex < lines.length - 1) {
      nodes.push(<br key={`break-${lineIndex}`} />)
    }
  })

  return <>{nodes}</>
}

function NoteConnections({
  backlinks,
  linkedNotes,
  onOpenNote,
}: {
  backlinks: Note[]
  linkedNotes: Note[]
  onOpenNote: (noteId: string) => void
}) {
  if (backlinks.length === 0 && linkedNotes.length === 0) {
    return null
  }

  return (
    <section className="note-connections">
      {linkedNotes.length > 0 && (
        <div className="note-connections__group">
          <span className="note-connections__label">Linked notes</span>
          <div className="note-connections__list">
            {linkedNotes.map((note) => (
              <button key={note.id} type="button" className="note-connections__item" onClick={() => onOpenNote(note.id)}>
                <strong>{note.title}</strong>
                <span>{note.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {backlinks.length > 0 && (
        <div className="note-connections__group">
          <span className="note-connections__label">Backlinks</span>
          <div className="note-connections__list">
            {backlinks.map((note) => (
              <button key={note.id} type="button" className="note-connections__item" onClick={() => onOpenNote(note.id)}>
                <strong>{note.title}</strong>
                <span>{note.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function NoteHistoryPanel({
  activeRevision,
  error,
  isLoading,
  note,
  onClose,
  onRestore,
  onSelectRevision,
  restoringRevisionId,
  revisions,
}: {
  activeRevision: NoteRevision | null
  error: string | null
  isLoading: boolean
  note: Note
  onClose: () => void
  onRestore: (revision: NoteRevision) => void
  onSelectRevision: (revisionId: string) => void
  restoringRevisionId: string | null
  revisions: NoteRevision[]
}) {
  return (
    <aside className="note-history" aria-label="Note history">
      <header className="note-history__header">
        <div>
          <span className="note-history__eyebrow">History</span>
          <h2>Versions</h2>
          <p>Revisit an earlier draft and restore it as the current note.</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close note history">
          <Icon name="close" />
        </button>
      </header>

      <div className="note-history__summary">
        <span className="note-history__label">Current note</span>
        <strong>{note.title}</strong>
        <span>{formatCount(revisions.length, 'saved version')}</span>
      </div>

      {isLoading ? (
        <div className="note-history__state">Loading note history…</div>
      ) : error ? (
        <div className="note-history__state note-history__state--error">{error}</div>
      ) : revisions.length === 0 ? (
        <div className="note-history__state">
          History starts after the first saved change. Edit this note to create its first revision.
        </div>
      ) : (
        <>
          <div className="note-history__list" role="list">
            {revisions.map((revision) => {
              const isActive = activeRevision?.id === revision.id

              return (
                <button
                  key={revision.id}
                  type="button"
                  className={`note-history__item ${isActive ? 'note-history__item--active' : ''}`}
                  onClick={() => onSelectRevision(revision.id)}
                >
                  <div className="note-history__itemMeta">
                    <span className="note-history__itemKind">{getRevisionKindLabel(revision.revisionKind)}</span>
                    <span>{formatRevisionTimestamp(revision.createdAt)}</span>
                  </div>
                  <strong>{revision.noteTitle || revision.snapshot.title}</strong>
                  <p>{summarizeBlocks(revision.snapshot.blocks) || 'No body text in this version yet.'}</p>
                </button>
              )
            })}
          </div>

          {activeRevision && (
            <div className="note-history__preview">
              <div className="note-history__previewMeta">
                <div>
                  <span className="note-history__label">Selected version</span>
                  <strong>{formatRevisionTimestamp(activeRevision.createdAt)}</strong>
                </div>
                <span className="badge badge--soft">{getRevisionKindLabel(activeRevision.revisionKind)}</span>
              </div>
              <h3>{activeRevision.snapshot.title}</h3>
              <p>{summarizeBlocks(activeRevision.snapshot.blocks) || 'No readable content in this version yet.'}</p>
              <div className="note-history__previewFooter">
                <span>{`${countWordsFromBlocks(activeRevision.snapshot.blocks)} words / ${activeRevision.snapshot.blocks.length} blocks`}</span>
                <button
                  type="button"
                  className="utility-button"
                  onClick={() => onRestore(activeRevision)}
                  disabled={restoringRevisionId === activeRevision.id}
                >
                  <Icon name="history" />
                  <span>{restoringRevisionId === activeRevision.id ? 'Restoring…' : 'Restore this version'}</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: NoteViewMode
  onChange: (nextMode: NoteViewMode) => void
}) {
  return (
    <div className="mode-toggle" role="tablist" aria-label="Note view mode">
      <button
        type="button"
        className={`mode-toggle__button ${mode === 'read' ? 'mode-toggle__button--active' : ''}`}
        onClick={() => onChange('read')}
        role="tab"
        aria-selected={mode === 'read'}
      >
        Read
      </button>
      <button
        type="button"
        className={`mode-toggle__button ${mode === 'edit' ? 'mode-toggle__button--active' : ''}`}
        onClick={() => onChange('edit')}
        role="tab"
        aria-selected={mode === 'edit'}
      >
        Edit
      </button>
    </div>
  )
}

function EditorActionsMenu({
  isOpen,
  note,
  noteHistoryOpen,
  onClose,
  onDelete,
  onExportMarkdown,
  onOpenQuickSwitcher,
  onMoveToDraft,
  onPublish,
  onToggleFavorite,
  onToggleHistory,
  onToggleOpen,
  onTogglePinned,
}: {
  isOpen: boolean
  note: Note
  noteHistoryOpen: boolean
  onClose: () => void
  onDelete: () => void
  onExportMarkdown: () => void
  onOpenQuickSwitcher: () => void
  onMoveToDraft: () => void
  onPublish: () => void
  onToggleFavorite: () => void
  onToggleHistory: () => void
  onToggleOpen: () => void
  onTogglePinned: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const noteIsDraft = isDraftNote(note)
  const noteIsPublished = isPublishedNote(note)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen, onClose])

  const runAction = (action: () => void) => {
    action()
    onClose()
  }

  return (
    <div className="editor-more" ref={menuRef}>
      <button
        type="button"
        className={`icon-button ${isOpen ? 'icon-button--active' : ''}`}
        onClick={onToggleOpen}
        aria-label="Open note actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="More note actions"
      >
        <Icon name="more" />
      </button>

      {isOpen && (
        <div className="editor-more__menu" role="menu" aria-label="Note actions">
          <div className="editor-more__summary">
            <span>Note actions</span>
            <strong>{note.title}</strong>
          </div>

          <button type="button" role="menuitem" className="editor-more__item" onClick={() => runAction(onOpenQuickSwitcher)}>
            <Icon name="search" />
            <span>
              <strong>Quick switcher</strong>
              <small>Jump to notes, folders, collections, or tags</small>
            </span>
          </button>

          {noteIsDraft && (
            <button type="button" role="menuitem" className="editor-more__item editor-more__item--positive" onClick={() => runAction(onPublish)}>
              <Icon name="check" />
              <span>
                <strong>Publish note</strong>
                <small>Mark it ready and remove draft tags</small>
              </span>
            </button>
          )}

          {noteIsPublished && (
            <button type="button" role="menuitem" className="editor-more__item" onClick={() => runAction(onMoveToDraft)}>
              <Icon name="edit" />
              <span>
                <strong>Move back to draft</strong>
                <small>Return this note to editing status</small>
              </span>
            </button>
          )}

          <button type="button" role="menuitem" className="editor-more__item" onClick={() => runAction(onExportMarkdown)}>
            <Icon name="download" />
            <span>
              <strong>Export Markdown</strong>
              <small>Save this note as a portable .md file</small>
            </span>
          </button>

          <button type="button" role="menuitem" className="editor-more__item" onClick={() => runAction(onToggleHistory)}>
            <Icon name="history" />
            <span>
              <strong>{noteHistoryOpen ? 'Close history' : 'Open history'}</strong>
              <small>Review saved versions of this note</small>
            </span>
          </button>

          <button type="button" role="menuitem" className="editor-more__item" onClick={() => runAction(onTogglePinned)}>
            <Icon name="pin" />
            <span>
              <strong>{note.isPinned ? 'Unpin note' : 'Pin note'}</strong>
              <small>{note.isPinned ? 'Remove it from priority placement' : 'Keep it near the top of the library'}</small>
            </span>
          </button>

          <button type="button" role="menuitem" className="editor-more__item" onClick={() => runAction(onToggleFavorite)}>
            <Icon name="star" />
            <span>
              <strong>{note.isFavorite ? 'Remove favorite' : 'Add favorite'}</strong>
              <small>{note.isFavorite ? 'Take it out of favorites' : 'Mark it for quick return'}</small>
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="editor-more__item editor-more__item--danger"
            onClick={() => runAction(onDelete)}
          >
            <Icon name="trash" />
            <span>
              <strong>Delete note</strong>
              <small>Move carefully. This asks for confirmation.</small>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

function AuthScreen({
  disabled,
  email,
  error,
  isLoading,
  notice,
  onContinueLocally,
  onEmailChange,
  onSubmit,
  waitlistUrl,
}: {
  disabled: boolean
  email: string
  error: string | null
  isLoading: boolean
  notice: string | null
  onContinueLocally: () => void
  onEmailChange: (email: string) => void
  onSubmit: () => void
  waitlistUrl: string
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <main className="auth-screen">
      <section className="auth-main" aria-label="Essence account access">
        <header className="auth-brandbar">
          <EssenceMark compact />
          <strong>Essence</strong>
          <span className="auth-brandbar__divider" aria-hidden="true" />
          <p>A lucid space for thought.</p>
        </header>

        <div className="auth-main__content">
          <div className="auth-hero">
            <h1>Return to your thinking space.</h1>
          </div>

          <section className="auth-panel">
            <span className="auth-panel__eyebrow">Invite-only access</span>
            <p className="auth-panel__copy">Use the email that was approved from the waitlist.</p>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-field">
                <span>Email</span>
                <input
                  autoComplete="email"
                  autoFocus
                  disabled={disabled}
                  inputMode="email"
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                />
              </label>

              {error && <div className="auth-error">{error}</div>}
              {notice && <div className="auth-notice">{notice}</div>}

              <button type="submit" className="auth-primary" disabled={disabled}>
                {isLoading ? 'Preparing workspace...' : 'Send sign-in link'}
              </button>
            </form>

            {waitlistUrl && (
              <a className="auth-waitlist" href={waitlistUrl}>
                Join the waitlist
              </a>
            )}

            <div className="auth-localChoice">
              <button type="button" className="auth-local" onClick={onContinueLocally} disabled={isLoading}>
                Use this device only
              </button>
              <p>Stores notes in this browser. Composer and sync unlock after invite sign-in.</p>
            </div>
          </section>
        </div>
      </section>

      <aside className="auth-poem" aria-label="Product promise">
        <p>
          <strong>Capture</strong> the thought.
          <br />
          <strong>Shape</strong> the structure.
          <br />
          <strong>Return when</strong> the mind is ready.
        </p>
      </aside>
    </main>
  )
}

function AccountControl({
  disabled,
  onOpenAuth,
  onSignOut,
  user,
}: {
  disabled: boolean
  onOpenAuth: () => void
  onSignOut: () => void
  user: AuthUser | null
}) {
  const isLocal = !user || user.isLocal

  if (!isLocal) {
    return (
      <div className="account-control account-control--signedIn" title={`Signed in as ${user.email}`}>
        <span className="account-control__avatar" aria-hidden="true">
          {getAccountInitials(user.displayName || user.email)}
        </span>
        <span className="account-control__identity">{user.displayName}</span>
        <button type="button" className="account-control__button" onClick={onSignOut} disabled={disabled}>
          Sign out
        </button>
      </div>
    )
  }

  return (
    <button type="button" className="account-control account-control--button" onClick={onOpenAuth} disabled={disabled}>
      <Icon name="user" />
      <span>Sign in</span>
    </button>
  )
}

function QuickSwitcher({
  activeIndex,
  isOpen,
  items,
  onActiveIndexChange,
  onClose,
  onQueryChange,
  onSelect,
  query,
}: {
  activeIndex: number
  isOpen: boolean
  items: QuickSwitcherItem[]
  onActiveIndexChange: (index: number) => void
  onClose: () => void
  onQueryChange: (value: string) => void
  onSelect: (item: QuickSwitcherItem) => void
  query: string
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isOpen])

  useEffect(() => {
    if (items.length === 0) {
      onActiveIndexChange(0)
      return
    }

    if (activeIndex >= items.length) {
      onActiveIndexChange(0)
    }
  }, [activeIndex, items.length, onActiveIndexChange])

  if (!isOpen) {
    return null
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onActiveIndexChange(items.length === 0 ? 0 : (activeIndex + 1) % items.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onActiveIndexChange(items.length === 0 ? 0 : (activeIndex - 1 + items.length) % items.length)
      return
    }

    if (event.key === 'Enter') {
      const activeItem = items[activeIndex]

      if (!activeItem) {
        return
      }

      event.preventDefault()
      onSelect(activeItem)
    }
  }

  return (
    <div className="quick-switcher" role="dialog" aria-modal="true" aria-label="Quick switcher" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose()
      }
    }}>
      <div className="quick-switcher__panel">
        <div className="quick-switcher__field">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a note, folder, collection, or tag"
          />
          <span className="quick-switcher__hint">Ctrl/Cmd+K</span>
        </div>

        {items.length === 0 ? (
          <div className="quick-switcher__empty">
            <strong>No matching results</strong>
            <span>Try a note title, folder path, or tag name.</span>
          </div>
        ) : (
          <div className="quick-switcher__results">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`quick-switcher__item ${index === activeIndex ? 'quick-switcher__item--active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onActiveIndexChange(index)}
                onClick={() => onSelect(item)}
              >
                <span className="quick-switcher__icon">
                  <Icon name={getQuickSwitcherIconName(item.kind)} />
                </span>
                <span className="quick-switcher__copy">
                  <span className="quick-switcher__eyebrow">{getQuickSwitcherKindLabel(item.kind)}</span>
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="quick-switcher__footer">
          <span>New note: Ctrl/Cmd+N</span>
          <span>Search: Ctrl/Cmd+Shift+F</span>
          <span>Undo / Redo: Ctrl/Cmd+Z</span>
        </div>
      </div>
    </div>
  )
}

function RailButton({
  children,
  disabled = false,
  isActive,
  label,
  onClick,
  title,
}: {
  children: ReactNode
  disabled?: boolean
  isActive: boolean
  label: string
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      className={`rail__button ${isActive ? 'rail__button--active' : ''} ${disabled ? 'rail__button--disabled' : ''}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      title={title ?? label}
    >
      <span className="rail__buttonGlyph" aria-hidden="true">
        {children}
      </span>
      <span className="rail__buttonLabel">{label}</span>
    </button>
  )
}

function AmbienceControl({
  mode,
  onChange,
}: {
  mode: AmbienceMode
  onChange: (mode: AmbienceMode) => void
}) {
  return (
    <div className="rail__ambience" aria-label="Background ambience">
      <span className="rail__ambienceLabel">Ambience</span>
      <div className="rail__ambienceToggle" role="radiogroup" aria-label="Background ambience">
        {ambienceOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`rail__ambienceButton ${
              mode === option.value ? 'rail__ambienceButton--active' : ''
            } rail__ambienceButton--${option.value}`}
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={mode === option.value}
            aria-label={option.label}
            title={`${option.label}: ${option.description}`}
          >
            <span className="rail__ambienceDot" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}

function EssenceMark({
  compact = false,
  framed = false,
}: {
  compact?: boolean
  framed?: boolean
}) {
  return (
    <span
      className={`essence-mark ${compact ? 'essence-mark--compact' : ''} ${framed ? 'essence-mark--framed' : ''}`}
      aria-hidden="true"
    >
      <svg
        className="essence-mark__svg"
        viewBox="0 0 64 64"
        role="presentation"
        focusable="false"
      >
        {framed ? <rect className="essence-mark__frame" x="5" y="5" width="54" height="54" rx="18" /> : null}
        <path
          className="essence-mark__glyph"
          d="M45.8 12H25.7C16.2 12 10 17.7 10 25.3c0 4.9 2.5 8.6 6.8 10.5C12.4 37.8 10 41.5 10 46.3 10 53.8 16.3 59 25.8 59h20c3.7 0 6.4-2.6 6.4-5.9s-2.7-5.8-6.4-5.8H27.2c-2.5 0-4.1-1.2-4.1-3s1.6-3 4.1-3h15.6c3.4 0 5.9-2.4 5.9-5.5s-2.5-5.5-5.9-5.5H27.2c-2.4 0-4.1-1.2-4.1-3s1.7-3 4.1-3h18.6c3.7 0 6.4-2.5 6.4-5.8S49.5 12 45.8 12Z"
        />
      </svg>
    </span>
  )
}

function Icon({ name }: { name: string }) {
  switch (name) {
    case 'archive':
      return (
        <Glyph>
          <path d="M4 7h16" />
          <path d="M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
          <path d="m10 12 2 2 2-2" />
          <path d="M12 14V9" />
        </Glyph>
      )
    case 'arrowLeft':
      return (
        <Glyph>
          <path d="m15 18-6-6 6-6" />
        </Glyph>
      )
    case 'chevronDown':
      return (
        <Glyph>
          <path d="m6 9 6 6 6-6" />
        </Glyph>
      )
    case 'chevronUp':
      return (
        <Glyph>
          <path d="m6 15 6-6 6 6" />
        </Glyph>
      )
    case 'chevronRight':
      return (
        <Glyph>
          <path d="m9 6 6 6-6 6" />
        </Glyph>
      )
    case 'close':
      return (
        <Glyph>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </Glyph>
      )
    case 'check':
      return (
        <Glyph>
          <path d="m5 12 4 4 10-10" />
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
    case 'download':
      return (
        <Glyph>
          <path d="M12 4v10" />
          <path d="m8 10 4 4 4-4" />
          <path d="M5 18.5h14" />
        </Glyph>
      )
    case 'folder':
      return (
        <Glyph>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.6 2H19.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z" />
        </Glyph>
      )
    case 'folderOpen':
      return (
        <Glyph>
          <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h4l1.4 2H20l-2 8.5A1.5 1.5 0 0 1 16.5 19h-12A1.5 1.5 0 0 1 3 17.5Z" />
        </Glyph>
      )
    case 'focus':
      return (
        <Glyph>
          <path d="M4 9V5a1 1 0 0 1 1-1h4" />
          <path d="M15 4h4a1 1 0 0 1 1 1v4" />
          <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
          <path d="M9 20H5a1 1 0 0 1-1-1v-4" />
          <circle cx="12" cy="12" r="2.4" />
        </Glyph>
      )
    case 'grid':
      return (
        <Glyph>
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <rect x="14" y="14" width="6" height="6" />
        </Glyph>
      )
    case 'history':
      return (
        <Glyph>
          <path d="M4 12a8 8 0 1 0 2.3-5.7" />
          <path d="M4 4v4h4" />
          <path d="M12 8v4l2.5 2.5" />
        </Glyph>
      )
    case 'hash':
      return (
        <Glyph>
          <path d="M9 4 7 20" />
          <path d="M17 4 15 20" />
          <path d="M4 9h16" />
          <path d="M3 15h16" />
        </Glyph>
      )
    case 'library':
      return (
        <Glyph>
          <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2Z" />
          <path d="M7 4v18" />
          <path d="M18 6h1a2 2 0 0 1 2 2v12H9" />
        </Glyph>
      )
    case 'link':
      return (
        <Glyph>
          <path d="M9.5 14.5 14.5 9.5" />
          <path d="M11 6.5 12.6 5A4.2 4.2 0 0 1 18.5 11l-1.5 1.5" />
          <path d="M13 17.5 11.4 19A4.2 4.2 0 0 1 5.5 13l1.5-1.5" />
        </Glyph>
      )
    case 'lock':
      return (
        <Glyph>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          <path d="M12 14v2" />
        </Glyph>
      )
    case 'more':
      return (
        <Glyph>
          <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
        </Glyph>
      )
    case 'panelLeftClose':
      return (
        <Glyph>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M9 5v14" />
          <path d="m15 9-3 3 3 3" />
        </Glyph>
      )
    case 'panelLeftOpen':
      return (
        <Glyph>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M9 5v14" />
          <path d="m12 9 3 3-3 3" />
        </Glyph>
      )
    case 'plus':
      return (
        <Glyph>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </Glyph>
      )
    case 'pin':
      return (
        <Glyph>
          <path d="m8 4 8 8" />
          <path d="m13 5 6 6-3 3-6-6" />
          <path d="m10 14-6 6" />
          <path d="m8 10 6-6" />
        </Glyph>
      )
    case 'quote':
      return (
        <Glyph>
          <path d="M8 12h4v6H6v-4c0-4 2-6 6-8" />
          <path d="M18 12h4v6h-6v-4c0-4 2-6 6-8" transform="translate(-4 0)" />
        </Glyph>
      )
    case 'search':
      return (
        <Glyph>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </Glyph>
      )
    case 'settings':
      return (
        <Glyph>
          <path d="M12 3.5 14 4l1 2 2 .5 1.5 2-1 2 1 2-1.5 2-2 .5-1 2-2 .5-2-.5-1-2-2-.5-1.5-2 1-2-1-2L7 6.5 9 6l1-2Z" />
          <circle cx="12" cy="12" r="3" />
        </Glyph>
      )
    case 'share':
      return (
        <Glyph>
          <circle cx="18" cy="5" r="2" />
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="19" r="2" />
          <path d="m8 12 8-6" />
          <path d="m8 12 8 6" />
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
    case 'star':
      return (
        <Glyph>
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z" />
        </Glyph>
      )
    case 'trash':
      return (
        <Glyph>
          <path d="M4 7h16" />
          <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
          <path d="M7 7v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </Glyph>
      )
    case 'undo':
      return (
        <Glyph>
          <path d="M9 7 5 11l4 4" />
          <path d="M19 17a6 6 0 0 0-6-6H5" />
        </Glyph>
      )
    case 'upload':
      return (
        <Glyph>
          <path d="M12 20V10" />
          <path d="m8 14 4-4 4 4" />
          <path d="M5 5.5h14" />
        </Glyph>
      )
    case 'user':
      return (
        <Glyph>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </Glyph>
      )
    case 'redo':
      return (
        <Glyph>
          <path d="m15 7 4 4-4 4" />
          <path d="M5 17a6 6 0 0 1 6-6h8" />
        </Glyph>
      )
    default:
      return null
  }
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}

function CollectionGlyph({ icon }: { icon: CollectionIcon }) {
  switch (icon) {
    case 'briefcase':
      return (
        <Glyph>
          <rect x="4" y="8" width="16" height="11" rx="1.5" />
          <path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8" />
        </Glyph>
      )
    case 'person':
      return (
        <Glyph>
          <circle cx="12" cy="8" r="3" />
          <path d="M6 18c1.5-3 10.5-3 12 0" />
        </Glyph>
      )
    case 'flask':
      return (
        <Glyph>
          <path d="M10 4h4" />
          <path d="M11 4v5l-5 8a2 2 0 0 0 1.7 3h8.6A2 2 0 0 0 18 17l-5-8V4" />
        </Glyph>
      )
    case 'bulb':
      return (
        <Glyph>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.8-1.2 1.3-1.4 2H9.9c-.2-.7-.6-1.2-1.4-2Z" />
        </Glyph>
      )
  }
}

function loadStoredFolders() {
  return loadStoredCacheState().folders
}

function loadStoredNotes() {
  return loadStoredCacheState().notes
}

function loadStoredActiveNoteId() {
  if (typeof window === 'undefined') {
    return null
  }

  return loadStoredCacheState().activeNoteId
}

function loadStoredComposerHistory() {
  return loadStoredCacheState().composerHistory
}

function loadStoredAmbienceMode(): AmbienceMode {
  if (typeof window === 'undefined') {
    return 'subtle'
  }

  const raw = window.localStorage.getItem(ambienceStorageKey)

  return isAmbienceMode(raw) ? raw : 'subtle'
}

function loadStoredNavigationSidebarVisible() {
  if (typeof window === 'undefined') {
    return true
  }

  return window.localStorage.getItem(navigationSidebarStorageKey) !== 'hidden'
}

function isAmbienceMode(value: unknown): value is AmbienceMode {
  return value === 'still' || value === 'subtle' || value === 'cosmic'
}

function loadAuthGateDismissed() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(authGateStorageKey) === 'true'
}

function persistAuthGateDismissed() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(authGateStorageKey, 'true')
}

function clearAuthGateDismissed() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(authGateStorageKey)
}

function createSupabaseBrowserClient() {
  const supabaseUrl = getViteEnvString('VITE_SUPABASE_URL')
  const supabaseKey = getViteEnvString('VITE_SUPABASE_PUBLISHABLE_KEY') || getViteEnvString('VITE_SUPABASE_ANON_KEY')

  return supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
}

function getViteEnvString(name: string) {
  const value = import.meta.env[name]

  return typeof value === 'string' ? value.trim() : ''
}

function normalizeApiBaseUrl(value: string) {
  if (!value) {
    return ''
  }

  try {
    return new URL(value).toString().replace(/\/+$/g, '')
  } catch {
    console.warn(`Ignoring invalid VITE_API_BASE_URL: ${value}`)
    return ''
  }
}

function getApiFetchCredentials(): RequestCredentials {
  const value = getViteEnvString('VITE_API_CREDENTIALS')

  if (value === 'include' || value === 'omit' || value === 'same-origin') {
    return value
  }

  return apiBaseUrl ? 'omit' : 'same-origin'
}

function getApiUrl(path: string) {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path
}

function loadStoredCacheState(): PersistedAppState {
  if (typeof window === 'undefined') {
    return createEmptyPersistedState()
  }

  try {
    const raw = window.localStorage.getItem(storageKey)

    if (!raw) {
      return createEmptyPersistedState()
    }

    return normalizePersistedAppState(JSON.parse(raw))
  } catch {
    return createEmptyPersistedState()
  }
}

async function getRemoteAuthHeaders(): Promise<Record<string, string>> {
  if (!supabaseClient) {
    return {}
  }

  const { data, error } = await supabaseClient.auth.getSession()

  if (error || !data.session?.access_token) {
    return {}
  }

  return {
    Authorization: `Bearer ${data.session.access_token}`,
  }
}

class RemoteRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RemoteRequestError'
    this.status = status
  }
}

async function createRemoteRequestError(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown }
  const message = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : fallbackMessage

  return new RemoteRequestError(response.status, message)
}

function isRemoteAccessError(error: unknown) {
  return error instanceof RemoteRequestError && (error.status === 401 || error.status === 403)
}

function getRemoteAccessEndedMessage(error: unknown) {
  if (error instanceof RemoteRequestError && error.status === 403) {
    return 'This email is no longer approved for Essence. Ask for a new invite if this looks wrong.'
  }

  return 'Your sign-in expired. Sign in again to continue syncing.'
}

async function clearRemoteBrowserSession() {
  if (!supabaseClient) {
    return
  }

  await supabaseClient.auth.signOut().catch(() => undefined)
}

async function fetchRemoteAppState(): Promise<RemoteAppSnapshot> {
  const authHeaders = await getRemoteAuthHeaders()
  const response = await fetch(getApiUrl('/api/state'), {
    credentials: apiFetchCredentials,
    headers: authHeaders,
  })

  if (response.status === 401) {
    if (authHeaders.Authorization) {
      throw await createRemoteRequestError(response, 'Your sign-in expired. Sign in again to continue syncing.')
    }

    return {
      state: null,
      user: createLocalAuthUser(),
    }
  }

  if (!response.ok) {
    throw await createRemoteRequestError(response, `Failed to load remote state: ${response.status}`)
  }

  const payload = (await response.json()) as { state?: unknown | null; user?: unknown | null }

  return {
    state: payload.state ? normalizePersistedAppState(payload.state) : null,
    user: normalizeAuthUser(payload.user),
  }
}

async function fetchRemoteNoteRevisions(noteId: string, limit = 20): Promise<NoteRevision[]> {
  const authHeaders = await getRemoteAuthHeaders()
  const response = await fetch(getApiUrl(`/api/notes/${encodeURIComponent(noteId)}/revisions?limit=${limit}`), {
    credentials: apiFetchCredentials,
    headers: authHeaders,
  })

  if (!response.ok) {
    throw await createRemoteRequestError(response, `Failed to load note history: ${response.status}`)
  }

  const payload = (await response.json()) as { revisions?: unknown[] }

  return Array.isArray(payload.revisions)
    ? payload.revisions
        .map((revision) => normalizeRemoteNoteRevision(revision))
        .filter((revision): revision is NoteRevision => revision !== null)
    : []
}

async function fetchRemoteSearchResults(query: string, limit = 24): Promise<SearchResult[]> {
  const authHeaders = await getRemoteAuthHeaders()
  const response = await fetch(getApiUrl(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`), {
    credentials: apiFetchCredentials,
    headers: authHeaders,
  })

  if (!response.ok) {
    throw await createRemoteRequestError(response, `Failed to search notes: ${response.status}`)
  }

  const payload = (await response.json()) as { results?: unknown[] }

  return Array.isArray(payload.results)
    ? payload.results
        .map((result) => normalizeRemoteSearchResult(result))
        .filter((result): result is SearchResult => result !== null)
    : []
}

async function generateRemoteAiDraft(request: {
  category: AiDraftCategory
  context: ComposerRequestContext
  topic: string
}): Promise<AiDraft> {
  const authHeaders = await getRemoteAuthHeaders()
  const response = await fetch(getApiUrl('/api/ai/draft'), {
    method: 'POST',
    credentials: apiFetchCredentials,
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw await createRemoteRequestError(response, `Composer failed with status ${response.status}.`)
  }

  const payload = await response.json().catch(() => ({})) as { draft?: unknown; error?: unknown }

  return normalizeRemoteAiDraft(payload.draft)
}

async function generateRemoteAiAssist(request: {
  action: AiAssistAction
  context: ComposerRequestContext
  note: {
    selectedText: string
    status: string
    tags: string[]
    text: string
    title: string
  }
}): Promise<AiAssistResult> {
  const authHeaders = await getRemoteAuthHeaders()
  const response = await fetch(getApiUrl('/api/ai/assist'), {
    method: 'POST',
    credentials: apiFetchCredentials,
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw await createRemoteRequestError(response, `Composer failed with status ${response.status}.`)
  }

  const payload = await response.json().catch(() => ({})) as { result?: unknown; error?: unknown }

  return normalizeRemoteAiAssistResult(payload.result, request.action)
}

async function persistRemoteAppState(state: PersistedAppState, revisionEvents: PendingRevisionEvent[] = []) {
  const authHeaders = await getRemoteAuthHeaders()
  const response = await fetch(getApiUrl('/api/state'), {
    method: 'PUT',
    credentials: apiFetchCredentials,
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ revisionEvents, state }),
  })

  if (!response.ok) {
    throw await createRemoteRequestError(response, `Failed to persist remote state: ${response.status}`)
  }
}

function normalizeRemoteAiAssistResult(rawResult: unknown, fallbackAction: AiAssistAction): AiAssistResult {
  const candidate = (rawResult ?? {}) as Partial<AiAssistResult> & { blocks?: unknown[] }
  const action = isAiAssistAction(candidate.action) ? candidate.action : fallbackAction
  const actionLabel =
    typeof candidate.actionLabel === 'string' && candidate.actionLabel.trim()
      ? candidate.actionLabel.trim()
      : aiAssistActions.find((option) => option.value === action)?.label ?? 'Composer'
  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.map(normalizeRemoteAiDraftBlock).filter((block): block is AiDraftBlock => block !== null)
    : []

  return {
    action,
    actionLabel,
    blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', text: '' }],
    canReplaceSelection: Boolean(candidate.canReplaceSelection),
    summary: typeof candidate.summary === 'string' ? candidate.summary.trim() : '',
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : actionLabel,
  }
}

function normalizeRemoteAiDraft(rawDraft: unknown): AiDraft {
  const candidate = (rawDraft ?? {}) as Partial<AiDraft> & { blocks?: unknown[] }
  const collectionId = isCollectionId(candidate.collectionId) ? candidate.collectionId : 'research'
  const layout =
    candidate.layout === 'feature' || candidate.layout === 'quote' || candidate.layout === 'standard'
      ? candidate.layout
      : 'standard'
  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.map(normalizeRemoteAiDraftBlock).filter((block): block is AiDraftBlock => block !== null)
    : []

  return {
    blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', text: '' }],
    collectionId,
    layout,
    noteType: candidate.noteType === 'quote' ? 'quote' : undefined,
    status: typeof candidate.status === 'string' && candidate.status.trim() ? candidate.status.trim() : 'Draft',
    summary: typeof candidate.summary === 'string' ? candidate.summary.trim() : '',
    tags: Array.isArray(candidate.tags)
      ? dedupeStrings(candidate.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0))
      : ['ai-draft'],
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : 'Untitled AI Draft',
  }
}

function normalizeRemoteAiDraftBlock(rawBlock: unknown): AiDraftBlock | null {
  if (!rawBlock || typeof rawBlock !== 'object') {
    return null
  }

  const candidate = rawBlock as Partial<AiDraftBlock>
  const type = isBlockType(candidate.type) ? candidate.type : 'paragraph'

  if (type === 'bullet-list') {
    const items = Array.isArray(candidate.items)
      ? candidate.items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []

    return {
      type,
      items: items.length > 0 ? items : [''],
    }
  }

  return {
    type,
    text: typeof candidate.text === 'string' ? candidate.text : '',
    citation: type === 'quote' && typeof candidate.citation === 'string' ? candidate.citation : undefined,
  }
}

function convertAiDraftBlockToNoteBlock(block: AiDraftBlock): NoteBlock {
  const id = generateId('block')

  if (block.type === 'bullet-list') {
    return {
      id,
      type: 'bullet-list',
      items: block.items && block.items.length > 0 ? block.items : [''],
    }
  }

  if (block.type === 'quote') {
    return {
      id,
      type: 'quote',
      text: block.text ?? '',
      citation: block.citation ?? '',
    }
  }

  if (block.type === 'heading') {
    return {
      id,
      type: 'heading',
      text: block.text ?? '',
    }
  }

  if (block.type === 'code') {
    return {
      id,
      type: 'code',
      text: block.text ?? '',
    }
  }

  return {
    id,
    type: 'paragraph',
    text: block.text ?? '',
  }
}

function createDraftComposerHistoryEntry(
  draft: AiDraft,
  context: { category: AiDraftCategory; topic: string },
): ComposerHistoryEntry {
  return {
    id: generateId('composer'),
    mode: 'draft',
    createdAt: new Date().toISOString(),
    prompt: context.topic,
    sourceTitle: aiDraftCategories.find((category) => category.value === context.category)?.label ?? 'Draft',
    title: draft.title,
    summary: draft.summary,
    blocks: cloneAiDraftBlocks(draft.blocks),
    draft: {
      category: context.category,
      collectionId: draft.collectionId,
      layout: draft.layout,
      noteType: draft.noteType,
      status: draft.status,
      tags: [...draft.tags],
    },
  }
}

function createAssistComposerHistoryEntry(
  result: AiAssistResult,
  context: { action: AiAssistAction; noteTitle: string; selectedText: string },
): ComposerHistoryEntry {
  return {
    id: generateId('composer'),
    mode: 'assist',
    createdAt: new Date().toISOString(),
    prompt: context.selectedText || context.noteTitle,
    sourceTitle: context.noteTitle,
    title: result.title,
    summary: result.summary,
    blocks: cloneAiDraftBlocks(result.blocks),
    assist: {
      action: context.action,
      actionLabel: result.actionLabel,
    },
  }
}

function addComposerHistoryEntry(entry: ComposerHistoryEntry, history: ComposerHistoryEntry[]) {
  return mergeComposerHistory([entry], history)
}

function mergeComposerHistory(
  incomingHistory: ComposerHistoryEntry[],
  existingHistory: ComposerHistoryEntry[],
) {
  const byId = new Map<string, ComposerHistoryEntry>()

  for (const entry of [...incomingHistory, ...existingHistory]) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry)
    }
  }

  return [...byId.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, composerHistoryLimit)
}

function cloneAiDraftBlocks(blocks: AiDraftBlock[]) {
  return blocks.map((block) => ({
    type: block.type,
    text: block.text,
    items: block.items ? [...block.items] : undefined,
    citation: block.citation,
  }))
}

function buildComposerRequestContext(
  history: ComposerHistoryEntry[],
  options: { activeNoteTitle?: string | null; targetText: string },
): ComposerRequestContext {
  const targetTerms = getComposerContextTerms(options.targetText)
  const normalizedActiveTitle = normalizeComposerContextText(options.activeNoteTitle ?? '')
  const byId = new Map<string, ComposerHistoryEntry>()

  history
    .map((entry, index) => ({
      entry,
      index,
      score: scoreComposerHistoryEntry(entry, targetTerms, normalizedActiveTitle),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, composerRequestContextLimit)
    .forEach(({ entry }) => {
      byId.set(entry.id, entry)
    })

  for (const entry of history) {
    if (byId.size >= composerRequestContextLimit) {
      break
    }

    byId.set(entry.id, entry)
  }

  return {
    recent: [...byId.values()].slice(0, composerRequestContextLimit).map(createComposerContextItem),
  }
}

function scoreComposerHistoryEntry(
  entry: ComposerHistoryEntry,
  targetTerms: Set<string>,
  normalizedActiveTitle: string,
) {
  let score = 0

  if (normalizedActiveTitle && normalizeComposerContextText(entry.sourceTitle) === normalizedActiveTitle) {
    score += 8
  }

  const entryTerms = getComposerContextTerms(
    `${entry.title} ${entry.summary} ${entry.prompt} ${entry.sourceTitle} ${getPlainTextFromAiDraftBlocks(entry.blocks)}`,
  )

  for (const term of targetTerms) {
    if (entryTerms.has(term)) {
      score += 1
    }
  }

  return score
}

function createComposerContextItem(entry: ComposerHistoryEntry): ComposerContextItem {
  return {
    actionLabel: entry.assist?.actionLabel,
    blocksPreview: summarizeInlineText(getPlainTextFromAiDraftBlocks(entry.blocks), composerRequestContextPreviewLength),
    createdAt: entry.createdAt,
    mode: entry.mode,
    prompt: summarizeInlineText(entry.prompt, 180),
    sourceTitle: summarizeInlineText(entry.sourceTitle, 160),
    summary: summarizeInlineText(entry.summary, 260),
    title: summarizeInlineText(entry.title, 160),
  }
}

function getPlainTextFromAiDraftBlocks(blocks: AiDraftBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === 'bullet-list') {
        return (block.items ?? []).join(' ')
      }

      return `${block.text ?? ''} ${block.citation ?? ''}`.trim()
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getComposerContextTerms(value: string) {
  return new Set(
    normalizeComposerContextText(value)
      .split(/\s+/)
      .filter((term) => term.length >= 4)
      .slice(0, 80),
  )
}

function normalizeComposerContextText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function signInRemote(email: string, state: PersistedAppState): Promise<RemoteSignInResult> {
  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession()

    if (!data.session?.access_token) {
      await requestRemoteSignInLink(email)
      return { email, kind: 'magic-link' }
    }

    return {
      kind: 'session',
      snapshot: await fetchRemoteAppState(),
    }
  }

  if (!devEmailLoginEnabled) {
    throw new Error('Supabase sign-in is not active in this browser session. Restart the dev server after updating .env.')
  }

  const response = await fetch(getApiUrl('/api/auth/login'), {
    method: 'POST',
    credentials: apiFetchCredentials,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, state }),
  })

  const payload = await response.json().catch(() => ({})) as { error?: unknown }

  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Failed to sign in: ${response.status}`)
  }

  return {
    kind: 'session',
    snapshot: normalizeRemoteAppSnapshot(payload),
  }
}

async function requestRemoteSignInLink(email: string) {
  const response = await fetch(getApiUrl('/api/auth/request-link'), {
    method: 'POST',
    credentials: apiFetchCredentials,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      redirectTo: window.location.origin,
    }),
  })

  const payload = await response.json().catch(() => ({})) as { error?: unknown }

  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : `Could not send sign-in link: ${response.status}`,
    )
  }
}

async function signOutRemote(): Promise<RemoteAppSnapshot> {
  if (supabaseClient) {
    await supabaseClient.auth.signOut()
  }

  const response = await fetch(getApiUrl('/api/auth/logout'), {
    method: 'POST',
    credentials: apiFetchCredentials,
  })

  if (!response.ok) {
    throw new Error(`Failed to sign out: ${response.status}`)
  }

  return normalizeRemoteAppSnapshot(await response.json())
}

function normalizeRemoteAppSnapshot(payload: unknown): RemoteAppSnapshot {
  const candidate = (payload ?? {}) as { state?: unknown | null; user?: unknown | null }

  return {
    state: candidate.state ? normalizePersistedAppState(candidate.state) : null,
    user: normalizeAuthUser(candidate.user),
  }
}

function normalizeAuthUser(rawUser: unknown): AuthUser | null {
  if (!rawUser || typeof rawUser !== 'object') {
    return null
  }

  const candidate = rawUser as Partial<AuthUser>
  const id = typeof candidate.id === 'string' ? candidate.id : null
  const email = typeof candidate.email === 'string' ? candidate.email : null

  if (!id || !email) {
    return null
  }

  return {
    id,
    email,
    displayName: typeof candidate.displayName === 'string' ? candidate.displayName : email,
    isLocal: Boolean(candidate.isLocal),
  }
}

function createLocalAuthUser(): AuthUser {
  return {
    displayName: 'This device',
    email: 'local@essence.local',
    id: 'local',
    isLocal: true,
  }
}

function normalizeRemoteNoteRevision(rawRevision: unknown): NoteRevision | null {
  if (!rawRevision || typeof rawRevision !== 'object') {
    return null
  }

  const candidate = rawRevision as {
    createdAt?: unknown
    id?: unknown
    noteId?: unknown
    noteTitle?: unknown
    revisionKind?: unknown
    snapshot?: unknown
  }

  return {
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    id: String(candidate.id ?? generateId('revision')),
    noteId: typeof candidate.noteId === 'string' ? candidate.noteId : '',
    noteTitle: typeof candidate.noteTitle === 'string' ? candidate.noteTitle : 'Untitled Note',
    revisionKind: typeof candidate.revisionKind === 'string' ? candidate.revisionKind : 'snapshot',
    snapshot: normalizeStoredNote(candidate.snapshot),
  }
}

function normalizeRemoteSearchResult(rawResult: unknown): SearchResult | null {
  if (!rawResult || typeof rawResult !== 'object') {
    return null
  }

  const candidate = rawResult as {
    matchedFields?: unknown
    noteId?: unknown
    score?: unknown
  }

  if (typeof candidate.noteId !== 'string') {
    return null
  }

  return {
    matchedFields: Array.isArray(candidate.matchedFields)
      ? candidate.matchedFields.filter((field): field is string => typeof field === 'string')
      : [],
    noteId: candidate.noteId,
    score: typeof candidate.score === 'number' ? candidate.score : 0,
  }
}

function normalizePersistedAppState(rawState: unknown): PersistedAppState {
  const candidate = (rawState ?? {}) as Partial<PersistedAppState> & {
    activeNoteId?: unknown
    composerHistory?: unknown[]
    folders?: unknown[]
    notes?: unknown[]
  }
  const folders = Array.isArray(candidate.folders) ? candidate.folders.map(normalizeStoredFolder) : []
  const notes = Array.isArray(candidate.notes) ? candidate.notes.map(normalizeStoredNote) : []
  const composerHistory = Array.isArray(candidate.composerHistory)
    ? candidate.composerHistory
        .map(normalizeStoredComposerHistoryEntry)
        .filter((entry): entry is ComposerHistoryEntry => entry !== null)
        .slice(0, composerHistoryLimit)
    : []
  const activeNoteId =
    typeof candidate.activeNoteId === 'string' && notes.some((note) => note.id === candidate.activeNoteId)
      ? candidate.activeNoteId
      : notes[0]?.id ?? null

  return {
    activeNoteId,
    composerHistory,
    folders,
    notes,
  }
}

function normalizeStoredFolder(rawFolder: unknown): Folder {
  const candidate = (rawFolder ?? {}) as Partial<Folder>
  const collectionId = isCollectionId(candidate.collectionId) ? candidate.collectionId : 'ideas'

  return {
    id: typeof candidate.id === 'string' ? candidate.id : generateId('folder'),
    name: typeof candidate.name === 'string' ? candidate.name : 'Untitled Folder',
    parentId: typeof candidate.parentId === 'string' ? candidate.parentId : null,
    collectionId,
  }
}

function normalizeStoredNote(rawNote: unknown): Note {
  const candidate = (rawNote ?? {}) as Partial<Note> & {
    content?: string
    blocks?: unknown[]
    editorDoc?: unknown
    sources?: unknown[]
  }
  const collectionId = isCollectionId(candidate.collectionId) ? candidate.collectionId : 'ideas'
  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.map(normalizeStoredBlock)
    : createBlocksFromHtml(typeof candidate.content === 'string' ? candidate.content : '<p></p>')
  const safeBlocks = blocks.length > 0 ? blocks : [createEmptyBlock('paragraph')]
  const sources = Array.isArray(candidate.sources)
    ? candidate.sources.map(normalizeStoredSource).filter((source): source is NoteSource => source !== null)
    : []

  return {
    id: typeof candidate.id === 'string' ? candidate.id : generateId('note'),
    title: typeof candidate.title === 'string' ? candidate.title : 'Untitled Note',
    collectionId,
    folderId: typeof candidate.folderId === 'string' ? candidate.folderId : null,
    status: typeof candidate.status === 'string' ? candidate.status : 'Draft',
    blocks: safeBlocks,
    editorDoc: normalizeEditorDocument(candidate.editorDoc, safeBlocks),
    sources,
    tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    previewDate: typeof candidate.previewDate === 'string' ? candidate.previewDate : 'Just now',
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    isFavorite: Boolean(candidate.isFavorite),
    isPinned: Boolean(candidate.isPinned),
    isArchived: Boolean(candidate.isArchived),
    type: candidate.type === 'quote' ? 'quote' : undefined,
    layout:
      candidate.layout === 'feature' || candidate.layout === 'quote' || candidate.layout === 'standard'
        ? candidate.layout
        : 'standard',
  }
}

function normalizeStoredSource(rawSource: unknown): NoteSource | null {
  if (!rawSource || typeof rawSource !== 'object') {
    return null
  }

  const candidate = rawSource as Partial<NoteSource> & { type?: unknown }
  const sourceType = isNoteSourceKind(candidate.sourceType)
    ? candidate.sourceType
    : isNoteSourceKind(candidate.type)
      ? candidate.type
      : 'other'

  return {
    id: typeof candidate.id === 'string' ? candidate.id : generateId('source'),
    sourceType,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    author: typeof candidate.author === 'string' ? candidate.author : '',
    year: typeof candidate.year === 'string' ? candidate.year : '',
    publisher: typeof candidate.publisher === 'string' ? candidate.publisher : '',
    url: typeof candidate.url === 'string' ? candidate.url : '',
    note: typeof candidate.note === 'string' ? candidate.note : '',
  }
}

function normalizeStoredBlock(rawBlock: unknown): NoteBlock {
  const candidate = (rawBlock ?? {}) as Partial<NoteBlock>
  const type = isBlockType(candidate.type) ? candidate.type : 'paragraph'

  return {
    id: typeof candidate.id === 'string' ? candidate.id : generateId('block'),
    type,
    text: typeof candidate.text === 'string' ? candidate.text : '',
    items: Array.isArray(candidate.items)
      ? candidate.items.filter((item): item is string => typeof item === 'string')
      : type === 'bullet-list'
        ? ['']
        : undefined,
    citation: typeof candidate.citation === 'string' ? candidate.citation : '',
  }
}

function normalizeStoredComposerHistoryEntry(rawEntry: unknown): ComposerHistoryEntry | null {
  if (!rawEntry || typeof rawEntry !== 'object') {
    return null
  }

  const candidate = rawEntry as Partial<ComposerHistoryEntry> & {
    assist?: Partial<ComposerHistoryEntry['assist']>
    blocks?: unknown[]
    draft?: Partial<ComposerHistoryEntry['draft']>
  }
  const mode = candidate.mode === 'assist' || candidate.mode === 'draft' ? candidate.mode : null

  if (!mode) {
    return null
  }

  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.map(normalizeRemoteAiDraftBlock).filter((block): block is AiDraftBlock => block !== null)
    : []

  if (blocks.length === 0) {
    return null
  }

  const createdAt =
    typeof candidate.createdAt === 'string' && !Number.isNaN(Date.parse(candidate.createdAt))
      ? candidate.createdAt
      : new Date().toISOString()
  const baseEntry = {
    blocks,
    createdAt,
    id: typeof candidate.id === 'string' ? candidate.id : generateId('composer'),
    mode,
    prompt: typeof candidate.prompt === 'string' ? candidate.prompt : '',
    sourceTitle: typeof candidate.sourceTitle === 'string' ? candidate.sourceTitle : mode === 'draft' ? 'New draft' : 'Assist note',
    summary: typeof candidate.summary === 'string' ? candidate.summary : '',
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : 'Composer result',
  }

  if (mode === 'draft') {
    const category = isAiDraftCategory(candidate.draft?.category) ? candidate.draft.category : 'essay'

    return {
      ...baseEntry,
      draft: {
        category,
        collectionId: isCollectionId(candidate.draft?.collectionId) ? candidate.draft.collectionId : 'research',
        layout:
          candidate.draft?.layout === 'feature' || candidate.draft?.layout === 'quote' || candidate.draft?.layout === 'standard'
            ? candidate.draft.layout
            : 'standard',
        noteType: candidate.draft?.noteType === 'quote' ? 'quote' : undefined,
        status: typeof candidate.draft?.status === 'string' ? candidate.draft.status : 'Draft',
        tags: Array.isArray(candidate.draft?.tags)
          ? candidate.draft.tags.filter((tag): tag is string => typeof tag === 'string')
          : ['ai-draft'],
      },
    }
  }

  return {
    ...baseEntry,
    assist: {
      action: isAiAssistAction(candidate.assist?.action) ? candidate.assist.action : 'continue-writing',
      actionLabel:
        typeof candidate.assist?.actionLabel === 'string' && candidate.assist.actionLabel.trim()
          ? candidate.assist.actionLabel
          : 'Assist note',
    },
  }
}

function createBlocksFromHtml(html: string) {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser()
    const documentNode = parser.parseFromString(`<body>${html}</body>`, 'text/html')
    const blocks = Array.from(documentNode.body.childNodes).flatMap((node) => parseHtmlNode(node))
    return blocks.length > 0 ? blocks : [createEmptyBlock('paragraph')]
  }

  const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return [createTextBlock('paragraph', plainText)]
}

function parseHtmlNode(node: ChildNode): NoteBlock[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim()
    return text ? [createTextBlock('paragraph', text)] : []
  }

  if (!(node instanceof HTMLElement)) {
    return []
  }

  const tagName = node.tagName.toLowerCase()

  switch (tagName) {
    case 'p': {
      const text = node.textContent?.trim() ?? ''
      return text ? [createTextBlock('paragraph', text)] : []
    }
    case 'h1':
    case 'h2':
    case 'h3': {
      const text = node.textContent?.trim() ?? ''
      return text ? [createTextBlock('heading', text)] : []
    }
    case 'blockquote': {
      const clone = node.cloneNode(true) as HTMLElement
      const citation = clone.querySelector('cite')?.textContent?.trim() ?? ''
      clone.querySelector('cite')?.remove()
      const text = clone.textContent?.trim() ?? ''

      return text
        ? [
            {
              id: generateId('block'),
              type: 'quote',
              text,
              citation,
            },
          ]
        : []
    }
    case 'ul':
    case 'ol': {
      const items = Array.from(node.querySelectorAll('li'))
        .map((item) => item.textContent?.trim() ?? '')
        .filter(Boolean)

      return items.length > 0
        ? [
            {
              id: generateId('block'),
              type: 'bullet-list',
              items,
            },
          ]
        : []
    }
    case 'pre':
    case 'code': {
      const text = node.textContent?.trim() ?? ''
      return text ? [createTextBlock('code', text)] : []
    }
    default: {
      const text = node.textContent?.trim() ?? ''
      return text ? [createTextBlock('paragraph', text)] : []
    }
  }
}

function createTextBlock(type: Exclude<BlockType, 'bullet-list' | 'quote'>, text: string): NoteBlock {
  return {
    id: generateId('block'),
    type,
    text,
  }
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

function createEmptySourceCard(): NoteSource {
  return {
    id: generateId('source'),
    sourceType: 'paper',
    title: '',
    author: '',
    year: '',
    publisher: '',
    url: '',
    note: '',
  }
}

function noteBlocksToTiptapContent(blocks: NoteBlock[]): JSONContent {
  const content = blocks
    .map((block) => noteBlockToTiptapNode(block))
    .filter((node): node is JSONContent => Boolean(node))

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  }
}

function appendBlocksToEditorDocument(note: Note, appendedBlocks: NoteBlock[]): JSONContent {
  const currentDoc = normalizeEditorDocument(note.editorDoc, note.blocks)
  const appendedDoc = noteBlocksToTiptapContent(appendedBlocks)

  return {
    type: 'doc',
    content: [...(currentDoc.content ?? []), ...(appendedDoc.content ?? [])],
  }
}

function replaceBlockInEditorDocument(note: Note, blockId: string, replacementBlocks: NoteBlock[]): JSONContent {
  const blockIndex = note.blocks.findIndex((block) => block.id === blockId)

  if (blockIndex === -1) {
    return noteBlocksToTiptapContent(note.blocks)
  }

  const currentDoc = normalizeEditorDocument(note.editorDoc, note.blocks)
  const replacementDoc = noteBlocksToTiptapContent(replacementBlocks)
  const currentContent = currentDoc.content ?? []

  if (blockIndex >= currentContent.length) {
    return noteBlocksToTiptapContent(note.blocks.flatMap((block) => (block.id === blockId ? replacementBlocks : [block])))
  }

  return {
    type: 'doc',
    content: [
      ...currentContent.slice(0, blockIndex),
      ...(replacementDoc.content ?? []),
      ...currentContent.slice(blockIndex + 1),
    ],
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
      content: [
        {
          type: 'paragraph',
          content: createTiptapInlineContentFromText(block.text ?? ''),
        },
      ],
    }
  }

  if (block.type === 'bullet-list') {
    return {
      type: 'bulletList',
      content: (block.items && block.items.length > 0 ? block.items : ['']).map((item) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: createTiptapInlineContentFromText(item),
          },
        ],
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
        content.push({
          type: 'text',
          text: match[3],
          marks: [{ type: 'link', attrs: { href: normalizeExternalHref(match[4]) } }],
        })
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

function applyInlineFormatToText(value: string, range: TextSelectionRange, format: InlineFormat) {
  const selectedText = value.slice(range.start, range.end)
  const before = value.slice(0, range.start)
  const after = value.slice(range.end)
  const wrappedText =
    format === 'bold'
      ? `**${selectedText}**`
      : format === 'italic'
        ? `*${selectedText}*`
        : format === 'underline'
          ? `<u>${selectedText}</u>`
          : format === 'code'
            ? `\`${selectedText}\``
            : `[${selectedText}](https://)`
  const linkUrlOffset = format === 'link' ? wrappedText.length - 'https://)'.length : null

  return {
    value: `${before}${wrappedText}${after}`,
    selectionStart: linkUrlOffset === null ? before.length : before.length + linkUrlOffset,
    selectionEnd:
      linkUrlOffset === null
        ? before.length + wrappedText.length
        : before.length + wrappedText.length - 1,
  }
}

function getMarkdownBlockShortcut(
  value: string,
  selectionStart: number,
): { selectionStart: number; type: BlockType; value: string } | null {
  const beforeCursor = value.slice(0, selectionStart)
  const afterCursor = value.slice(selectionStart)

  if (beforeCursor.includes('\n') || afterCursor.trim().length > 0) {
    return null
  }

  const shortcuts: Array<{ marker: string; type: BlockType }> = [
    { marker: '# ', type: 'heading' },
    { marker: '## ', type: 'heading' },
    { marker: '> ', type: 'quote' },
    { marker: '- ', type: 'bullet-list' },
    { marker: '* ', type: 'bullet-list' },
    { marker: '```', type: 'code' },
  ]
  const matchedShortcut = shortcuts.find((shortcut) => beforeCursor === shortcut.marker)

  if (!matchedShortcut) {
    return null
  }

  return {
    type: matchedShortcut.type,
    value: '',
    selectionStart: 0,
  }
}

function noteMatchesBrowseScope(note: Note, context: NavMode, filters: Omit<FilterOptions, 'query'>) {
  if (context === 'favorites' && !note.isFavorite) {
    return false
  }

  if (context === 'archive') {
    return Boolean(note.isArchived)
  }

  if (note.isArchived) {
    return false
  }

  if (filters.collectionId && note.collectionId !== filters.collectionId) {
    return false
  }

  if (filters.folderId && !isNoteInFolderBranch(note.folderId, filters.folderId, filters.foldersById)) {
    return false
  }

  if (filters.tag && !note.tags.includes(filters.tag)) {
    return false
  }

  return true
}

function orderNotesBySearch(notes: Note[], remoteNoteIds: string[], query: string, foldersById: Record<string, Folder>) {
  if (!query) {
    return notes
  }

  const remoteOrder = new Map(remoteNoteIds.map((noteId, index) => [noteId, index]))
  const matchingNotes = notes.filter(
    (note) => remoteOrder.has(note.id) || noteMatchesLocalSearchQuery(note, query, foldersById),
  )

  if (remoteOrder.size === 0) {
    return matchingNotes
  }

  return [...matchingNotes].sort((left, right) => {
    const leftRank = remoteOrder.get(left.id)
    const rightRank = remoteOrder.get(right.id)

    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank
    }

    if (leftRank !== undefined) {
      return -1
    }

    if (rightRank !== undefined) {
      return 1
    }

    return 0
  })
}

function sortNotesForDailyUse(notes: Note[]) {
  return [...notes].sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1
    }

    return compareNotesByUpdatedAt(left, right)
  })
}

function buildLibraryHomeSections(notes: Note[]) {
  const availableNotes = notes.filter((note) => !note.isArchived)
  const usedIds = new Set<string>()
  const continuablePool = availableNotes.filter(isContinuableNote)
  const continueWriting = sortNotesForContinuation(continuablePool.length > 0 ? continuablePool : availableNotes).slice(0, 3)
  continueWriting.forEach((note) => usedIds.add(note.id))

  const pinnedNotes = sortNotesForDailyUse(
    availableNotes.filter((note) => note.isPinned && !usedIds.has(note.id)),
  ).slice(0, 4)
  pinnedNotes.forEach((note) => usedIds.add(note.id))

  const recentNotes = [...availableNotes]
    .filter((note) => !usedIds.has(note.id))
    .sort(compareNotesByUpdatedAt)
    .slice(0, 6)

  const sections = [
    {
      description: 'The notes that feel most alive right now.',
      emphasize: true,
      eyebrow: 'Daily',
      id: 'continue',
      notes: continueWriting,
      title: 'Continue Writing',
    },
    {
      description: 'Anchors worth keeping close as the library grows.',
      emphasize: false,
      eyebrow: 'Pinned',
      id: 'pinned',
      notes: pinnedNotes,
      title: 'Pinned Notes',
    },
    {
      description: 'Recent edits, references, and returning trains of thought.',
      emphasize: false,
      eyebrow: 'Recent',
      id: 'recent',
      notes: recentNotes,
      title: 'Recently Updated',
    },
  ]

  return sections.filter((section) => section.notes.length > 0)
}

function sortNotesForContinuation(notes: Note[]) {
  return [...notes].sort((left, right) => {
    const leftDraftScore = isDraftNote(left) ? 1 : 0
    const rightDraftScore = isDraftNote(right) ? 1 : 0

    if (leftDraftScore !== rightDraftScore) {
      return rightDraftScore - leftDraftScore
    }

    return compareNotesByUpdatedAt(left, right)
  })
}

function filterLibraryCards(notes: Note[], filter: LibraryQuickFilter) {
  if (filter === 'all') {
    return notes
  }

  return notes.filter((note) => noteMatchesLibraryQuickFilter(note, filter))
}

function getLibraryQuickFilterCount(notes: Note[], filter: LibraryQuickFilter) {
  return filter === 'all' ? notes.length : notes.filter((note) => noteMatchesLibraryQuickFilter(note, filter)).length
}

function noteMatchesLibraryQuickFilter(note: Note, filter: LibraryQuickFilter) {
  const normalizedStatus = note.status.trim().toLowerCase()

  switch (filter) {
    case 'drafts':
      return isDraftNote(note)
    case 'pinned':
      return note.isPinned
    case 'favorites':
      return note.isFavorite
    case 'essays':
      return normalizedStatus.includes('essay') || countWordsFromBlocks(note.blocks) >= 140
    case 'topics':
      return note.tags.length > 0 || normalizedStatus.includes('topic')
    case 'all':
    default:
      return true
  }
}

function compareNotesByUpdatedAt(left: Note, right: Note) {
  const rightTime = getNoteTimestampValue(right)
  const leftTime = getNoteTimestampValue(left)

  if (rightTime !== leftTime) {
    return rightTime - leftTime
  }

  const rightPreviewTime = getPreviewDateTimestampValue(right.previewDate)
  const leftPreviewTime = getPreviewDateTimestampValue(left.previewDate)

  if (rightPreviewTime !== leftPreviewTime) {
    return rightPreviewTime - leftPreviewTime
  }

  return left.title.localeCompare(right.title)
}

function getNoteTimestampValue(note: Note) {
  const timestamp = Date.parse(note.updatedAt)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function getPreviewDateTimestampValue(previewDate: string) {
  const trimmedValue = previewDate.trim()

  if (!trimmedValue) {
    return 0
  }

  const now = new Date()

  if (trimmedValue.toLowerCase() === 'just now') {
    return now.getTime()
  }

  if (trimmedValue.toLowerCase() === 'yesterday') {
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    yesterday.setHours(12, 0, 0, 0)
    return yesterday.getTime()
  }

  const todayMatch = trimmedValue.match(/^today,\s*(.+)$/i)

  if (todayMatch) {
    const parsedToday = Date.parse(`${now.toDateString()} ${todayMatch[1]}`)
    return Number.isNaN(parsedToday) ? now.getTime() : parsedToday
  }

  const parsedValue = Date.parse(trimmedValue)
  return Number.isNaN(parsedValue) ? 0 : parsedValue
}

function isContinuableNote(note: Note) {
  if (note.type === 'quote') {
    return false
  }

  return countWordsFromBlocks(note.blocks) > 0
}

function noteMatchesLocalSearchQuery(note: Note, query: string, foldersById: Record<string, Folder>) {
  const folderPath = getFolderPathLabel(note.folderId, foldersById)
  const haystack = `${note.title} ${getPlainTextFromBlocks(note.blocks)} ${getPlainTextFromSources(note.sources)} ${note.tags.join(' ')} ${folderPath}`.toLowerCase()
  return haystack.includes(query)
}

function getPlainTextFromSources(sources: NoteSource[]) {
  return sources
    .map((source) =>
      [
        source.title,
        source.author,
        source.year,
        source.publisher,
        source.url,
        source.note,
        formatSourceTypeLabel(source.sourceType),
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPlainTextFromBlocks(blocks: NoteBlock[]) {
  return blocks
    .map((block) => {
      if (block.type === 'bullet-list') {
        return (block.items ?? []).join(' ')
      }

      return `${block.text ?? ''} ${block.citation ?? ''}`.trim()
    })
    .join(' ')
    .replace(/\[\[([^[\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<u>([\s\S]+?)<\/u>/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildNoteTitleLookup(notes: Note[]) {
  return notes.reduce<Record<string, Note>>((lookup, note) => {
    const normalizedTitle = normalizeNoteLinkTitle(note.title)

    if (!normalizedTitle || lookup[normalizedTitle]) {
      return lookup
    }

    lookup[normalizedTitle] = note
    return lookup
  }, {})
}

function normalizeNoteLinkTitle(title: string) {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

function getBlockTextsForNoteLinkParsing(block: NoteBlock) {
  if (block.type === 'code') {
    return []
  }

  if (block.type === 'bullet-list') {
    return block.items ?? []
  }

  return [block.text ?? '', block.citation ?? '']
}

function extractNoteLinkTitles(text: string) {
  return Array.from(text.matchAll(/\[\[([^[\]]+)\]\]/g))
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
}

function getResolvedLinkedNoteIds(note: Note, notesByNormalizedTitle: Record<string, Note>) {
  const linkedNoteIds = new Set<string>()

  note.blocks.forEach((block) => {
    getBlockTextsForNoteLinkParsing(block).forEach((text) => {
      extractNoteLinkTitles(text).forEach((title) => {
        const linkedNote = notesByNormalizedTitle[normalizeNoteLinkTitle(title)]

        if (linkedNote && linkedNote.id !== note.id) {
          linkedNoteIds.add(linkedNote.id)
        }
      })
    })
  })

  return Array.from(linkedNoteIds)
}

function getResolvedLinkedNotes(
  note: Note,
  notesByNormalizedTitle: Record<string, Note>,
  notesById: Record<string, Note>,
) {
  return getResolvedLinkedNoteIds(note, notesByNormalizedTitle)
    .map((noteId) => notesById[noteId] ?? null)
    .filter((candidate): candidate is Note => Boolean(candidate))
}

function getMatchingLinkNotes(query: string, notes: Note[], activeNoteId: string | null) {
  const normalizedQuery = query.trim().toLowerCase()

  return notes
    .filter((note) => note.id !== activeNoteId)
    .filter((note) => {
      if (!normalizedQuery) {
        return true
      }

      const haystack = `${note.title} ${note.status} ${note.tags.join(' ')}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
    .slice(0, 8)
}

function getActiveNoteLinkContext(value: string, selectionStart: number | null) {
  if (selectionStart === null) {
    return null
  }

  const leadingText = value.slice(0, selectionStart)
  const replacementStart = leadingText.lastIndexOf('[[')

  if (replacementStart === -1) {
    return null
  }

  if (leadingText.slice(replacementStart + 2).includes('\n')) {
    return null
  }

  const lastClosedIndex = leadingText.lastIndexOf(']]')

  if (lastClosedIndex > replacementStart) {
    return null
  }

  return {
    query: leadingText.slice(replacementStart + 2).trim(),
    replacementStart,
    replacementEnd: selectionStart + (value.slice(selectionStart).startsWith(']]') ? 2 : 0),
  }
}

function replaceActiveNoteLinkQuery(value: string, noteTitle: string, context: Pick<LinkMenuState, 'replacementEnd' | 'replacementStart'>) {
  return `${value.slice(0, context.replacementStart)}[[${noteTitle}]]${value.slice(context.replacementEnd)}`
}

function summarizeBlocks(blocks: NoteBlock[]) {
  const text = getPlainTextFromBlocks(blocks)

  if (text.length <= 148) {
    return text
  }

  return `${text.slice(0, 145).trimEnd()}...`
}

function countWordsFromBlocks(blocks: NoteBlock[]) {
  const text = getPlainTextFromBlocks(blocks)

  if (!text) {
    return 0
  }

  return text.split(/\s+/).length
}

function getFolderPathLabel(folderId: string | null, foldersById: Record<string, Folder>) {
  if (!folderId || !foldersById[folderId]) {
    return ''
  }

  return getFolderTrail(folderId, foldersById)
    .map((folder) => folder.name)
    .join(' / ')
}

function getFolderTrail(folderId: string, foldersById: Record<string, Folder>) {
  const trail: Folder[] = []
  let currentFolderId: string | null = folderId

  while (currentFolderId) {
    const currentFolder: Folder | undefined = foldersById[currentFolderId]

    if (!currentFolder) {
      break
    }

    trail.unshift(currentFolder)
    currentFolderId = currentFolder.parentId
  }

  return trail
}

function buildFolderLookup(folders: Folder[]) {
  return folders.reduce<Record<string, Folder>>((accumulator, folder) => {
    accumulator[folder.id] = folder
    return accumulator
  }, {})
}

function getDescendantFolderIds(folderId: string, folders: Folder[]) {
  const descendants: string[] = []
  const queue = folders.filter((folder) => folder.parentId === folderId).map((folder) => folder.id)

  while (queue.length > 0) {
    const currentId = queue.shift()

    if (!currentId) {
      continue
    }

    descendants.push(currentId)
    folders
      .filter((folder) => folder.parentId === currentId)
      .forEach((folder) => queue.push(folder.id))
  }

  return descendants
}

function isNoteInFolderBranch(
  noteFolderId: string | null,
  targetFolderId: string,
  foldersById: Record<string, Folder>,
) {
  let currentFolderId = noteFolderId

  while (currentFolderId) {
    if (currentFolderId === targetFolderId) {
      return true
    }

    currentFolderId = foldersById[currentFolderId]?.parentId ?? null
  }

  return false
}

function updateBlockValue(block: NoteBlock, value: string): NoteBlock {
  if (block.type === 'bullet-list') {
    return {
      ...block,
      items: value.split('\n'),
    }
  }

  return {
    ...block,
    text: value,
  }
}

function getBlockTextValue(block: NoteBlock) {
  return block.type === 'bullet-list' ? (block.items ?? []).join('\n') : block.text ?? ''
}

function getDefaultNoteViewMode(note: Note): NoteViewMode {
  const isDraftLike = isDraftNote(note)

  return isDraftLike ? 'edit' : 'read'
}

function isDraftNote(note: Pick<Note, 'status'>) {
  return note.status.trim().toLowerCase() === 'draft'
}

function isPublishedNote(note: Pick<Note, 'status'>) {
  return note.status.trim().toLowerCase() === 'published'
}

function removeDraftTags(tags: string[]) {
  return tags.filter((tag) => {
    const normalizedTag = tag.trim().toLowerCase()
    return normalizedTag !== 'draft' && normalizedTag !== 'drafts' && normalizedTag !== 'ai-draft'
  })
}

function convertBlockType(block: NoteBlock, nextType: BlockType): NoteBlock {
  const baseText = getBlockTextValue(block)

  switch (nextType) {
    case 'bullet-list':
      return {
        id: block.id,
        type: 'bullet-list',
        items: baseText ? baseText.split('\n') : [''],
      }
    case 'quote':
      return {
        id: block.id,
        type: 'quote',
        text: baseText,
        citation: block.citation ?? '',
      }
    case 'code':
      return {
        id: block.id,
        type: 'code',
        text: baseText,
      }
    case 'heading':
      return {
        id: block.id,
        type: 'heading',
        text: baseText,
      }
    default:
      return {
        id: block.id,
        type: 'paragraph',
        text: baseText,
      }
  }
}

function insertBlock(blocks: NoteBlock[], block: NoteBlock, afterBlockId?: string | null) {
  if (!afterBlockId) {
    return [...blocks, block]
  }

  const targetIndex = blocks.findIndex((candidate) => candidate.id === afterBlockId)

  if (targetIndex === -1) {
    return [...blocks, block]
  }

  return [...blocks.slice(0, targetIndex + 1), block, ...blocks.slice(targetIndex + 1)]
}

function removeBlockFromList(blocks: NoteBlock[], blockId: string) {
  const remainingBlocks = blocks.filter((block) => block.id !== blockId)
  return remainingBlocks.length > 0 ? remainingBlocks : [createEmptyBlock('paragraph')]
}

function moveBlockInList(blocks: NoteBlock[], blockId: string, direction: 'up' | 'down') {
  const currentIndex = blocks.findIndex((block) => block.id === blockId)

  if (currentIndex === -1) {
    return blocks
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

  if (targetIndex < 0 || targetIndex >= blocks.length) {
    return blocks
  }

  const nextBlocks = [...blocks]
  const [movedBlock] = nextBlocks.splice(currentIndex, 1)
  nextBlocks.splice(targetIndex, 0, movedBlock)
  return nextBlocks
}

function isBlockEmpty(block: NoteBlock) {
  if (block.type === 'bullet-list') {
    return (block.items ?? []).every((item) => item.trim().length === 0)
  }

  return [block.text ?? '', block.citation ?? ''].every((value) => value.trim().length === 0)
}

function trimTrailingEmptyItems(items: string[]) {
  const nextItems = [...items]

  while (nextItems.length > 0 && nextItems[nextItems.length - 1].trim().length === 0) {
    nextItems.pop()
  }

  return nextItems
}

function getSlashQuery(type: BlockType, value: string) {
  if (type === 'code') {
    return null
  }

  if (!value.startsWith('/') || value.includes('\n')) {
    return null
  }

  return value.slice(1).trim().toLowerCase()
}

function getMatchingSlashMenuItems(query: string) {
  if (!query) {
    return slashMenuOptions
  }

  return slashMenuOptions.filter((item) => {
    const haystack = [item.title, item.description, ...item.keywords].join(' ').toLowerCase()
    return haystack.includes(query)
  })
}

function getBlockPlaceholder(type: BlockType) {
  switch (type) {
    case 'heading':
      return 'Section heading'
    case 'quote':
      return 'Write the quotation'
    case 'bullet-list':
      return 'Write one bullet per line'
    case 'code':
      return 'Write code or structured notes'
    default:
      return 'Start writing'
  }
}

function getBlockRows(block: NoteBlock) {
  if (block.type === 'heading') {
    return 2
  }

  if (block.type === 'quote') {
    return 3
  }

  if (block.type === 'code') {
    return 4
  }

  if (block.type === 'bullet-list') {
    return Math.max(3, (block.items ?? []).length + 1)
  }

  return 4
}

function parseImportedJsonState(rawText: string) {
  const parsed = JSON.parse(rawText) as unknown

  if (Array.isArray(parsed)) {
    return normalizePersistedAppState({
      activeNoteId: null,
      folders: [],
      notes: parsed,
    })
  }

  if (parsed && typeof parsed === 'object' && 'state' in parsed) {
    return normalizePersistedAppState((parsed as { state?: unknown }).state)
  }

  return normalizePersistedAppState(parsed)
}

function cloneImportedStateWithFreshIds(state: PersistedAppState): PersistedAppState {
  const folderIdMap = new Map<string, string>()
  const noteIdMap = new Map<string, string>()

  const folders = state.folders.map((folder) => {
    const nextId = generateId('folder')
    folderIdMap.set(folder.id, nextId)

    return {
      ...folder,
      id: nextId,
      parentId: null,
    }
  })

  const normalizedFolders = folders.map((folder, index) => ({
    ...folder,
    parentId: state.folders[index]?.parentId ? folderIdMap.get(state.folders[index].parentId) ?? null : null,
  }))

  const notes = state.notes.map((note) => {
    const nextId = generateId('note')
    noteIdMap.set(note.id, nextId)
    const blocks = note.blocks.map((block) => ({
      id: generateId('block'),
      type: block.type,
      text: typeof block.text === 'string' ? block.text : '',
      items: Array.isArray(block.items)
        ? [...block.items]
        : block.type === 'bullet-list'
          ? ['']
          : undefined,
      citation: typeof block.citation === 'string' ? block.citation : '',
    }))

    return {
      ...note,
      id: nextId,
      folderId: note.folderId ? folderIdMap.get(note.folderId) ?? null : null,
      tags: [...note.tags],
      sources: note.sources.map((source) => ({
        ...source,
        id: generateId('source'),
      })),
      blocks,
      editorDoc: normalizeEditorDocument(note.editorDoc, blocks),
    }
  })

  return {
    activeNoteId: state.activeNoteId ? noteIdMap.get(state.activeNoteId) ?? notes[0]?.id ?? null : notes[0]?.id ?? null,
    composerHistory: state.composerHistory.map((entry) => ({
      ...entry,
      id: generateId('composer'),
      blocks: cloneAiDraftBlocks(entry.blocks),
      draft: entry.draft
        ? {
            ...entry.draft,
            tags: [...entry.draft.tags],
          }
        : undefined,
      assist: entry.assist ? { ...entry.assist } : undefined,
    })),
    folders: normalizedFolders,
    notes,
  }
}

function serializeNoteToMarkdown(note: Note, foldersById: Record<string, Folder>) {
  const folderPath = getFolderPathLabel(note.folderId, foldersById)
  const frontmatter = [
    '---',
    `title: ${formatMarkdownFrontmatterValue(note.title)}`,
    `collection: ${note.collectionId}`,
    ...(folderPath ? [`folder: ${formatMarkdownFrontmatterValue(folderPath)}`] : []),
    `status: ${formatMarkdownFrontmatterValue(note.status)}`,
    `tags: [${note.tags.map((tag) => formatMarkdownFrontmatterValue(tag)).join(', ')}]`,
    ...(note.sources.length > 0 ? [`sources: ${JSON.stringify(note.sources)}`] : []),
    `favorite: ${note.isFavorite ? 'true' : 'false'}`,
    `pinned: ${note.isPinned ? 'true' : 'false'}`,
    `archived: ${note.isArchived ? 'true' : 'false'}`,
    `layout: ${note.layout}`,
    `updated_at: ${formatMarkdownFrontmatterValue(note.updatedAt)}`,
    ...(note.type ? [`type: ${note.type}`] : []),
    '---',
  ]
  const body = serializeBlocksToMarkdown(note.blocks)

  return `${frontmatter.join('\n')}\n\n${body}${body ? '\n' : ''}`
}

function serializeBlocksToMarkdown(blocks: NoteBlock[]) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `## ${(block.text ?? '').trim()}`.trim()
        case 'quote': {
          const quoteLines = (block.text ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `> ${line}`)

          if (block.citation?.trim()) {
            quoteLines.push('>')
            quoteLines.push(`> -- ${block.citation.trim()}`)
          }

          return quoteLines.join('\n').trim()
        }
        case 'bullet-list':
          return (block.items ?? [])
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => `- ${item}`)
            .join('\n')
        case 'code':
          return `\`\`\`\n${(block.text ?? '').trimEnd()}\n\`\`\``
        default:
          return (block.text ?? '').trim()
      }
    })
    .filter((section) => section.length > 0)
    .join('\n\n')
}

function parseMarkdownNote(markdown: string, fileName: string): ImportedMarkdownNote {
  const { metadata, body } = extractMarkdownFrontmatter(markdown)
  const { title: titleFromBody, body: noteBody } = extractTitleFromMarkdownBody(body)
  const blocks = parseMarkdownBlocks(noteBody)
  const collectionId = isCollectionId(metadata.collection) ? metadata.collection : 'ideas'
  const inferredType = metadata.type === 'quote' || (blocks.length === 1 && blocks[0]?.type === 'quote') ? 'quote' : undefined
  const note: Note = {
    id: generateId('note'),
    title: metadata.title ?? titleFromBody ?? humanizeImportedFilename(fileName),
    collectionId,
    folderId: null,
    status: metadata.status ?? inferImportedStatus(blocks, inferredType),
    blocks,
    editorDoc: noteBlocksToTiptapContent(blocks),
    sources: metadata.sources ?? [],
    tags: dedupeStrings(metadata.tags ?? []),
    previewDate: 'Just now',
    updatedAt: metadata.updatedAt ?? new Date().toISOString(),
    isFavorite: metadata.favorite ?? false,
    isPinned: metadata.pinned ?? false,
    isArchived: metadata.archived ?? false,
    type: inferredType,
    layout: metadata.layout ?? inferImportedLayout(blocks, inferredType),
  }

  return {
    note,
    folderPath:
      typeof metadata.folder === 'string'
        ? metadata.folder
            .split('/')
            .map((segment) => segment.trim())
            .filter(Boolean)
        : [],
  }
}

function extractMarkdownFrontmatter(markdown: string) {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, '\n').trim()
  const frontmatterMatch = normalizedMarkdown.match(/^---\n([\s\S]*?)\n---\n?/)

  if (!frontmatterMatch) {
    return {
      metadata: {} as {
        title?: string
        collection?: string
        folder?: string
        status?: string
        sources?: NoteSource[]
        tags?: string[]
        favorite?: boolean
        pinned?: boolean
        archived?: boolean
        layout?: NoteLayout
        updatedAt?: string
        type?: NoteType
      },
      body: normalizedMarkdown,
    }
  }

  return {
    metadata: parseMarkdownFrontmatterBlock(frontmatterMatch[1]),
    body: normalizedMarkdown.slice(frontmatterMatch[0].length).trim(),
  }
}

function parseMarkdownFrontmatterBlock(rawFrontmatter: string) {
  const metadata: {
    title?: string
    collection?: string
    folder?: string
    status?: string
    sources?: NoteSource[]
    tags?: string[]
    favorite?: boolean
    pinned?: boolean
    archived?: boolean
    layout?: NoteLayout
    updatedAt?: string
    type?: NoteType
  } = {}
  let activeListKey: 'tags' | null = null

  rawFrontmatter.split('\n').forEach((line) => {
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      activeListKey = null
      return
    }

    const listMatch = trimmedLine.match(/^-\s+(.*)$/)

    if (listMatch && activeListKey === 'tags') {
      metadata.tags = [...(metadata.tags ?? []), stripMarkdownQuotes(listMatch[1].trim())]
      return
    }

    const fieldMatch = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)

    if (!fieldMatch) {
      return
    }

    const [, key, rawValue] = fieldMatch
    const normalizedKey = key.toLowerCase()
    const parsedValue = parseMarkdownFrontmatterValue(rawValue.trim())
    activeListKey = null

    switch (normalizedKey) {
      case 'title':
      case 'folder':
      case 'status':
        if (typeof parsedValue === 'string') {
          metadata[normalizedKey] = parsedValue
        }
        break
      case 'collection':
        if (typeof parsedValue === 'string') {
          metadata.collection = parsedValue.toLowerCase()
        }
        break
      case 'tags':
        if (Array.isArray(parsedValue)) {
          metadata.tags = parsedValue.filter((value): value is string => typeof value === 'string')
        } else if (typeof parsedValue === 'string' && parsedValue.length > 0) {
          metadata.tags = parsedValue
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        } else {
          metadata.tags = []
          activeListKey = 'tags'
        }
        break
      case 'sources':
        if (Array.isArray(parsedValue)) {
          metadata.sources = parsedValue
            .map(normalizeStoredSource)
            .filter((source): source is NoteSource => source !== null)
        }
        break
      case 'favorite':
        if (typeof parsedValue === 'boolean') {
          metadata.favorite = parsedValue
        }
        break
      case 'pinned':
        if (typeof parsedValue === 'boolean') {
          metadata.pinned = parsedValue
        }
        break
      case 'archived':
        if (typeof parsedValue === 'boolean') {
          metadata.archived = parsedValue
        }
        break
      case 'updated_at':
      case 'updatedat':
        if (typeof parsedValue === 'string') {
          metadata.updatedAt = parsedValue
        }
        break
      case 'layout':
        if (parsedValue === 'feature' || parsedValue === 'standard' || parsedValue === 'quote') {
          metadata.layout = parsedValue
        }
        break
      case 'type':
        if (parsedValue === 'quote') {
          metadata.type = 'quote'
        }
        break
      default:
        break
    }
  })

  return metadata
}

function parseMarkdownFrontmatterValue(value: string): unknown {
  if (!value) {
    return ''
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    if (value.includes('{')) {
      try {
        return JSON.parse(value)
      } catch {
        return []
      }
    }

    return value
      .slice(1, -1)
      .split(',')
      .map((entry) => stripMarkdownQuotes(entry.trim()))
      .filter(Boolean)
  }

  return stripMarkdownQuotes(value)
}

function stripMarkdownQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function extractTitleFromMarkdownBody(markdown: string) {
  const titleMatch = markdown.match(/^#\s+(.+?)\s*(?:\n|$)/)

  if (!titleMatch) {
    return {
      title: null as string | null,
      body: markdown.trim(),
    }
  }

  return {
    title: titleMatch[1].trim(),
    body: markdown.slice(titleMatch[0].length).trim(),
  }
}

function parseMarkdownBlocks(markdown: string) {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim()

  if (!normalized) {
    return [createEmptyBlock('paragraph')]
  }

  const lines = normalized.split('\n')
  const blocks: NoteBlock[] = []
  let index = 0

  while (index < lines.length) {
    const currentLine = lines[index]

    if (!currentLine.trim()) {
      index += 1
      continue
    }

    if (currentLine.trim().startsWith('```')) {
      const codeLines: string[] = []
      index += 1

      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      blocks.push({
        id: generateId('block'),
        type: 'code',
        text: codeLines.join('\n').trimEnd(),
      })
      continue
    }

    if (/^#{1,6}\s+/.test(currentLine)) {
      blocks.push({
        id: generateId('block'),
        type: 'heading',
        text: currentLine.replace(/^#{1,6}\s+/, '').trim(),
      })
      index += 1
      continue
    }

    if (/^>\s?/.test(currentLine)) {
      const quoteLines: string[] = []

      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, '').trimEnd())
        index += 1
      }

      const trimmedQuoteLines = [...quoteLines]

      while (trimmedQuoteLines[0] !== undefined && trimmedQuoteLines[0].trim().length === 0) {
        trimmedQuoteLines.shift()
      }

      while (
        trimmedQuoteLines[trimmedQuoteLines.length - 1] !== undefined &&
        trimmedQuoteLines[trimmedQuoteLines.length - 1].trim().length === 0
      ) {
        trimmedQuoteLines.pop()
      }

      const lastLine = trimmedQuoteLines[trimmedQuoteLines.length - 1] ?? ''
      const citationMatch = lastLine.match(/^(?:--|—)\s*(.+)$/)
      const citation = citationMatch ? citationMatch[1].trim() : ''

      if (citationMatch) {
        trimmedQuoteLines.pop()
      }

      blocks.push({
        id: generateId('block'),
        type: 'quote',
        text: trimmedQuoteLines.join('\n').trim(),
        citation,
      })
      continue
    }

    if (/^[-*]\s+/.test(currentLine)) {
      const items: string[] = []

      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, '').trim())
        index += 1
      }

      blocks.push({
        id: generateId('block'),
        type: 'bullet-list',
        items: items.length > 0 ? items : [''],
      })
      continue
    }

    const paragraphLines: string[] = []

    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trimEnd())
      index += 1
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        id: generateId('block'),
        type: 'paragraph',
        text: paragraphLines.join('\n').trim(),
      })
    }
  }

  return blocks.length > 0 ? blocks : [createEmptyBlock('paragraph')]
}

function isMarkdownBlockStart(line: string) {
  return /^#{1,6}\s+/.test(line) || /^>\s?/.test(line) || /^[-*]\s+/.test(line) || line.trim().startsWith('```')
}

function ensureFolderPath(folderPath: string[], collectionId: CollectionId, folders: Folder[]) {
  let nextFolders = [...folders]
  let parentId: string | null = null

  folderPath.forEach((segment) => {
    const existingFolder = nextFolders.find(
      (folder) =>
        folder.collectionId === collectionId &&
        folder.parentId === parentId &&
        folder.name.toLowerCase() === segment.toLowerCase(),
    )

    if (existingFolder) {
      parentId = existingFolder.id
      return
    }

    const nextFolder: Folder = {
      id: generateId('folder'),
      name: segment,
      parentId,
      collectionId,
    }

    nextFolders = [...nextFolders, nextFolder]
    parentId = nextFolder.id
  })

  return {
    folders: nextFolders,
    folderId: parentId,
  }
}

function inferImportedStatus(blocks: NoteBlock[], type: NoteType) {
  if (type === 'quote') {
    return 'Quote'
  }

  return countWordsFromBlocks(blocks) >= 140 ? 'Essay' : 'Draft'
}

function inferImportedLayout(blocks: NoteBlock[], type: NoteType): NoteLayout {
  if (type === 'quote') {
    return 'quote'
  }

  return countWordsFromBlocks(blocks) >= 140 || blocks.some((block) => block.type === 'heading')
    ? 'feature'
    : 'standard'
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeTopicTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36)
}

function formatMarkdownFrontmatterValue(value: string) {
  return JSON.stringify(value)
}

function createFileSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'untitled-note'
}

function humanizeImportedFilename(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const withSpaces = baseName.replace(/[-_]+/g, ' ').trim()

  if (!withSpaces) {
    return 'Imported Note'
  }

  return withSpaces.replace(/\b\w/g, (character) => character.toUpperCase())
}

function getExportDateStamp() {
  return new Date().toISOString().slice(0, 10)
}

function downloadTextFile(fileName: string, contents: string, mimeType: string) {
  if (typeof window === 'undefined') {
    return
  }

  const blob = new Blob([contents], { type: mimeType })
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  window.URL.revokeObjectURL(objectUrl)
}

function cloneHistorySnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return {
    activeCollectionId: snapshot.activeCollectionId,
    activeFolderId: snapshot.activeFolderId,
    activeNoteId: snapshot.activeNoteId,
    activeTag: snapshot.activeTag,
    editorContext: snapshot.editorContext,
    expandedFolderIds: [...snapshot.expandedFolderIds],
    folders: snapshot.folders.map((folder) => ({ ...folder })),
    noteViewMode: snapshot.noteViewMode,
    notes: snapshot.notes.map((note) => ({
      ...note,
      editorDoc: note.editorDoc ? structuredClone(note.editorDoc) : null,
      sources: note.sources.map((source) => ({ ...source })),
      tags: [...note.tags],
      blocks: note.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        text: block.text,
        items: block.items ? [...block.items] : undefined,
        citation: block.citation,
      })),
    })),
    view: snapshot.view,
  }
}

function getQuickSwitcherKindLabel(kind: QuickSwitcherItemKind) {
  switch (kind) {
    case 'action':
      return 'Action'
    case 'collection':
      return 'Collection'
    case 'folder':
      return 'Folder'
    case 'tag':
      return 'Tag'
    default:
      return 'Note'
  }
}

function getQuickSwitcherIconName(kind: QuickSwitcherItemKind) {
  switch (kind) {
    case 'action':
      return 'compose'
    case 'collection':
      return 'grid'
    case 'folder':
      return 'folder'
    case 'tag':
      return 'hash'
    default:
      return 'library'
  }
}

function getRevisionKindLabel(revisionKind: string) {
  switch (revisionKind) {
    case 'created':
      return 'Created'
    case 'restored':
      return 'Restored'
    case 'deleted':
      return 'Deleted'
    default:
      return 'Snapshot'
  }
}

function formatRevisionTimestamp(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatSourceTypeLabel(sourceType: NoteSourceKind) {
  return sourceTypeOptions.find((option) => option.value === sourceType)?.label ?? 'Source'
}

function formatSourceByline(source: NoteSource) {
  const pieces = [source.author, source.publisher].filter((piece) => piece.trim().length > 0)

  if (pieces.length === 0) {
    return 'Reference source'
  }

  return pieces.join(' · ')
}

function hasSourceContent(source: NoteSource) {
  return [source.title, source.author, source.year, source.publisher, source.url, source.note].some(
    (value) => value.trim().length > 0,
  )
}

function normalizeExternalHref(value: string) {
  const trimmedValue = value.trim()

  if (/^(https?:|mailto:|doi:)/i.test(trimmedValue)) {
    return trimmedValue
  }

  return `https://${trimmedValue}`
}

function formatCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function summarizeInlineText(value: string, maxLength: number) {
  const normalizedValue = value.replace(/\s+/g, ' ').trim()

  if (normalizedValue.length <= maxLength) {
    return normalizedValue
  }

  return `${normalizedValue.slice(0, maxLength - 3).trimEnd()}...`
}

function getAccountInitials(value: string) {
  const initials = value
    .split(/[\s@._-]+/)
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return initials || 'E'
}

function generateId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function preventButtonFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]')) ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function isBlockType(value: unknown): value is BlockType {
  return (
    value === 'paragraph' ||
    value === 'heading' ||
    value === 'quote' ||
    value === 'bullet-list' ||
    value === 'code'
  )
}

function isCollectionId(value: unknown): value is CollectionId {
  return value === 'work' || value === 'personal' || value === 'research' || value === 'ideas'
}

function isAiDraftCategory(value: unknown): value is AiDraftCategory {
  return value === 'essay' || value === 'article' || value === 'research-topic' || value === 'quote'
}

function isAiAssistAction(value: unknown): value is AiAssistAction {
  return (
    value === 'continue-writing' ||
    value === 'improve-clarity' ||
    value === 'create-outline' ||
    value === 'study-questions' ||
    value === 'counterarguments' ||
    value === 'reading-list'
  )
}

function isNoteSourceKind(value: unknown): value is NoteSourceKind {
  return (
    value === 'book' ||
    value === 'paper' ||
    value === 'article' ||
    value === 'web' ||
    value === 'dataset' ||
    value === 'other'
  )
}

// Keep the previous block editor path rollback-safe while the Tiptap surface is validated.
void BlockRow
void getMarkdownBlockShortcut
void getMatchingLinkNotes
void getActiveNoteLinkContext
void replaceActiveNoteLinkQuery
void updateBlockValue
void convertBlockType
void insertBlock
void removeBlockFromList
void moveBlockInList
void isBlockEmpty
void trimTrailingEmptyItems
void getSlashQuery
void getMatchingSlashMenuItems

export default App
