<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Chapter, Novel, Workspace } from './types'
import {
  askNovel,
  embedText,
  hasGeminiApiKey,
  generateChapterSummary,
  setGeminiApiKey,
} from './services/ai'
import {
  createChapter as insertChapter,
  createNovel as insertNovel,
  deleteChapter as removeChapter,
  deleteNovel as removeNovel,
  fetchChapters,
  fetchEmbeddedChapterIds,
  fetchNovels,
  saveChapterEmbedding,
  searchNovelMemory,
  toChapter,
  toNovel,
  updateChapter as persistChapter,
  updateChapterSummary as persistChapterSummary,
  updateNovel as persistNovel,
} from './services/database'
import {
  authError,
  authReady,
  initializeAuth,
  signIn,
  signOut,
  signUp,
  supabaseConfigError,
  updateDisplayName,
  user,
} from './services/supabase'

type Panel = 'overview' | 'write' | 'summary' | 'chat'

const workspace = reactive<Workspace>({ novels: [], chats: {} })
const currentView = ref<'library' | 'novel'>('library')
const activePanel = ref<Panel>('overview')
const activeNovelId = ref('')
const activeChapterId = ref('')
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const draftTitle = ref('')
const draftContent = ref('')
const notice = ref<{ message: string; tone: 'success' | 'error' } | null>(null)
const novelDialogOpen = ref(false)
const editingNovelId = ref<string | null>(null)
const novelForm = reactive({ title: '', description: '' })
const profileDialogOpen = ref(false)
const profileForm = reactive({ name: '', apiKey: '' })
const chatInput = ref('')
const chatPending = ref(false)
const summaryPending = ref(false)
const embeddingPending = ref(false)
const libraryLoading = ref(false)
const libraryError = ref('')
const authMode = ref<'login' | 'signup'>('login')
const authEmail = ref('')
const authPassword = ref('')
const authConfirmPassword = ref('')
const authPending = ref(false)
const authFormError = ref('')
const authMessage = ref('')

let noticeTimer = 0
let loadSequence = 0

function createId() {
  return crypto.randomUUID()
}

function notify(message: string, tone: 'success' | 'error' = 'success') {
  notice.value = { message, tone }
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    notice.value = null
  }, 4200)
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

async function loadLibrary(authorId: string) {
  const sequence = ++loadSequence
  libraryLoading.value = true
  libraryError.value = ''
  try {
    const records = await fetchNovels(authorId)
    if (sequence !== loadSequence || user.value?.id !== authorId) return
    const novelIds = records.map((record) => record.novel_id)
    const [chapters, embeddedChapterIds] = await Promise.all([
      fetchChapters(novelIds),
      fetchEmbeddedChapterIds(novelIds),
    ])
    if (sequence !== loadSequence || user.value?.id !== authorId) return
    const embeddedIds = new Set(embeddedChapterIds)
    workspace.novels = records.map((record) =>
      toNovel(
        record,
        chapters.filter((chapter) => chapter.novel_id === record.novel_id),
        embeddedIds,
      ),
    )
    workspace.chats = {}
    activeNovelId.value = workspace.novels[0]?.id ?? ''
    activeChapterId.value = workspace.novels[0]?.chapters[0]?.id ?? ''
    setDraft(workspace.novels[0]?.chapters[0] ?? null)
    currentView.value = 'library'
  } catch (error) {
    if (sequence === loadSequence) {
      libraryError.value = getErrorMessage(error, 'Could not load your library from Supabase.')
    }
  } finally {
    if (sequence === loadSequence) libraryLoading.value = false
  }
}

watch(
  () => (authReady.value ? user.value?.id ?? null : null),
  (authorId) => {
    if (authorId) {
      void loadLibrary(authorId)
      return
    }
    loadSequence += 1
    workspace.novels = []
    workspace.chats = {}
    activeNovelId.value = ''
    activeChapterId.value = ''
    currentView.value = 'library'
    libraryLoading.value = false
    libraryError.value = ''
  },
  { immediate: true },
)

function handleSearchShortcut(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchInput.value?.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleSearchShortcut)
  void initializeAuth()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSearchShortcut)
  window.clearTimeout(noticeTimer)
})

const activeNovel = computed(
  () => workspace.novels.find((novel) => novel.id === activeNovelId.value) ?? null,
)
const activeChapter = computed(
  () => activeNovel.value?.chapters.find((chapter) => chapter.id === activeChapterId.value) ?? null,
)
const isDraftDirty = computed(
  () =>
    Boolean(activeChapter.value) &&
    (draftTitle.value !== activeChapter.value?.title ||
      draftContent.value !== activeChapter.value?.content),
)
const activeChat = computed(() =>
  activeNovel.value ? (workspace.chats[activeNovel.value.id] ?? []) : [],
)
const totalChapters = computed(() =>
  workspace.novels.reduce((total, novel) => total + novel.chapters.length, 0),
)
const totalWords = computed(() =>
  workspace.novels.reduce(
    (total, novel) =>
      total +
      novel.chapters.reduce(
        (novelTotal, chapter) => novelTotal + wordCount(chapter.content),
        0,
      ),
    0,
  ),
)
const filteredNovels = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return workspace.novels
  return workspace.novels.filter(
    (novel) =>
      novel.title.toLowerCase().includes(query) ||
      novel.description.toLowerCase().includes(query),
  )
})
const indexedChapters = computed(
  () => activeNovel.value?.chapters.filter((chapter) => chapter.memoryIndexed).length ?? 0,
)
const profileName = computed(() => {
  const metadataName = user.value?.user_metadata['display_name']
  return typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user.value?.email ?? 'Writer'
})
const profileInitial = computed(() => profileName.value.charAt(0).toUpperCase())

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0
}

function setDraft(chapter: Chapter | null) {
  draftTitle.value = chapter?.title ?? ''
  draftContent.value = chapter?.content ?? ''
}

function applyChapter(record: Parameters<typeof toChapter>[0], memoryIndexed = false) {
  const chapter = toChapter(record, memoryIndexed)
  const novel = workspace.novels.find((item) => item.id === record.novel_id)
  if (!novel) throw new Error('The saved chapter no longer belongs to a loaded novel.')
  const index = novel.chapters.findIndex((item) => item.id === chapter.id)
  if (index === -1) novel.chapters.push(chapter)
  else novel.chapters[index] = chapter
  return chapter
}

async function saveDraft(showNotice = true) {
  const novel = activeNovel.value
  const chapter = activeChapter.value
  if (!novel || !chapter || !isDraftDirty.value) return true

  try {
    const contentChanged = draftContent.value !== chapter.content
    const updated = applyChapter(
      await persistChapter(
        novel.id,
        chapter.id,
        draftTitle.value.trim() || 'Untitled chapter',
        draftContent.value,
        contentChanged,
      ),
      contentChanged ? false : chapter.memoryIndexed,
    )
    setDraft(updated)
    if (showNotice) notify('Chapter saved to your NovelRina library.')
    return true
  } catch (error) {
    notify(getErrorMessage(error, 'Could not save this chapter.'), 'error')
    return false
  }
}

async function openNovel(novel: Novel) {
  if (!(await saveDraft(false))) return
  activeNovelId.value = novel.id
  activeChapterId.value = novel.chapters[0]?.id ?? ''
  setDraft(novel.chapters[0] ?? null)
  activePanel.value = 'overview'
  currentView.value = 'novel'
}

async function openLibrary() {
  if (!(await saveDraft(false))) return
  currentView.value = 'library'
}

async function selectChapter(chapter: Chapter) {
  if (!(await saveDraft(false))) return
  activeChapterId.value = chapter.id
  setDraft(chapter)
}

async function switchPanel(panel: Panel) {
  if (!(await saveDraft(false))) return
  activePanel.value = panel
}

function createNovel() {
  editingNovelId.value = null
  novelForm.title = ''
  novelForm.description = ''
  novelDialogOpen.value = true
}

function editNovel() {
  if (!activeNovel.value) return
  editingNovelId.value = activeNovel.value.id
  novelForm.title = activeNovel.value.title
  novelForm.description = activeNovel.value.description
  novelDialogOpen.value = true
}

async function submitNovel() {
  const title = novelForm.title.trim()
  const authorId = user.value?.id
  if (!title || !authorId) return

  try {
    if (editingNovelId.value) {
      const novel = workspace.novels.find((item) => item.id === editingNovelId.value)
      if (!novel) throw new Error('Novel not found in your library.')
      const saved = await persistNovel(
        authorId,
        novel.id,
        title,
        novelForm.description.trim(),
      )
      novel.title = saved.novel_name
      novel.description = saved.description ?? ''
      notify('Novel details updated.')
    } else {
      const saved = await insertNovel(authorId, title, novelForm.description.trim())
      workspace.novels.unshift(toNovel(saved))
      notify('A new story is ready for its first chapter.')
    }
    novelDialogOpen.value = false
  } catch (error) {
    notify(getErrorMessage(error, 'Could not save this novel.'), 'error')
  }
}

async function deleteNovel(novel: Novel) {
  if (!user.value || !window.confirm(`Delete “${novel.title}” and its chapters from your library?`)) {
    return
  }
  try {
    await removeNovel(user.value.id, novel.id)
    workspace.novels = workspace.novels.filter((item) => item.id !== novel.id)
    delete workspace.chats[novel.id]
    if (activeNovelId.value === novel.id) {
      currentView.value = 'library'
      activeNovelId.value = workspace.novels[0]?.id ?? ''
    }
    notify('Novel deleted from your library.')
  } catch (error) {
    notify(getErrorMessage(error, 'Could not delete this novel.'), 'error')
  }
}

async function addChapter() {
  const novel = activeNovel.value
  if (!novel || !(await saveDraft(false))) return
  try {
    const record = await insertChapter(
      novel.id,
      `Chapter ${novel.chapters.length + 1}`,
      '',
    )
    const chapter = applyChapter(record)
    activeChapterId.value = chapter.id
    setDraft(chapter)
    activePanel.value = 'write'
    notify('Chapter added to your manuscript.')
  } catch (error) {
    notify(getErrorMessage(error, 'Could not add this chapter.'), 'error')
  }
}

async function deleteChapter(chapter: Chapter) {
  const novel = activeNovel.value
  if (!novel || !window.confirm(`Delete “${chapter.title}” from this manuscript?`)) return
  try {
    await removeChapter(novel.id, chapter.id)
    novel.chapters = novel.chapters.filter((item) => item.id !== chapter.id)
    activeChapterId.value = novel.chapters[0]?.id ?? ''
    setDraft(novel.chapters[0] ?? null)
    activePanel.value = 'overview'
    notify('Chapter deleted from your manuscript.')
  } catch (error) {
    notify(getErrorMessage(error, 'Could not delete this chapter.'), 'error')
  }
}

async function generateSummary() {
  if (!(await saveDraft(false))) return
  const novel = activeNovel.value
  const chapter = activeChapter.value
  if (!novel || !chapter) return
  summaryPending.value = true
  try {
    const summary = await generateChapterSummary(chapter.content)
    applyChapter(await persistChapterSummary(novel.id, chapter.id, summary), false)
    notify('AI summary generated and saved to your library.')
  } catch (error) {
    notify(getErrorMessage(error, 'Could not summarize this chapter.'), 'error')
  } finally {
    summaryPending.value = false
  }
}

async function indexSummary() {
  const chapter = activeChapter.value
  const novel = activeNovel.value
  if (!chapter?.summary.trim()) {
    notify('Generate and save a chapter summary before embedding it.', 'error')
    return
  }
  if (!novel) return
  embeddingPending.value = true
  try {
    const embedding = await embedText(chapter.summary)
    await saveChapterEmbedding(novel.id, chapter.id, embedding)
    chapter.memoryIndexed = true
    notify('Chapter summary embedded for novel chat.')
  } catch (error) {
    notify(getErrorMessage(error, 'Could not embed this chapter summary.'), 'error')
  } finally {
    embeddingPending.value = false
  }
}

async function sendChatMessage() {
  const novel = activeNovel.value
  const query = chatInput.value.trim()
  if (!novel || !query || chatPending.value) return

  const messages = (workspace.chats[novel.id] ??= [])
  const history = messages.slice(-6)
  messages.push({ id: createId(), role: 'user', content: query })
  chatInput.value = ''
  chatPending.value = true
  try {
    if (!user.value) throw new Error('Sign in again to search your novel memory.')
    const queryEmbedding = await embedText(query)
    const relevantMemories = await searchNovelMemory(user.value.id, novel.id, queryEmbedding)
    const content = await askNovel(query, relevantMemories, history)
    messages.push({ id: createId(), role: 'assistant', content })
  } catch (error) {
    notify(getErrorMessage(error, 'Could not get an answer from the novel assistant.'), 'error')
  } finally {
    chatPending.value = false
  }
}

function openProfileDialog() {
  const metadataName = user.value?.user_metadata['display_name']
  profileForm.name = typeof metadataName === 'string' ? metadataName : ''
  profileForm.apiKey = ''
  profileDialogOpen.value = true
}

async function saveProfile() {
  const name = profileForm.name.trim()
  const apiKey = profileForm.apiKey.trim()
  if (!name && !apiKey) return
  try {
    if (name) await updateDisplayName(name)
    if (apiKey) setGeminiApiKey(apiKey)
    profileForm.apiKey = ''
    profileDialogOpen.value = false
    notify(
      apiKey
        ? 'AI key saved in memory for this session.'
        : 'Your author profile was updated.',
    )
  } catch (error) {
    notify(getErrorMessage(error, 'Could not update your profile.'), 'error')
  }
}

async function handleAuthSubmit() {
  authPending.value = true
  authFormError.value = ''
  authMessage.value = ''
  try {
    if (authMode.value === 'signup') {
      if (authPassword.value !== authConfirmPassword.value) {
        throw new Error('The passwords do not match.')
      }
      const hasSession = await signUp(authEmail.value.trim(), authPassword.value)
      authPassword.value = ''
      authConfirmPassword.value = ''
      if (!hasSession) {
        authMessage.value = 'Account created. Check your email to confirm your address, then sign in.'
      }
    } else {
      await signIn(authEmail.value.trim(), authPassword.value)
      authPassword.value = ''
    }
  } catch (error) {
    authFormError.value = getErrorMessage(error, 'Authentication failed.')
  } finally {
    authPending.value = false
  }
}

async function handleSignOut() {
  try {
    setGeminiApiKey('')
    await signOut()
    notify('You have signed out.')
  } catch (error) {
    notify(getErrorMessage(error, 'Could not sign out.'), 'error')
  }
}

function chapterDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(value),
  )
}
</script>

<template>
  <div class="app-frame">
    <section v-if="!authReady" class="auth-screen">
      <div class="auth-card auth-card--loading">Opening your writing room…</div>
    </section>

    <section v-else-if="!user" class="auth-screen">
      <div class="auth-card">
        <div class="auth-brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M5.5 7.5c4.3-.9 7.8-.2 10.5 2v16c-2.7-2.2-6.2-2.9-10.5-2v-16Z" />
              <path d="M26.5 7.5c-4.3-.9-7.8-.2-10.5 2v16c2.7-2.2 6.2-2.9 10.5-2v-16Z" />
              <path d="M10 12.5c1.4 0 2.6.2 3.8.7M22 12.5c-1.4 0-2.6.2-3.8.7" />
            </svg>
          </span>
          <span>novelrina<span>YOUR WRITING ROOM</span></span>
        </div>
        <p class="eyebrow"><span class="eyebrow-line"></span> A FRESH PAGE, EVERY DAY</p>
        <h1>{{ authMode === 'login' ? 'Welcome back.' : 'Make yourself at home.' }}</h1>
        <p class="auth-intro">Your stories, chapters, and AI writing tools—together in one quiet place.</p>

        <div class="auth-switcher" aria-label="Account options">
          <button :class="{ 'auth-switcher--active': authMode === 'login' }" type="button" @click="authMode = 'login'; authFormError = ''; authMessage = ''">Sign in</button>
          <button :class="{ 'auth-switcher--active': authMode === 'signup' }" type="button" @click="authMode = 'signup'; authFormError = ''; authMessage = ''">Create account</button>
        </div>

        <form class="auth-form" @submit.prevent="handleAuthSubmit">
          <label for="auth-email">Email</label>
          <input id="auth-email" v-model="authEmail" type="email" autocomplete="email" required placeholder="you@example.com" />
          <label for="auth-password">Password</label>
          <input id="auth-password" v-model="authPassword" type="password" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" minlength="6" required placeholder="At least 6 characters" />
          <template v-if="authMode === 'signup'">
            <label for="auth-confirm-password">Confirm password</label>
            <input id="auth-confirm-password" v-model="authConfirmPassword" type="password" autocomplete="new-password" minlength="6" required placeholder="Enter your password again" />
          </template>
          <p v-if="authFormError" class="auth-form-message auth-form-message--error" role="alert">{{ authFormError }}</p>
          <p v-if="authMessage" class="auth-form-message" role="status">{{ authMessage }}</p>
          <p v-if="authError && !supabaseConfigError" class="auth-form-message auth-form-message--error" role="alert">{{ authError }}</p>
          <p v-if="supabaseConfigError" class="auth-form-message auth-form-message--error" role="alert">{{ supabaseConfigError }}</p>
          <button class="button button--dark auth-submit-button" type="submit" :disabled="authPending || Boolean(supabaseConfigError)">
            {{ authPending ? 'One moment…' : authMode === 'login' ? 'Sign in to your library' : 'Create my account' }} <span>→</span>
          </button>
        </form>

        <p class="auth-privacy">Your account is powered by Supabase. Your writing stays in your private NovelRina library.</p>
      </div>
      <div class="auth-art" aria-hidden="true">
        <span class="auth-art-sun"></span>
        <span class="auth-art-word">a story is<br />a place to go</span>
        <span class="auth-art-book auth-art-book--one"></span>
        <span class="auth-art-book auth-art-book--two"></span>
        <span class="auth-art-book auth-art-book--three"></span>
      </div>
    </section>

    <template v-else>
    <aside class="sidebar">
      <button class="brand" type="button" aria-label="Go to your library" @click="openLibrary">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M5.5 7.5c4.3-.9 7.8-.2 10.5 2v16c-2.7-2.2-6.2-2.9-10.5-2v-16Z" />
            <path d="M26.5 7.5c-4.3-.9-7.8-.2-10.5 2v16c2.7-2.2 6.2-2.9 10.5-2v-16Z" />
            <path d="M10 12.5c1.4 0 2.6.2 3.8.7M22 12.5c-1.4 0-2.6.2-3.8.7" />
          </svg>
        </span>
        <span class="brand-copy">novelrina<span>YOUR WRITING ROOM</span></span>
      </button>

      <div class="side-label">WORKSPACE</div>
      <button
        class="side-link"
        :class="{ 'side-link--active': currentView === 'library' }"
        type="button"
        @click="openLibrary"
      >
        <span class="side-icon">⌂</span> My library
        <span class="side-count">{{ workspace.novels.length }}</span>
      </button>
      <button class="side-link" type="button" @click="createNovel">
        <span class="side-icon">＋</span> New novel
      </button>

      <div class="side-label side-label--stories">YOUR STORIES</div>
      <div class="side-story-list">
        <button
          v-for="novel in workspace.novels.slice(0, 5)"
          :key="novel.id"
          class="side-story"
          :class="{ 'side-story--active': currentView === 'novel' && activeNovelId === novel.id }"
          type="button"
          @click="openNovel(novel)"
        >
          <span class="story-dot"></span>
          <span>{{ novel.title }}</span>
        </button>
        <p v-if="workspace.novels.length === 0" class="side-empty">Your next story starts here.</p>
      </div>

      <div class="sidebar-spacer"></div>
      <div class="local-note">
        <span class="local-indicator"></span>
        <div><strong>Your private library</strong><small>Connected to Supabase</small></div>
      </div>
      <button class="profile-button" type="button" @click="openProfileDialog" :title="user.email ?? 'Account settings'">
        <span class="avatar">{{ profileInitial }}</span>
        <span class="profile-copy">
          <strong>{{ profileName }}</strong>
          <small>{{ user.email }}</small>
        </span>
        <span class="profile-edit">⋯</span>
      </button>
    </aside>

    <main class="main-area">
      <header class="topbar">
        <div class="topbar-context">
          <span class="live-dot"></span>
          <span>YOUR LITTLE CORNER OF THE INTERNET</span>
        </div>
        <div class="topbar-actions">
          <button class="privacy-label" type="button" @click="openProfileDialog" :title="hasGeminiApiKey ? 'Manage your session-only AI key' : 'Add your Google AI Studio key'">
            <span>✳</span> {{ hasGeminiApiKey ? 'AI ready for this session' : 'Add AI key' }}
          </button>
          <button class="top-profile" type="button" aria-label="Edit account profile" @click="openProfileDialog">
            {{ profileInitial }}
          </button>
          <button class="sign-out-button" type="button" @click="handleSignOut">Sign out</button>
        </div>
      </header>

      <div v-if="libraryError" class="storage-warning" role="alert">
        <span>{{ libraryError }}</span>
        <button type="button" @click="user && loadLibrary(user.id)">Retry</button>
      </div>

      <div v-if="libraryLoading" class="library-loading" role="status">Loading your library from Supabase…</div>

      <template v-if="!libraryLoading">
      <section v-if="currentView === 'library'" class="library-page">
        <div class="welcome-row">
          <div class="welcome-copy">
            <p class="eyebrow"><span class="eyebrow-line"></span> A FRESH PAGE, EVERY DAY</p>
            <h1>The next page<br />is <em>yours.</em></h1>
            <p class="welcome-description">
              A quiet place for all the worlds you haven’t written yet.
            </p>
            <button class="button button--dark" type="button" @click="createNovel">
              <span>＋</span> Start a new novel
            </button>
          </div>
          <div class="welcome-art" aria-label="Illustration of books and a growing plant">
            <div class="sun-disc"></div>
            <div class="art-caption">a story is<br />a place to go</div>
            <div class="plant-stem"></div>
            <div class="plant-leaf leaf-one"></div>
            <div class="plant-leaf leaf-two"></div>
            <div class="plant-leaf leaf-three"></div>
            <div class="book-stack">
              <div class="book book-back"><span>THE ART OF BEGINNING</span></div>
              <div class="book book-middle"><span>little worlds</span></div>
              <div class="book book-front"><span>notes for later</span></div>
            </div>
            <span class="art-star star-one">✳</span>
            <span class="art-star star-two">✳</span>
          </div>
        </div>

        <div class="stats-row" aria-label="Writing statistics">
          <div class="stat"><strong>{{ workspace.novels.length }}</strong><span>stories in progress</span></div>
          <span class="stat-divider"></span>
          <div class="stat"><strong>{{ totalChapters }}</strong><span>chapters so far</span></div>
          <span class="stat-divider"></span>
          <div class="stat"><strong>{{ totalWords.toLocaleString() }}</strong><span>words in your worlds</span></div>
          <p>Every word counts. Especially the first one.</p>
        </div>

        <section class="shelf-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">YOUR COLLECTION</p>
              <h2>The story shelf <span>{{ workspace.novels.length.toString().padStart(2, '0') }}</span></h2>
            </div>
            <label class="search-box">
              <span aria-hidden="true">⌕</span>
              <input ref="searchInput" v-model="searchQuery" type="search" placeholder="Find a story..." aria-label="Search stories" />
              <kbd>⌘ K</kbd>
            </label>
          </div>

          <div v-if="filteredNovels.length" class="novel-grid">
            <article
              v-for="(novel, index) in filteredNovels"
              :key="novel.id"
              class="novel-card"
              :class="`novel-card--${index % 4}`"
            >
              <button class="card-cover" type="button" @click="openNovel(novel)">
                <span class="cover-kicker">A NOVEL BY {{ profileName.toUpperCase() }}</span>
                <span class="cover-symbol" aria-hidden="true">{{ ['❋', '◌', '✳', '☼'][index % 4] }}</span>
                <span class="cover-title">{{ novel.title }}</span>
                <span class="cover-rule"></span>
                <span class="cover-subtitle">{{ novel.description || 'A new world, waiting.' }}</span>
                <span class="cover-edition">NOVELRINA · {{ new Date(novel.createdAt).getFullYear() }}</span>
                <span class="cover-open">OPEN STORY ↗</span>
              </button>
              <div class="card-meta">
                <div>
                  <strong>{{ novel.title }}</strong>
                  <span>{{ novel.chapters.length }} {{ novel.chapters.length === 1 ? 'chapter' : 'chapters' }} · {{ novel.chapters.reduce((n, chapter) => n + wordCount(chapter.content), 0).toLocaleString() }} words</span>
                </div>
                <button class="icon-button card-menu" type="button" :aria-label="`Open ${novel.title}`" @click="openNovel(novel)">↗</button>
              </div>
              <div class="card-actions">
                <button type="button" @click="openNovel(novel)">Continue writing <span>→</span></button>
                <button type="button" aria-label="Delete novel" @click="deleteNovel(novel)">Delete</button>
              </div>
            </article>

            <button class="new-card" type="button" @click="createNovel">
              <span class="new-card-mark">＋</span>
              <strong>There’s room<br />for one more.</strong>
              <span>Begin another story</span>
            </button>
          </div>
          <div v-else class="empty-shelf">
            <span class="empty-flower">✳</span>
            <h3>{{ searchQuery ? 'No stories found.' : 'It’s a lovely blank page.' }}</h3>
            <p>{{ searchQuery ? 'Try another title or clear your search.' : 'Your first novel is only a few words away.' }}</p>
            <button v-if="!searchQuery" class="text-button" type="button" @click="createNovel">Create your first novel →</button>
          </div>
        </section>

        <footer class="page-footer"><span>Made for the love of stories.</span><span class="cloud-note">Your library syncs with your account.</span></footer>
      </section>

      <section v-else-if="activeNovel" class="novel-page">
        <button class="back-link" type="button" @click="openLibrary">← <span>All stories</span></button>
        <div class="novel-heading">
          <div>
            <p class="eyebrow"><span class="eyebrow-line"></span> YOUR STORY, YOUR PACE</p>
            <h1>{{ activeNovel.title }}</h1>
            <p>{{ activeNovel.description || 'A new world, waiting to be written.' }}</p>
          </div>
          <div class="novel-actions">
            <button class="button button--quiet" type="button" @click="editNovel">Edit details</button>
            <button class="button button--dark" type="button" @click="addChapter">＋ New chapter</button>
          </div>
        </div>

        <div class="writing-layout">
          <aside class="chapter-rail">
            <div class="rail-heading">
              <div><span>YOUR MANUSCRIPT</span><strong>Chapters <i>{{ activeNovel.chapters.length.toString().padStart(2, '0') }}</i></strong></div>
              <button class="icon-button" type="button" aria-label="Add chapter" @click="addChapter">＋</button>
            </div>
            <div v-if="activeNovel.chapters.length" class="chapter-list">
              <button
                v-for="(chapter, index) in activeNovel.chapters"
                :key="chapter.id"
                class="chapter-item"
                :class="{ 'chapter-item--active': chapter.id === activeChapterId }"
                type="button"
                @click="selectChapter(chapter)"
              >
                <span class="chapter-number">{{ (index + 1).toString().padStart(2, '0') }}</span>
                <span class="chapter-info">
                  <strong>{{ chapter.title }}</strong>
                  <small>{{ wordCount(chapter.content).toLocaleString() }} words</small>
                </span>
                <span v-if="chapter.memoryIndexed" class="indexed-mark" title="Embedding saved for novel chat">✳</span>
              </button>
            </div>
            <div v-else class="rail-empty">
              <p>Your manuscript is waiting for its opening line.</p>
              <button class="text-button" type="button" @click="addChapter">Write chapter one →</button>
            </div>
            <div class="rail-bottom">
              <span class="rail-bottom-mark">✳</span>
              <p>Good stories take<br /><em>the time they take.</em></p>
            </div>
          </aside>

          <div class="work-area">
            <nav class="panel-tabs" aria-label="Novel tools">
              <button v-for="panel in (['overview', 'write', 'summary', 'chat'] as Panel[])" :key="panel" :class="{ 'panel-tab--active': activePanel === panel }" type="button" @click="switchPanel(panel)">
                {{ { overview: 'Overview', write: 'Write', summary: 'Summary', chat: 'Story chat' }[panel] }}
                <span v-if="panel === 'chat' && indexedChapters" class="tab-count">{{ indexedChapters }}</span>
              </button>
              <span v-if="activePanel === 'write' && isDraftDirty" class="unsaved-label">UNSAVED CHANGES</span>
            </nav>

            <section v-if="activePanel === 'overview'" class="overview-panel">
              <template v-if="activeChapter">
                <div class="chapter-overview-top">
                  <div>
                    <p class="eyebrow">CHAPTER {{ (activeNovel.chapters.findIndex((chapter) => chapter.id === activeChapterId) + 1).toString().padStart(2, '0') }}</p>
                    <h2>{{ activeChapter.title }}</h2>
                  </div>
                  <button class="text-button" type="button" @click="switchPanel('write')">Open editor ↗</button>
                </div>
                <div class="overview-stats">
                  <div><strong>{{ wordCount(activeChapter.content).toLocaleString() }}</strong><span>WORDS</span></div>
                  <div><strong>{{ activeChapter.content.trim() ? Math.max(1, Math.ceil(wordCount(activeChapter.content) / 220)) : 0 }}</strong><span>MIN READ</span></div>
                  <div><strong>{{ chapterDate(activeChapter.updatedAt) }}</strong><span>LAST TOUCHED</span></div>
                </div>
                <div class="manuscript-preview">
                  <p v-if="activeChapter.content">{{ activeChapter.content }}</p>
                  <p v-else class="muted-copy">This page is ready when you are. Add the first line in the editor.</p>
                </div>
                <div class="overview-bottom">
                  <div><span class="recall-light" :class="{ 'recall-light--on': activeChapter.memoryIndexed }"></span><span>{{ activeChapter.memoryIndexed ? 'In story recall' : 'Not in story recall yet' }}</span></div>
                  <button v-if="activeChapter.content" class="text-button" type="button" @click="activePanel = 'summary'">Open chapter summary →</button>
                </div>
              </template>
              <div v-else class="empty-chapter">
                <span>✳</span><h2>A story starts with a page.</h2><p>Add a chapter and make it yours.</p>
                <button class="button button--dark" type="button" @click="addChapter">＋ Add a chapter</button>
              </div>
            </section>

            <section v-else-if="activePanel === 'write'" class="editor-panel">
              <div class="editor-toolbar">
                <div><span class="editor-status-dot"></span>{{ isDraftDirty ? 'Unsaved changes' : 'Saved to your library' }}</div>
                <div class="editor-actions">
                  <button v-if="activeChapter" class="text-button danger-link" type="button" @click="deleteChapter(activeChapter)">Delete chapter</button>
                  <button class="button button--dark button--small" type="button" :disabled="!activeChapter || !isDraftDirty" @click="saveDraft()">Save chapter</button>
                </div>
              </div>
              <template v-if="activeChapter">
                <input v-model="draftTitle" class="chapter-title-input" aria-label="Chapter title" placeholder="Chapter title" />
                <div class="editor-meta">{{ wordCount(draftContent).toLocaleString() }} words <span>·</span> {{ draftContent.length.toLocaleString() }} characters</div>
                <textarea v-model="draftContent" class="writing-canvas" aria-label="Chapter content" placeholder="The first sentence is always the bravest one…"></textarea>
                <div class="editor-footer"><span>Take your time. This is your world.</span><span>SAVE TO SUPABASE WHEN YOU’RE READY</span></div>
              </template>
              <div v-else class="empty-chapter"><span>✳</span><h2>A story starts with a page.</h2><p>Add a chapter and make it yours.</p><button class="button button--dark" type="button" @click="addChapter">＋ Add a chapter</button></div>
            </section>

            <section v-else-if="activePanel === 'summary'" class="summary-panel">
              <div v-if="activeChapter">
                <div class="tool-heading">
                  <div><p class="eyebrow">A LITTLE HELP REMEMBERING</p><h2>Chapter summary</h2><p>Pull the important details into one quiet corner.</p></div>
                  <button class="button button--dark" type="button" :disabled="summaryPending || !activeChapter.content.trim()" @click="generateSummary">
                    {{ summaryPending ? 'Finding the story…' : activeChapter.summary ? '↻ Make a new summary' : '✳ Create summary' }}
                  </button>
                </div>
                <article class="summary-card">
                  <div class="summary-card-kicker"><span class="recall-light" :class="{ 'recall-light--on': activeChapter.memoryIndexed }"></span>{{ activeChapter.memoryIndexed ? 'EMBEDDED FOR NOVEL CHAT' : 'YOUR PRIVATE NOTES' }}</div>
                  <h3>{{ activeChapter.title }}</h3>
                  <p v-if="activeChapter.summary">{{ activeChapter.summary }}</p>
                  <p v-else class="muted-copy">Your AI-generated summary will live here, saved alongside your chapter.</p>
                  <div v-if="activeChapter.summary" class="summary-actions">
                    <span>{{ activeChapter.memoryIndexed ? 'EMBEDDED FOR NOVEL CHAT' : 'SUMMARY SAVED TO YOUR LIBRARY' }}</span>
                    <button class="button button--quiet" type="button" :disabled="activeChapter.memoryIndexed || embeddingPending" @click="indexSummary">{{ embeddingPending ? 'Embedding…' : activeChapter.memoryIndexed ? '✓ Embedded for chat' : 'Create chat embedding →' }}</button>
                  </div>
                </article>
                <div class="info-note"><span>✳</span><p>Summaries and embeddings are generated directly with Google AI using your key. Your key stays in this tab’s memory; chapter text and questions are sent to Google, while summaries and embeddings are saved to your Supabase library.</p></div>
              </div>
              <div v-else class="empty-chapter"><span>✳</span><h2>Nothing to summarize just yet.</h2><p>Add a chapter, then come back for a quick recap.</p><button class="button button--dark" type="button" @click="addChapter">＋ Add a chapter</button></div>
            </section>

            <section v-else class="chat-panel">
              <div class="chat-heading">
                <div><p class="eyebrow">A COMPANION FOR YOUR STORY</p><h2>Ask your manuscript</h2><p>Little details, found again.</p></div>
                <span class="chat-mode"><span class="recall-light" :class="{ 'recall-light--on': indexedChapters > 0 }"></span>{{ indexedChapters }} EMBEDDED CHAPTER{{ indexedChapters === 1 ? '' : 'S' }}</span>
              </div>
              <div class="chat-messages" aria-live="polite">
                <div v-if="!activeChat.length" class="chat-welcome">
                  <span class="chat-spark">✳</span>
                  <strong>A second pair of eyes,</strong>
                  <strong><em>right where you left off.</em></strong>
                  <p>Ask about characters, places, or details in chapters with saved embeddings.</p>
                  <button v-if="indexedChapters === 0" class="text-button" type="button" @click="switchPanel('summary')">Create a chapter embedding →</button>
                  <button v-else class="suggestion" type="button" @click="chatInput = 'What details should I remember?'">“What details should I remember?”</button>
                </div>
                <article v-for="message in activeChat" :key="message.id" class="chat-message" :class="`chat-message--${message.role}`">
                  <span class="message-avatar">{{ message.role === 'user' ? profileInitial : '✳' }}</span>
                  <div><span class="message-label">{{ message.role === 'user' ? 'YOU' : 'STORY RECALL' }}</span><p>{{ message.content }}</p><small v-if="message.sources?.length">Found in {{ message.sources.join(', ') }}</small></div>
                </article>
                <div v-if="chatPending" class="chat-thinking"><span class="thinking-dots">···</span>Looking through the indexed chapters…</div>
              </div>
              <form class="chat-composer" @submit.prevent="sendChatMessage">
                <input v-model="chatInput" type="text" aria-label="Ask about your story" placeholder="Ask a question about this novel…" :disabled="chatPending" />
                <button type="submit" :disabled="chatPending || !chatInput.trim()" aria-label="Send message">↑</button>
              </form>
              <p class="chat-disclaimer">AI NOVEL CHAT · GROUNDED IN YOUR SAVED CHAPTER EMBEDDINGS</p>
            </section>
          </div>
        </div>
      </section>
      <section v-else class="empty-shelf empty-library">
        <span class="empty-flower">✳</span><h3>No stories on the shelf yet.</h3><p>Start a new novel and give your ideas somewhere to live.</p><button class="button button--dark" type="button" @click="createNovel">＋ Start a new novel</button>
      </section>
      </template>
    </main>

    <div v-if="novelDialogOpen" class="modal-backdrop" @click.self="novelDialogOpen = false">
      <form class="modal-card" @submit.prevent="submitNovel">
        <button class="modal-close" type="button" aria-label="Close dialog" @click="novelDialogOpen = false">×</button>
        <p class="eyebrow">{{ editingNovelId ? 'A FEW LITTLE CHANGES' : 'SOMETHING NEW IS GROWING' }}</p>
        <h2>{{ editingNovelId ? 'Edit your story.' : 'Name your world.' }}</h2>
        <label for="novel-title">Novel title</label>
        <input id="novel-title" v-model="novelForm.title" maxlength="100" required autofocus placeholder="The story you can’t stop thinking about" />
        <label for="novel-description">A little about it <span>OPTIONAL</span></label>
        <textarea id="novel-description" v-model="novelForm.description" maxlength="220" rows="3" placeholder="A mystery, a love story, a place to get lost…"></textarea>
        <button class="button button--dark modal-submit" type="submit">{{ editingNovelId ? 'Save changes' : 'Create my novel' }} <span>→</span></button>
      </form>
    </div>

    <div v-if="profileDialogOpen" class="modal-backdrop" @click.self="profileDialogOpen = false">
      <form class="modal-card profile-modal" @submit.prevent="saveProfile">
        <button class="modal-close" type="button" aria-label="Close dialog" @click="profileDialogOpen = false">×</button>
        <p class="eyebrow">YOUR SUPABASE ACCOUNT</p>
        <h2>Make yourself at home.</h2>
        <p class="modal-intro">{{ user.email }} · Your name is stored in your account metadata.</p>
        <label for="author-name">Your name</label>
        <input id="author-name" v-model="profileForm.name" maxlength="80" placeholder="What should we call you?" />
        <label for="gemini-key">Google AI Studio API key <span>SESSION ONLY</span></label>
        <input id="gemini-key" v-model="profileForm.apiKey" type="password" autocomplete="off" placeholder="Paste your personal Gemini API key" />
        <p class="modal-intro">The key is never saved to Supabase, local storage, or the app build. It is sent directly to Google and cleared on refresh or sign-out. Use a restricted key with your own quota.</p>
        <button class="button button--dark modal-submit" type="submit">Save profile{{ profileForm.apiKey ? ' & AI key' : '' }} <span>→</span></button>
        <button v-if="hasGeminiApiKey" class="clear-profile" type="button" @click="setGeminiApiKey(''); notify('AI key cleared from this session.')">Clear session AI key</button>
        <button class="clear-profile" type="button" @click="profileDialogOpen = false; handleSignOut()">Sign out of NovelRina</button>
      </form>
    </div>

    <Transition name="toast">
      <div v-if="notice" class="toast-message" :class="`toast-message--${notice.tone}`" role="status">{{ notice.message }}</div>
    </Transition>
    </template>
  </div>
</template>
