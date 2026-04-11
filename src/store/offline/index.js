/**
 * Offline Store - 离线数据状态管理
 */

export default {
  namespaced: true,

  state: () => ({
    notes: [],
    currentNote: null,
    tags: [],
    categories: [],
    syncStatus: {
      isSyncing: false,
      lastSyncTime: null,
      total: 0,
      synced: 0,
      pending: 0,
      conflict: 0
    },
    conflictNotes: [],
    isInitialized: false
  }),

  getters: {
    // 获取所有笔记
    allNotes: state => state.notes,

    // 获取当前笔记
    currentNote: state => state.currentNote,

    // 获取笔记数量
    noteCount: state => state.notes.length,

    // 获取所有标签
    allTags: state => state.tags,

    // 获取所有分类
    allCategories: state => state.categories,

    // 获取同步状态
    syncStatus: state => state.syncStatus,

    // 获取冲突笔记
    conflictNotes: state => state.conflictNotes,

    // 是否已初始化
    isInitialized: state => state.isInitialized,

    // 按分类获取笔记
    notesByCategory: state => category => {
      if (!category || category === '/') {
        return state.notes
      }
      return state.notes.filter(note => note.category === category)
    },

    // 按标签获取笔记
    notesByTag: state => tagName => {
      return state.notes.filter(note => {
        const tags = note.tags ? note.tags.split(',') : []
        return tags.includes(tagName)
      })
    },

    // 搜索笔记
    searchNotes: state => query => {
      if (!query) return state.notes
      const lowerQuery = query.toLowerCase()
      return state.notes.filter(note =>
        note.title.toLowerCase().includes(lowerQuery) ||
        note.content.toLowerCase().includes(lowerQuery)
      )
    },

    // 获取待同步笔记数
    pendingCount: state => state.syncStatus.pending,

    // 获取冲突数量
    conflictCount: state => state.conflictNotes.length
  },

  mutations: {
    // 设置笔记列表
    SET_NOTES(state, notes) {
      state.notes = notes
    },

    // 添加笔记
    ADD_NOTE(state, note) {
      state.notes.unshift(note)
    },

    // 更新笔记
    UPDATE_NOTE(state, updatedNote) {
      const index = state.notes.findIndex(n => n.id === updatedNote.id)
      if (index !== -1) {
        state.notes.splice(index, 1, updatedNote)
      }
      if (state.currentNote && state.currentNote.id === updatedNote.id) {
        state.currentNote = updatedNote
      }
    },

    // 删除笔记
    DELETE_NOTE(state, noteId) {
      state.notes = state.notes.filter(n => n.id !== noteId)
      if (state.currentNote && state.currentNote.id === noteId) {
        state.currentNote = null
      }
    },

    // 设置当前笔记
    SET_CURRENT_NOTE(state, note) {
      state.currentNote = note
    },

    // 清空当前笔记
    CLEAR_CURRENT_NOTE(state) {
      state.currentNote = null
    },

    // 设置标签列表
    SET_TAGS(state, tags) {
      state.tags = tags
    },

    // 添加标签
    ADD_TAG(state, tag) {
      state.tags.push(tag)
    },

    // 删除标签
    REMOVE_TAG(state, tagId) {
      state.tags = state.tags.filter(t => t.id !== tagId)
    },

    // 设置分类列表
    SET_CATEGORIES(state, categories) {
      state.categories = categories
    },

    // 更新同步状态
    UPDATE_SYNC_STATUS(state, status) {
      state.syncStatus = { ...state.syncStatus, ...status }
    },

    // 设置冲突笔记
    SET_CONFLICT_NOTES(state, notes) {
      state.conflictNotes = notes
    },

    // 添加冲突笔记
    ADD_CONFLICT_NOTE(state, note) {
      if (!state.conflictNotes.find(n => n.id === note.id)) {
        state.conflictNotes.push(note)
      }
    },

    // 移除冲突笔记
    REMOVE_CONFLICT_NOTE(state, noteId) {
      state.conflictNotes = state.conflictNotes.filter(n => n.id !== noteId)
    },

    // 设置初始化状态
    SET_INITIALIZED(state, value) {
      state.isInitialized = value
    }
  },

  actions: {
    // 初始化离线数据
    async initOfflineStore({ commit }) {
      // 使用 DatabaseClient 通过 IPC 与主进程通信
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default

      try {
        const notes = await DatabaseClient.getNotes()
        const tags = await DatabaseClient.getTags()
        const conflictNotes = await DatabaseClient.getConflictNotes()
        const stats = await DatabaseClient.getStats()

        commit('SET_NOTES', notes)
        commit('SET_TAGS', tags)
        commit('SET_CONFLICT_NOTES', conflictNotes)
        commit('UPDATE_SYNC_STATUS', {
          total: stats.total,
          synced: stats.synced,
          pending: stats.pending,
          conflict: stats.conflict
        })
        commit('SET_INITIALIZED', true)

        return true
      } catch (error) {
        console.error('[offline] initOfflineStore error:', error)
        return false
      }
    },

    // init 的别名，保持向后兼容
    async init({ commit }) {
      return await this.initOfflineStore({ commit })
    },

    // 创建笔记
    async createNote({ commit }, noteData = {}) {
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default
      const note = await DatabaseClient.createNote(noteData)
      if (note) {
        commit('ADD_NOTE', note)
        const stats = await DatabaseClient.getStats()
        commit('UPDATE_SYNC_STATUS', { pending: stats.pending })
      }
      return note
    },

    // 更新笔记
    async updateNote({ commit }, { id, updates }) {
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default
      const note = await DatabaseClient.updateNote(id, updates)
      if (note) {
        commit('UPDATE_NOTE', note)
        const stats = await DatabaseClient.getStats()
        commit('UPDATE_SYNC_STATUS', { pending: stats.pending })
      }
      return note
    },

    // 删除笔记
    async deleteNote({ commit }, noteId) {
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default
      const success = await DatabaseClient.deleteNote(noteId)
      if (success) {
        commit('DELETE_NOTE', noteId)
        const stats = await DatabaseClient.getStats()
        commit('UPDATE_SYNC_STATUS', { pending: stats.pending })
      }
      return success
    },

    // 选择笔记
    selectNote({ commit }, note) {
      commit('SET_CURRENT_NOTE', note)
    },

    // 清空选择
    clearSelection({ commit }) {
      commit('CLEAR_CURRENT_NOTE')
    },

    // 创建标签
    async createTag({ commit }, tagData) {
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default
      const tag = await DatabaseClient.createTag(tagData)
      if (tag) {
        commit('ADD_TAG', tag)
      }
      return tag
    },

    // 删除标签
    async deleteTag({ commit }, tagId) {
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default
      const success = await DatabaseClient.deleteTag(tagId)
      if (success) {
        commit('REMOVE_TAG', tagId)
      }
      return success
    },

    // 执行同步
    async sync({ commit, state }) {
      if (state.syncStatus.isSyncing) {
        return { success: false, reason: 'already_syncing' }
      }

      commit('UPDATE_SYNC_STATUS', { isSyncing: true })

      try {
        const SyncService = (await import('../../services/SyncService')).default
        const result = await SyncService.sync()

        // 刷新统计数据
        const DatabaseClient = (await import('../../utils/DatabaseClient')).default
        const stats = await DatabaseClient.getStats()
        commit('UPDATE_SYNC_STATUS', {
          isSyncing: false,
          lastSyncTime: Date.now(),
          total: stats.total,
          synced: stats.synced,
          pending: stats.pending,
          conflict: stats.conflict
        })

        return result
      } catch (error) {
        console.error('[offline/sync] error:', error)
        commit('UPDATE_SYNC_STATUS', { isSyncing: false })
        return { success: false, error: error.message }
      }
    },

    // 解决冲突
    async resolveConflict({ commit }, { noteId, resolution, mergedContent }) {
      const SyncService = (await import('../../services/SyncService')).default
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default

      const success = await SyncService.resolveConflict(noteId, resolution, mergedContent)

      if (success) {
        commit('REMOVE_CONFLICT_NOTE', noteId)
        const note = await DatabaseClient.getNote(noteId)
        if (note) {
          commit('UPDATE_NOTE', note)
        }
        const stats = await DatabaseClient.getStats()
        commit('UPDATE_SYNC_STATUS', {
          conflict: stats.conflict,
          pending: stats.pending
        })
      }

      return success
    },

    // 刷新数据
    async refresh({ commit }) {
      const DatabaseClient = (await import('../../utils/DatabaseClient')).default
      const notes = await DatabaseClient.getNotes()
      const tags = await DatabaseClient.getTags()
      const conflictNotes = await DatabaseClient.getConflictNotes()
      const stats = await DatabaseClient.getStats()

      commit('SET_NOTES', notes)
      commit('SET_TAGS', tags)
      commit('SET_CONFLICT_NOTES', conflictNotes)
      commit('UPDATE_SYNC_STATUS', { ...stats })

      return true
    }
  }
}
