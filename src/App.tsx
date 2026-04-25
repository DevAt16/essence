import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from 'react'
import './App.css'

type ViewMode = 'library' | 'collections' | 'search' | 'favorites' | 'archive' | 'editor'
type NavMode = Exclude<ViewMode, 'editor'>
type CollectionId = 'work' | 'personal' | 'research' | 'ideas'
type CollectionIcon = 'briefcase' | 'person' | 'flask' | 'bulb'
type NoteLayout = 'feature' | 'standard' | 'quote'
type NoteType = 'quote' | undefined
type BlockType = 'paragraph' | 'heading' | 'quote' | 'bullet-list' | 'code'
type NoteViewMode = 'read' | 'edit'

interface NoteBlock {
  id: string
  type: BlockType
  text?: string
  items?: string[]
  citation?: string
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

interface Note {
  id: string
  title: string
  collectionId: CollectionId
  folderId: string | null
  status: string
  blocks: NoteBlock[]
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
  folders: Folder[]
  notes: Note[]
}

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
const historyLimit = 120

function createEmptyPersistedState(): PersistedAppState {
  return {
    activeNoteId: null,
    folders: [],
    notes: [],
  }
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
] as const

const browseViewMeta: Record<NavMode, { heading: string; description: string }> = {
  library: {
    heading: 'Library',
    description: 'Your recent thoughts and collections.',
  },
  collections: {
    heading: 'Collections',
    description: 'Collections, nested folders, and tags.',
  },
  search: {
    heading: 'Search',
    description: 'Find a phrase, a block, or a hidden draft.',
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

const blockToolbarButtons: Array<{ type: BlockType; label: string; ariaLabel: string }> = [
  { type: 'paragraph', label: 'P', ariaLabel: 'Add paragraph block' },
  { type: 'heading', label: 'H', ariaLabel: 'Add heading block' },
  { type: 'quote', label: '“”', ariaLabel: 'Add quote block' },
  { type: 'bullet-list', label: '•', ariaLabel: 'Add bullet list block' },
  { type: 'code', label: '<>', ariaLabel: 'Add code block' },
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
    tags: ['reading-list'],
    previewDate: 'Oct 20, 2023',
    updatedAt: '2026-04-20T12:00:00.000Z',
    isFavorite: true,
    isPinned: true,
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
  folders: initialFolders,
  notes: initialNotes,
}

function App() {
  const [view, setView] = useState<ViewMode>('library')
  const [editorContext, setEditorContext] = useState<NavMode>('library')
  const [folders, setFolders] = useState<Folder[]>(loadStoredFolders)
  const [notes, setNotes] = useState<Note[]>(loadStoredNotes)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(loadStoredActiveNoteId)
  const [activeCollectionId, setActiveCollectionId] = useState<CollectionId | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [saveMessage, setSaveMessage] = useState('Saved just now')
  const [zenMode, setZenMode] = useState(false)
  const [noteViewMode, setNoteViewMode] = useState<NoteViewMode>('edit')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [blockFocusRequest, setBlockFocusRequest] = useState<BlockFocusRequest | null>(null)
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
  const saveTimerRef = useRef<number | null>(null)
  const remoteSyncTimerRef = useRef<number | null>(null)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
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
  const deferredSearch = useDeferredValue(searchQuery.trim().toLowerCase())
  const deferredQuickSwitcherQuery = useDeferredValue(quickSwitcherQuery.trim().toLowerCase())

  const foldersById = useMemo(() => buildFolderLookup(folders), [folders])

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? notes[0] ?? null,
    [activeNoteId, notes],
  )

  const activeFolder = activeFolderId ? foldersById[activeFolderId] ?? null : null

  useEffect(() => {
    setSelectedBlockId(activeNote?.blocks[0]?.id ?? null)
    setSlashMenuState(null)
    setLinkMenuState(null)
  }, [activeNoteId, activeNote])

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
    if (noteViewMode === 'read' && zenMode) {
      setZenMode(false)
    }
  }, [noteViewMode, zenMode])

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
        const remoteState = await fetchRemoteAppState()
        const resolvedState = remoteState ?? createEmptyPersistedState()

        if (isCancelled) {
          return
        }

        lastRemoteSnapshotRef.current = JSON.stringify(resolvedState)
        setFolders(resolvedState.folders)
        setNotes(resolvedState.notes)
        setActiveNoteId(resolvedState.activeNoteId)
        setRemoteSyncVersion((currentValue) => currentValue + 1)
      } catch (error) {
        console.warn('PostgreSQL sync unavailable, continuing with local storage.', error)
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
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        activeNoteId,
        folders,
        notes,
      }),
    )
  }, [activeNoteId, folders, notes])

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
    activeCollectionId,
    activeFolderId,
    activeNoteId,
    activeTag,
    editorContext,
    expandedFolderIds,
    folders,
    noteViewMode,
    notes,
    remoteSyncReady,
    view,
  ])

  useEffect(() => {
    if (typeof window === 'undefined' || !remoteSyncReady) {
      return
    }

    const nextState: PersistedAppState = {
      activeNoteId,
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
        .catch(() => {
          setSaveMessage('Saved locally')
        })
    }, 700)

    return () => {
      if (remoteSyncTimerRef.current) {
        window.clearTimeout(remoteSyncTimerRef.current)
      }
    }
  }, [activeNoteId, folders, notes, remoteSyncReady])

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
    if (!remoteSyncReady || !deferredSearch) {
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
      .catch(() => {
        if (!isCancelled) {
          setRemoteBrowseSearchResults(null)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [deferredSearch, remoteSyncReady, remoteSyncVersion])

  useEffect(() => {
    if (!remoteSyncReady || !deferredQuickSwitcherQuery) {
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
      .catch(() => {
        if (!isCancelled) {
          setRemoteQuickSearchResults(null)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [deferredQuickSwitcherQuery, remoteSyncReady, remoteSyncVersion])

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
  const activeSlashItems = useMemo(
    () => (slashMenuState ? getMatchingSlashMenuItems(slashMenuState.query) : []),
    [slashMenuState],
  )
  const activeLinkSuggestions = useMemo(
    () => (linkMenuState ? getMatchingLinkNotes(linkMenuState.query, notes, activeNoteId) : []),
    [activeNoteId, linkMenuState, notes],
  )
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
    if (!noteHistoryOpen || view !== 'editor' || !activeNote) {
      return
    }

    let isCancelled = false

    setNoteHistoryLoading(true)
    setNoteHistoryError(null)

    void fetchRemoteNoteRevisions(activeNote.id, 24)
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
  }, [activeNote?.id, noteHistoryOpen, remoteSyncVersion, view])

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
        id: 'action-search',
        kind: 'action',
        title: 'Go to Search',
        subtitle: 'Search notes, blocks, tags, and folders.',
        keywords: 'search find discover command palette',
        target: { type: 'navigate', view: 'search' },
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
        keywords: `${note.title} ${note.status} ${note.tags.join(' ')} ${getPlainTextFromBlocks(note.blocks)}`.toLowerCase(),
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

  const createHistorySnapshot = (): HistorySnapshot => ({
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
  })

  const updateHistoryState = () => {
    setHistoryState({
      canUndo: historyRef.current.past.length > 0,
      canRedo: historyRef.current.future.length > 0,
    })
  }

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

  const closeQuickSwitcher = () => {
    setQuickSwitcherOpen(false)
  }

  const openQuickSwitcher = () => {
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

  const toggleNoteHistory = () => {
    if (!activeNote || view !== 'editor') {
      return
    }

    setQuickSwitcherOpen(false)
    setSlashMenuState(null)
    setLinkMenuState(null)
    setNoteHistoryOpen((currentValue) => !currentValue)
  }

  const openSearchView = () => {
    setZenMode(false)
    setQuickSwitcherOpen(false)
    setActiveCollectionId(null)
    setActiveFolderId(null)
    setActiveTag(null)
    startTransition(() => setView('search'))
    setSearchFocusSignal((currentValue) => currentValue + 1)
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
  }

  const openNote = (noteId: string) => {
    const note = notes.find((candidate) => candidate.id === noteId)

    if (!note) {
      return
    }

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
    const newNote: Note = {
      id: generateId('note'),
      title: 'Untitled Note',
      collectionId,
      folderId: currentFolder?.id ?? null,
      status: 'Draft',
      blocks: [createEmptyBlock('paragraph')],
      tags: ['drafts'],
      previewDate: 'Just now',
      updatedAt: new Date().toISOString(),
      isFavorite: false,
      isPinned: false,
      layout: 'standard',
    }

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

  const focusImportedNote = (note: Note, message: string) => {
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
    importFileInputRef.current?.click()
  }

  const exportLibraryAsJson = () => {
    downloadTextFile(
      `essence-export-${getExportDateStamp()}.json`,
      JSON.stringify(
        {
          activeNoteId,
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
      window.alert(message)
    } finally {
      event.currentTarget.value = ''
    }
  }

  const switchNoteViewMode = (nextMode: NoteViewMode) => {
    setNoteViewMode(nextMode)

    if (nextMode === 'read') {
      setZenMode(false)
    }
  }

  const navigate = (nextView: NavMode) => {
    setZenMode(false)
    setQuickSwitcherOpen(false)

    startTransition(() => {
      setView(nextView)
      if (nextView !== 'search') {
        setSearchQuery('')
      }
      if (nextView !== 'library') {
        setActiveCollectionId(null)
        setActiveFolderId(null)
        setActiveTag(null)
      }
    })
  }

  const openCollection = (collectionId: CollectionId) => {
    setZenMode(false)
    setQuickSwitcherOpen(false)
    focusCollectionFilter(collectionId)
  }

  const openFolder = (folderId: string) => {
    setZenMode(false)
    setQuickSwitcherOpen(false)
    focusFolderFilter(folderId)
  }

  const openTag = (tagName: string) => {
    setZenMode(false)
    setQuickSwitcherOpen(false)
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
        if (item.target.view === 'search') {
          openSearchView()
          return
        }

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
    const handleKeyboardShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isModifierPressed = event.metaKey || event.ctrlKey

      if (quickSwitcherOpen) {
        if (event.key === 'Escape' || (isModifierPressed && key === 'k')) {
          event.preventDefault()
          closeQuickSwitcher()
        }

        return
      }

      if (event.key === 'Escape') {
        if (noteHistoryOpen) {
          event.preventDefault()
          closeNoteHistory()
          return
        }

        setZenMode(false)
        return
      }

      if (!isModifierPressed) {
        return
      }

      if (key === 'k') {
        event.preventDefault()
        openQuickSwitcher()
        return
      }

      if (key === 'n') {
        event.preventDefault()
        createNote()
        return
      }

      if (key === 'f' && event.shiftKey) {
        event.preventDefault()
        openSearchView()
        return
      }

      if (key === 'e' && view === 'editor' && activeNote) {
        event.preventDefault()
        switchNoteViewMode(noteViewMode === 'edit' ? 'read' : 'edit')
        return
      }

      if (key === 'z') {
        event.preventDefault()

        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }

        return
      }

      if (key === 'y' && !event.shiftKey) {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcuts)
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts)
  }, [
    activeNote,
    closeNoteHistory,
    closeQuickSwitcher,
    createNote,
    noteHistoryOpen,
    noteViewMode,
    openQuickSwitcher,
    openSearchView,
    quickSwitcherOpen,
    redo,
    undo,
    view,
  ])

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

  const handleTitleChange = (value: string) => {
    if (!activeNote) {
      return
    }

    patchNote(activeNote.id, (note) => ({ ...note, title: value }))
  }

  const queueBlockFocus = (blockId: string, placement: BlockFocusRequest['placement']) => {
    setSelectedBlockId(blockId)
    setBlockFocusRequest({ blockId, placement })
  }

  const resolveSlashMenu = (blockId: string, blockType: BlockType, value: string) => {
    const query = getSlashQuery(blockType, value)

    if (query === null) {
      setSlashMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
      return
    }

    setSlashMenuState((currentState) =>
      currentState?.blockId === blockId && currentState.query === query
        ? currentState
        : {
            blockId,
            query,
            activeIndex: 0,
          },
    )
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

    const nextTag = availableTags.find((tag) => !activeNote.tags.includes(tag))

    if (!nextTag) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      tags: [...note.tags, nextTag],
    }))
  }

  const resolveLinkMenu = (
    blockId: string,
    blockType: BlockType,
    value: string,
    selectionStart: number | null,
  ) => {
    if (blockType === 'code') {
      setLinkMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
      return
    }

    const context = getActiveNoteLinkContext(value, selectionStart)

    if (!context) {
      setLinkMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
      return
    }

    setSlashMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
    setLinkMenuState((currentState) =>
      currentState?.blockId === blockId &&
      currentState.query === context.query &&
      currentState.replacementStart === context.replacementStart &&
      currentState.replacementEnd === context.replacementEnd
        ? currentState
        : {
            blockId,
            query: context.query,
            activeIndex: 0,
            replacementStart: context.replacementStart,
            replacementEnd: context.replacementEnd,
          },
    )
  }

  const handleBlockTextChange = (blockId: string, value: string, selectionStart: number | null) => {
    if (!activeNote) {
      return
    }

    const currentBlock = activeNote.blocks.find((block) => block.id === blockId)

    if (!currentBlock) {
      return
    }

    updateBlock(blockId, (block) => updateBlockValue(block, value))
    resolveSlashMenu(blockId, currentBlock.type, value)
    resolveLinkMenu(blockId, currentBlock.type, value, selectionStart)
  }

  const updateBlock = (blockId: string, updater: (block: NoteBlock) => NoteBlock) => {
    if (!activeNote) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: note.blocks.map((block) => (block.id === blockId ? updater(block) : block)),
    }))
  }

  const changeBlockType = (blockId: string, nextType: BlockType) => {
    if (!activeNote) {
      return
    }

    setSlashMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
    setLinkMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: note.blocks.map((block) =>
        block.id === blockId ? convertBlockType(block, nextType) : block,
      ),
    }))
  }

  const insertBlockAfter = (
    block: NoteBlock,
    afterBlockId?: string | null,
    focusPlacement: BlockFocusRequest['placement'] = 'start',
  ) => {
    if (!activeNote) {
      return
    }

    setSlashMenuState(null)
    setLinkMenuState(null)

    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: insertBlock(note.blocks, block, afterBlockId),
    }))

    queueBlockFocus(block.id, focusPlacement)
  }

  const addBlock = (type: BlockType, afterBlockId?: string | null) => {
    insertBlockAfter(createEmptyBlock(type), afterBlockId)
  }

  const removeBlock = (blockId: string, preferredFocus?: BlockFocusRequest | null) => {
    if (!activeNote) {
      return
    }

    const currentIndex = activeNote.blocks.findIndex((block) => block.id === blockId)
    const nextBlock = currentIndex >= 0 ? activeNote.blocks[currentIndex + 1] ?? null : null
    const previousBlock = currentIndex > 0 ? activeNote.blocks[currentIndex - 1] ?? null : null
    const remainingBlocks = removeBlockFromList(activeNote.blocks, blockId)

    setSlashMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
    setLinkMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: removeBlockFromList(note.blocks, blockId),
    }))

    if (preferredFocus) {
      queueBlockFocus(preferredFocus.blockId, preferredFocus.placement)
      return
    }

    if (nextBlock) {
      queueBlockFocus(nextBlock.id, 'start')
      return
    }

    if (previousBlock) {
      queueBlockFocus(previousBlock.id, 'end')
      return
    }

    setSelectedBlockId(remainingBlocks[0]?.id ?? null)
    setBlockFocusRequest(null)
  }

  const moveBlock = (blockId: string, direction: 'up' | 'down') => {
    if (!activeNote) {
      return
    }

    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: moveBlockInList(note.blocks, blockId, direction),
    }))

    setSlashMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
    setLinkMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))
    queueBlockFocus(blockId, 'end')
  }

  const applySlashCommand = (blockId: string, type: BlockType) => {
    if (!activeNote) {
      return
    }

    setSlashMenuState(null)
    setLinkMenuState((currentState) => (currentState?.blockId === blockId ? null : currentState))

    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: note.blocks.map((block) =>
        block.id === blockId ? createEmptyBlock(type, block.id) : block,
      ),
    }))

    queueBlockFocus(blockId, 'start')
  }

  const applyLinkSuggestion = (blockId: string, linkedNote: Note) => {
    if (!activeNote || linkMenuState?.blockId !== blockId) {
      return
    }

    const currentBlock = activeNote.blocks.find((block) => block.id === blockId)

    if (!currentBlock) {
      return
    }

    const currentValue = getBlockTextValue(currentBlock)
    const insertedValue = replaceActiveNoteLinkQuery(currentValue, linkedNote.title, linkMenuState)
    const nextCursorPosition = linkMenuState.replacementStart + `[[${linkedNote.title}]]`.length

    setLinkMenuState(null)
    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: note.blocks.map((block) =>
        block.id === blockId ? updateBlockValue(block, insertedValue) : block,
      ),
    }))

    queueBlockFocus(blockId, nextCursorPosition)
  }

  const handleBlockKeyDown = (block: NoteBlock, event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!activeNote) {
      return
    }

    const currentIndex = activeNote.blocks.findIndex((candidate) => candidate.id === block.id)

    if (currentIndex === -1) {
      return
    }

    const previousBlock = currentIndex > 0 ? activeNote.blocks[currentIndex - 1] : null
    const nextBlock = currentIndex < activeNote.blocks.length - 1 ? activeNote.blocks[currentIndex + 1] : null
    const currentSlashMenuState = slashMenuState?.blockId === block.id ? slashMenuState : null
    const matchingSlashItems = currentSlashMenuState ? getMatchingSlashMenuItems(currentSlashMenuState.query) : []
    const currentLinkMenuState = linkMenuState?.blockId === block.id ? linkMenuState : null
    const matchingLinkNotes = currentLinkMenuState
      ? getMatchingLinkNotes(currentLinkMenuState.query, notes, activeNote.id)
      : []
    const textarea = event.currentTarget
    const { selectionStart, selectionEnd, value } = textarea
    const hasCollapsedSelection = selectionStart === selectionEnd

    if (currentLinkMenuState) {
      if (event.key === 'ArrowDown' && matchingLinkNotes.length > 0) {
        event.preventDefault()
        setLinkMenuState((currentState) =>
          currentState && currentState.blockId === block.id
            ? {
                ...currentState,
                activeIndex: (currentState.activeIndex + 1) % matchingLinkNotes.length,
              }
            : currentState,
        )
        return
      }

      if (event.key === 'ArrowUp' && matchingLinkNotes.length > 0) {
        event.preventDefault()
        setLinkMenuState((currentState) =>
          currentState && currentState.blockId === block.id
            ? {
                ...currentState,
                activeIndex:
                  (currentState.activeIndex - 1 + matchingLinkNotes.length) % matchingLinkNotes.length,
              }
            : currentState,
        )
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && matchingLinkNotes.length > 0) {
        event.preventDefault()
        const nextNote = matchingLinkNotes[currentLinkMenuState.activeIndex % matchingLinkNotes.length]
        applyLinkSuggestion(block.id, nextNote)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setLinkMenuState(null)
        return
      }
    }

    if (currentSlashMenuState) {
      if (event.key === 'ArrowDown' && matchingSlashItems.length > 0) {
        event.preventDefault()
        setSlashMenuState((currentState) =>
          currentState && currentState.blockId === block.id
            ? {
                ...currentState,
                activeIndex: (currentState.activeIndex + 1) % matchingSlashItems.length,
              }
            : currentState,
        )
        return
      }

      if (event.key === 'ArrowUp' && matchingSlashItems.length > 0) {
        event.preventDefault()
        setSlashMenuState((currentState) =>
          currentState && currentState.blockId === block.id
            ? {
                ...currentState,
                activeIndex:
                  (currentState.activeIndex - 1 + matchingSlashItems.length) % matchingSlashItems.length,
              }
            : currentState,
        )
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault()

        if (matchingSlashItems.length > 0) {
          const nextItem = matchingSlashItems[currentSlashMenuState.activeIndex % matchingSlashItems.length]
          applySlashCommand(block.id, nextItem.type)
        }

        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashMenuState(null)
        return
      }
    }

    if (event.key === 'ArrowUp' && hasCollapsedSelection && selectionStart === 0 && previousBlock) {
      event.preventDefault()
      queueBlockFocus(previousBlock.id, 'end')
      return
    }

    if (event.key === 'ArrowDown' && hasCollapsedSelection && selectionStart === value.length && nextBlock) {
      event.preventDefault()
      queueBlockFocus(nextBlock.id, 'start')
      return
    }

    if (
      event.key === 'Backspace' &&
      hasCollapsedSelection &&
      selectionStart === 0 &&
      isBlockEmpty(block) &&
      activeNote.blocks.length > 1
    ) {
      event.preventDefault()
      removeBlock(
        block.id,
        previousBlock
          ? {
              blockId: previousBlock.id,
              placement: 'end',
            }
          : nextBlock
            ? {
                blockId: nextBlock.id,
                placement: 'start',
              }
            : null,
      )
      return
    }

    if (event.key !== 'Enter' || event.shiftKey || !hasCollapsedSelection) {
      return
    }

    if (block.type === 'code') {
      return
    }

    if (block.type === 'bullet-list') {
      const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
      const nextLineBreak = value.indexOf('\n', selectionStart)
      const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak
      const currentLine = value.slice(lineStart, lineEnd)

      if (selectionStart === value.length && currentLine.trim() === '') {
        event.preventDefault()

        const nextParagraph = createEmptyBlock('paragraph')
        const trimmedItems = trimTrailingEmptyItems(block.items ?? [])

        if (trimmedItems.length === 0) {
          patchNote(activeNote.id, (note) => ({
            ...note,
            blocks: note.blocks.map((candidate) =>
              candidate.id === block.id ? createEmptyBlock('paragraph', block.id) : candidate,
            ),
          }))
          queueBlockFocus(block.id, 'start')
          return
        }

        patchNote(activeNote.id, (note) => ({
          ...note,
          blocks: insertBlock(
            note.blocks.map((candidate) =>
              candidate.id === block.id
                ? {
                    id: block.id,
                    type: 'bullet-list',
                    items: trimmedItems,
                  }
                : candidate,
            ),
            nextParagraph,
            block.id,
          ),
        }))
        queueBlockFocus(nextParagraph.id, 'start')
      }

      return
    }

    event.preventDefault()

    const before = value.slice(0, selectionStart)
    const after = value.slice(selectionEnd)
    const nextParagraph = updateBlockValue(createEmptyBlock('paragraph'), after)

    patchNote(activeNote.id, (note) => ({
      ...note,
      blocks: insertBlock(
        note.blocks.map((candidate) =>
          candidate.id === block.id ? updateBlockValue(candidate, before) : candidate,
        ),
        nextParagraph,
        block.id,
      ),
    }))

    queueBlockFocus(nextParagraph.id, 'start')
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
  const showEditorToolbar = view === 'editor' && Boolean(activeNote) && noteViewMode === 'edit'

  return (
    <div className={`app-shell ${zenMode ? 'is-zen' : ''}`}>
      <input
        ref={importFileInputRef}
        type="file"
        accept=".json,.md,.markdown"
        hidden
        onChange={handleImportFileChange}
      />

      {!zenMode && (
        <aside className="rail">
          <div className="rail__brand" aria-label="Essence">
            <EssenceMonogram framed compact />
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
            <RailButton isActive={view === 'search'} label="Search" onClick={() => navigate('search')}>
              <Icon name="search" />
            </RailButton>
            <RailButton isActive={view === 'favorites'} label="Favorites" onClick={() => navigate('favorites')}>
              <Icon name="star" />
            </RailButton>
            <RailButton isActive={view === 'archive'} label="Archive" onClick={() => navigate('archive')}>
              <Icon name="archive" />
            </RailButton>
          </nav>

          <div className="rail__footer">
            <button type="button" className="rail__settings" aria-label="Settings" title="Settings">
              <Icon name="settings" />
            </button>
          </div>
        </aside>
      )}

      <div className="workspace">
        {!zenMode && (
          <header className={`topbar ${showEditorToolbar ? 'topbar--editor' : ''}`}>
            {view === 'editor' ? (
              <>
                <button type="button" className="text-action" onClick={() => navigate(editorContext)}>
                  <Icon name="arrowLeft" />
                  <span>{`Back to ${browseViewMeta[editorContext].heading}`}</span>
                </button>

                {showEditorToolbar ? (
                  <div className="editor-toolbar" role="toolbar" aria-label="Add block toolbar">
                    {blockToolbarButtons.map((button) => (
                      <button
                        key={button.type}
                        type="button"
                        className="toolbar-button toolbar-button--text"
                        aria-label={button.ariaLabel}
                        onMouseDown={preventButtonFocus}
                        onClick={() => addBlock(button.type, selectedBlockId)}
                      >
                        {button.label}
                      </button>
                    ))}
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
                          className="utility-button"
                          onClick={openQuickSwitcher}
                          title="Jump anywhere"
                        >
                          <Icon name="search" />
                          <span>Jump</span>
                        </button>
                        <button type="button" className="utility-button" onClick={exportActiveNoteAsMarkdown}>
                          <Icon name="download" />
                          <span>Markdown</span>
                        </button>
                        <button
                          type="button"
                          className={`utility-button ${noteHistoryOpen ? 'utility-button--active' : ''}`}
                          onClick={toggleNoteHistory}
                          title="Open note history"
                        >
                          <Icon name="history" />
                          <span>History</span>
                        </button>
                        <ModeToggle mode={noteViewMode} onChange={switchNoteViewMode} />
                        <button
                          type="button"
                          className={`icon-button ${activeNote.isPinned ? 'icon-button--active' : ''}`}
                          onClick={togglePinned}
                          aria-label="Toggle pinned note"
                          title={activeNote.isPinned ? 'Unpin note' : 'Pin note'}
                        >
                          <Icon name="pin" />
                        </button>
                        <button
                          type="button"
                          className={`icon-button ${activeNote.isFavorite ? 'icon-button--active' : ''}`}
                          onClick={toggleFavorite}
                          aria-label="Toggle favorite"
                        >
                          <Icon name="star" />
                        </button>
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
                  <div className="topbar__browseTitle">{browseViewMeta[view].heading}</div>
                </div>
                <div className="topbar__actions topbar__actions--browser">
                  <span className="topbar__context">{browseViewMeta[view].description}</span>
                  <div className="topbar__actionGroup topbar__actionGroup--browser">
                    <button type="button" className="utility-button" onClick={openQuickSwitcher}>
                      <Icon name="search" />
                      <span>Jump</span>
                    </button>
                    <button type="button" className="utility-button" onClick={openImportDialog}>
                      <Icon name="upload" />
                      <span>Import</span>
                    </button>
                    <button type="button" className="utility-button" onClick={exportLibraryAsJson}>
                      <Icon name="download" />
                      <span>Export JSON</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </header>
        )}

        <main className={`main ${view === 'editor' ? 'main--editor' : ''}`}>
          {(view === 'library' || view === 'search' || view === 'favorites' || view === 'archive') && (
            <LibraryScreen
              activeCollectionId={activeCollectionId}
              activeFilterLabel={activeFilterLabel}
              activeFolderId={activeFolderId}
              cards={filteredNotes}
              foldersById={foldersById}
              onClearFilters={clearFilters}
              onOpenCollection={openCollection}
              onOpenFolder={openFolder}
              onOpenNote={openNote}
              onSearchChange={setSearchQuery}
              focusSearchSignal={searchFocusSignal}
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
              onOpenCollection={openCollection}
              onOpenFolder={openFolder}
              onOpenTag={openTag}
              onRenameFolder={renameFolder}
              onToggleFolderExpanded={toggleFolderExpanded}
              onMoveFolder={moveFolder}
              tags={tagSummaries}
            />
          )}

          {view === 'editor' && (
            <section className="editor-workspace">
              {!zenMode && (
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

              <section className={`editor-screen ${noteHistoryOpen && activeNote ? 'editor-screen--history' : ''}`}>
                {activeNote ? (
                  <div className={`editor-layout ${noteHistoryOpen ? 'editor-layout--history' : ''}`}>
                    <div className="editor-column">
                      <Breadcrumbs
                        collectionId={activeNote.collectionId}
                        folderId={activeNote.folderId}
                        foldersById={foldersById}
                        onOpenCollection={(collectionId) => focusCollectionFilter(collectionId, true)}
                        onOpenFolder={(folderId) => focusFolderFilter(folderId, true)}
                      />

                      {noteViewMode === 'edit' ? (
                        <>
                          <div className="editor-utility">
                            <div className="editor-note-meta">
                              <span className="badge">{activeNote.status}</span>
                              <span>{activeNote.previewDate}</span>
                              {activeNote.isPinned && <span>Pinned</span>}
                              {activeNote.isFavorite && <span>Favorited</span>}
                            </div>

                            <div className="editor-meta">
                              <label className="meta-field">
                                <span>Collection</span>
                                <select value={activeNote.collectionId} onChange={handleCollectionChange}>
                                  {activeCollectionOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="meta-field">
                                <span>Folder</span>
                                <select value={activeNote.folderId ?? ''} onChange={handleFolderChange}>
                                  <option value="">No folder</option>
                                  {activeFolderOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <div className="editor-tags">
                              {activeNote.tags.map((tag) => (
                                <button key={tag} type="button" className="chip" onClick={() => openTag(tag)}>
                                  {tag}
                                </button>
                              ))}
                              <button type="button" className="tag-add" onClick={addTagToActiveNote} aria-label="Add tag">
                                <Icon name="plus" />
                              </button>
                            </div>
                          </div>

                          <input
                            className="editor-title"
                            value={activeNote.title}
                            onChange={(event) => handleTitleChange(event.target.value)}
                            aria-label="Note title"
                          />

                          <div className="editor-blocks">
                            {activeNote.blocks.map((block) => (
                              <BlockRow
                                key={block.id}
                                block={block}
                                canMoveDown={activeNote.blocks[activeNote.blocks.length - 1]?.id !== block.id}
                                canMoveUp={activeNote.blocks[0]?.id !== block.id}
                                focusRequest={blockFocusRequest?.blockId === block.id ? blockFocusRequest : null}
                                isActive={selectedBlockId === block.id}
                                onAddBelow={() => addBlock('paragraph', block.id)}
                                onFocusRequestHandled={() =>
                                  setBlockFocusRequest((currentRequest) =>
                                    currentRequest?.blockId === block.id ? null : currentRequest,
                                  )
                                }
                                onChangeCitation={(value) =>
                                  updateBlock(block.id, (currentBlock) => ({
                                    ...currentBlock,
                                    citation: value,
                                  }))
                                }
                                onChangeText={(value, selectionStart) =>
                                  handleBlockTextChange(block.id, value, selectionStart)
                                }
                                onChangeType={(nextType) => changeBlockType(block.id, nextType)}
                                onFocus={() => setSelectedBlockId(block.id)}
                                onKeyDown={(event) => handleBlockKeyDown(block, event)}
                                onLinkSelect={(note) => applyLinkSuggestion(block.id, note)}
                                onMoveDown={() => moveBlock(block.id, 'down')}
                                onMoveUp={() => moveBlock(block.id, 'up')}
                                onRemove={() => removeBlock(block.id)}
                                linkMenu={
                                  linkMenuState?.blockId === block.id
                                    ? {
                                        activeIndex: linkMenuState.activeIndex,
                                        notes: activeLinkSuggestions,
                                        query: linkMenuState.query,
                                      }
                                    : null
                                }
                                onSlashSelect={(type) => applySlashCommand(block.id, type)}
                                slashMenu={
                                  slashMenuState?.blockId === block.id
                                    ? {
                                        activeIndex: slashMenuState.activeIndex,
                                        items: activeSlashItems,
                                        query: slashMenuState.query,
                                      }
                                    : null
                                }
                              />
                            ))}
                          </div>

                          <NoteConnections
                            backlinks={activeBacklinks}
                            linkedNotes={activeLinkedNotes}
                            onOpenNote={openNote}
                          />

                          <footer className="editor-footer">
                            <span>{`${activeWordCount} words / ${activeNote.blocks.length} blocks`}</span>
                            <button type="button" className="text-link" onClick={() => setZenMode((current) => !current)}>
                              {zenMode ? 'Exit Zen' : 'Zen Mode'}
                            </button>
                            {zenMode && <span>Press Esc to return</span>}
                          </footer>
                        </>
                      ) : (
                        <ReadModeNote
                          backlinks={activeBacklinks}
                          linkedNotes={activeLinkedNotes}
                          note={activeNote}
                          notesByNormalizedTitle={notesByNormalizedTitle}
                          onOpenTag={openTag}
                          onOpenNote={openNote}
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
    </div>
  )
}

function LibraryScreen({
  activeCollectionId,
  activeFilterLabel,
  activeFolderId,
  cards,
  foldersById,
  onClearFilters,
  onOpenCollection,
  onOpenFolder,
  onOpenNote,
  onSearchChange,
  focusSearchSignal,
  searchQuery,
  viewMode,
}: {
  activeCollectionId: CollectionId | null
  activeFilterLabel: string | null
  activeFolderId: string | null
  cards: Note[]
  foldersById: Record<string, Folder>
  onClearFilters: () => void
  onOpenCollection: (collectionId: CollectionId) => void
  onOpenFolder: (folderId: string) => void
  onOpenNote: (noteId: string) => void
  onSearchChange: (value: string) => void
  focusSearchSignal: number
  searchQuery: string
  viewMode: NavMode
}) {
  const visibleNoteCountLabel = `${cards.length} ${cards.length === 1 ? 'note' : 'notes'} in view`
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const isHomeView = viewMode === 'library' && searchQuery.trim().length === 0 && !activeFilterLabel
  const homeSections = useMemo(() => buildLibraryHomeSections(cards), [cards])

  useEffect(() => {
    if (focusSearchSignal <= 0) {
      return
    }

    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [focusSearchSignal])

  return (
    <section className="library-screen">
      <div className="section-heading section-heading--compact">
        <div className="section-heading__copy section-heading__copy--compact">
          <span className="section-heading__meta">{visibleNoteCountLabel}</span>

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

        <div className="section-actions">
          <label className="search-field">
            <Icon name="search" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search notes, blocks, and tags"
            />
          </label>

          {activeFilterLabel && (
            <button type="button" className="ghost-button" onClick={onClearFilters}>
              <span>{activeFilterLabel}</span>
              <Icon name="close" />
            </button>
          )}
        </div>
      </div>

      <div className="section-divider" />

      {cards.length === 0 ? (
        <div className="empty-state">
          <h2>Nothing here yet</h2>
          <p>Adjust the filters, or start a fresh note from the rail.</p>
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

              <div className={`note-grid ${section.emphasize ? 'note-grid--hero' : ''}`}>
                {section.notes.map((note) => (
                  <NoteCard key={note.id} note={note} foldersById={foldersById} onOpenNote={onOpenNote} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="note-grid">
          {cards.map((note) => (
            <NoteCard key={note.id} note={note} foldersById={foldersById} onOpenNote={onOpenNote} />
          ))}
        </div>
      )}

      <footer className="library-footer">
        <nav>
          <button type="button">Privacy</button>
          <button type="button">Terms</button>
          <button type="button">Support</button>
        </nav>
        <p>Copyright 2026 Essence. A lucid space for thought.</p>
      </footer>
    </section>
  )
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
  const visibleTags = note.tags.slice(0, 2)
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
            {visibleTags.length > 0 && (
              <span className="note-card__meta">
                {visibleTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </span>
            )}
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
            {visibleTags.length > 0 && (
              <span className="note-card__meta">
                {visibleTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </span>
            )}
          </div>
        </>
      )}
    </button>
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
  onOpenCollection,
  onOpenFolder,
  onOpenTag,
  onRenameFolder,
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
  onOpenCollection: (collectionId: CollectionId) => void
  onOpenFolder: (folderId: string) => void
  onOpenTag: (tagName: string) => void
  onRenameFolder: (folderId: string, nextName: string) => void
  onToggleFolderExpanded: (folderId: string) => void
  onMoveFolder: (folderId: string, nextCollectionId: CollectionId, nextParentId: string | null) => void
  tags: Array<{ name: string; count: number }>
}) {
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
              onOpenCollection={onOpenCollection}
              onOpenFolder={onOpenFolder}
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

          <div className="tag-list">
            {tags.map((tag) => (
              <button key={tag.name} type="button" className="tag-row" onClick={() => onOpenTag(tag.name)}>
                <span className="tag-row__name">
                  <Icon name="hash" />
                  <span>{tag.name}</span>
                </span>
                <span className="tag-row__count">{tag.count}</span>
              </button>
            ))}
          </div>
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
  onOpenCollection,
  onOpenFolder,
  onToggleFolderExpanded,
}: {
  activeFolderId: string | null
  collection: CollectionSummary
  expandedFolderIds: string[]
  folders: Folder[]
  foldersById: Record<string, Folder>
  notes: Note[]
  onCreateFolder: (collectionId: CollectionId, parentId: string | null) => void
  onOpenCollection: (collectionId: CollectionId) => void
  onOpenFolder: (folderId: string) => void
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
            onOpenFolder={onOpenFolder}
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
  onOpenFolder,
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
  onOpenFolder: (folderId: string) => void
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
              onOpenFolder={onOpenFolder}
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
        <textarea
          ref={textareaRef}
          className={`block-input block-input--${block.type}`}
          value={blockValue}
          onChange={(event) => onChangeText(event.target.value, event.target.selectionStart)}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
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

function ReadModeNote({
  backlinks,
  linkedNotes,
  note,
  notesByNormalizedTitle,
  onOpenTag,
  onOpenNote,
  wordCount,
}: {
  backlinks: Note[]
  linkedNotes: Note[]
  note: Note
  notesByNormalizedTitle: Record<string, Note>
  onOpenTag: (tagName: string) => void
  onOpenNote: (noteId: string) => void
  wordCount: number
}) {
  return (
    <div className="reader-column">
      <div className="reader-utility">
        <div className="editor-note-meta">
          <span className="badge">{note.status}</span>
          <span>{note.previewDate}</span>
          {note.isPinned && <span>Pinned</span>}
          {note.isFavorite && <span>Favorited</span>}
        </div>

        {note.tags.length > 0 && (
          <div className="reader-tags">
            {note.tags.map((tag) => (
              <button key={tag} type="button" className="chip" onClick={() => onOpenTag(tag)}>
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <header className="reader-header">
        <h1 className="reader-title">{note.title}</h1>
      </header>

      <article className="reader-content">
        {note.blocks.map((block) => (
          <ReadBlock key={block.id} block={block} notesByNormalizedTitle={notesByNormalizedTitle} onOpenNote={onOpenNote} />
        ))}
      </article>

      <NoteConnections backlinks={backlinks} linkedNotes={linkedNotes} onOpenNote={onOpenNote} />

      <footer className="reader-footer">
        <span>{`${wordCount} words / ${note.blocks.length} blocks`}</span>
      </footer>
    </div>
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

  lines.forEach((line, lineIndex) => {
    let lastIndex = 0

    for (const match of line.matchAll(/\[\[([^[\]]+)\]\]/g)) {
      const matchedText = match[0]
      const linkedTitle = match[1]?.trim() ?? ''
      const startIndex = match.index ?? 0

      if (startIndex > lastIndex) {
        nodes.push(<span key={`text-${lineIndex}-${lastIndex}`}>{line.slice(lastIndex, startIndex)}</span>)
      }

      const linkedNote = notesByNormalizedTitle[normalizeNoteLinkTitle(linkedTitle)]

      if (linkedNote) {
        nodes.push(
          <button
            key={`link-${lineIndex}-${startIndex}`}
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
  isActive,
  label,
  onClick,
}: {
  children: ReactNode
  isActive: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`rail__button ${isActive ? 'rail__button--active' : ''}`}
      onClick={onClick}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      title={label}
    >
      <span className="rail__buttonGlyph" aria-hidden="true">
        {children}
      </span>
      <span className="rail__buttonLabel">{label}</span>
    </button>
  )
}

function EssenceMonogram({
  compact = false,
  framed = false,
}: {
  compact?: boolean
  framed?: boolean
}) {
  return (
    <span
      className={`essence-monogram ${compact ? 'essence-monogram--compact' : ''} ${framed ? 'essence-monogram--framed' : ''}`}
      aria-hidden="true"
    >
      <svg
        className="essence-monogram__svg"
        viewBox="0 0 64 64"
        role="presentation"
        focusable="false"
      >
        {framed ? <rect className="essence-monogram__frame" x="6" y="6" width="52" height="52" rx="16" /> : null}
        <text
          className="essence-monogram__letter"
          x="11.5"
          y="8"
          dominantBaseline="hanging"
          fontFamily="Newsreader, Georgia, serif"
          fontSize="37"
          fontWeight="500"
          letterSpacing="-2.2"
        >
          E
        </text>
        <text
          className="essence-monogram__letter"
          x="31"
          y="24.5"
          dominantBaseline="hanging"
          fontFamily="Newsreader, Georgia, serif"
          fontSize="35"
          fontWeight="500"
          letterSpacing="-2.1"
        >
          S
        </text>
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
    case 'more':
      return (
        <Glyph>
          <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
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

async function fetchRemoteAppState(): Promise<PersistedAppState | null> {
  const response = await fetch('/api/state')

  if (!response.ok) {
    throw new Error(`Failed to load remote state: ${response.status}`)
  }

  const payload = (await response.json()) as { state?: unknown | null }

  if (!payload.state) {
    return null
  }

  return normalizePersistedAppState(payload.state)
}

async function fetchRemoteNoteRevisions(noteId: string, limit = 20): Promise<NoteRevision[]> {
  const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/revisions?limit=${limit}`)

  if (!response.ok) {
    throw new Error(`Failed to load note history: ${response.status}`)
  }

  const payload = (await response.json()) as { revisions?: unknown[] }

  return Array.isArray(payload.revisions)
    ? payload.revisions
        .map((revision) => normalizeRemoteNoteRevision(revision))
        .filter((revision): revision is NoteRevision => revision !== null)
    : []
}

async function fetchRemoteSearchResults(query: string, limit = 24): Promise<SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`)

  if (!response.ok) {
    throw new Error(`Failed to search notes: ${response.status}`)
  }

  const payload = (await response.json()) as { results?: unknown[] }

  return Array.isArray(payload.results)
    ? payload.results
        .map((result) => normalizeRemoteSearchResult(result))
        .filter((result): result is SearchResult => result !== null)
    : []
}

async function persistRemoteAppState(state: PersistedAppState, revisionEvents: PendingRevisionEvent[] = []) {
  const response = await fetch('/api/state', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ revisionEvents, state }),
  })

  if (!response.ok) {
    throw new Error(`Failed to persist remote state: ${response.status}`)
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
    folders?: unknown[]
    notes?: unknown[]
  }
  const folders = Array.isArray(candidate.folders) ? candidate.folders.map(normalizeStoredFolder) : []
  const notes = Array.isArray(candidate.notes) ? candidate.notes.map(normalizeStoredNote) : []
  const activeNoteId =
    typeof candidate.activeNoteId === 'string' && notes.some((note) => note.id === candidate.activeNoteId)
      ? candidate.activeNoteId
      : notes[0]?.id ?? null

  return {
    activeNoteId,
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
  const candidate = (rawNote ?? {}) as Partial<Note> & { content?: string; blocks?: unknown[] }
  const collectionId = isCollectionId(candidate.collectionId) ? candidate.collectionId : 'ideas'
  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.map(normalizeStoredBlock)
    : createBlocksFromHtml(typeof candidate.content === 'string' ? candidate.content : '<p></p>')

  return {
    id: typeof candidate.id === 'string' ? candidate.id : generateId('note'),
    title: typeof candidate.title === 'string' ? candidate.title : 'Untitled Note',
    collectionId,
    folderId: typeof candidate.folderId === 'string' ? candidate.folderId : null,
    status: typeof candidate.status === 'string' ? candidate.status : 'Draft',
    blocks: blocks.length > 0 ? blocks : [createEmptyBlock('paragraph')],
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
  const continueWriting = sortNotesForDailyUse(continuablePool.length > 0 ? continuablePool : availableNotes).slice(0, 3)
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
  const haystack = `${note.title} ${getPlainTextFromBlocks(note.blocks)} ${note.tags.join(' ')} ${folderPath}`.toLowerCase()
  return haystack.includes(query)
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
  const normalizedStatus = note.status.trim().toLowerCase()
  const normalizedTitle = note.title.trim().toLowerCase()
  const isDraftLike = normalizedStatus === 'draft' || normalizedTitle.startsWith('untitled')

  return isDraftLike ? 'edit' : 'read'
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

    return {
      ...note,
      id: nextId,
      folderId: note.folderId ? folderIdMap.get(note.folderId) ?? null : null,
      tags: [...note.tags],
      blocks: note.blocks.map((block) => ({
        id: generateId('block'),
        type: block.type,
        text: typeof block.text === 'string' ? block.text : '',
        items: Array.isArray(block.items)
          ? [...block.items]
          : block.type === 'bullet-list'
            ? ['']
            : undefined,
        citation: typeof block.citation === 'string' ? block.citation : '',
      })),
    }
  })

  return {
    activeNoteId: state.activeNoteId ? noteIdMap.get(state.activeNoteId) ?? notes[0]?.id ?? null : notes[0]?.id ?? null,
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
          metadata.tags = parsedValue
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

function parseMarkdownFrontmatterValue(value: string): string | boolean | string[] {
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

function formatCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function generateId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function preventButtonFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
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

export default App
