/**
 * SyncService - 为知笔记同步服务
 * 负责本地数据库与为知笔记云端的双向同步
 */

import DatabaseService from './DatabaseService'
import WizNoteApi from '../utils/api'
import helper from '../utils/helper'

/**
 * 获取当前 kbGuid（从 localStorage 读取）
 */
function getKbGuid() {
  return localStorage.getItem('kbGuid')
}

// 适配层：将现有 API 转换为 SyncService 期望的接口
const api = {
  /**
   * 获取云端笔记列表
   */
  async getDocs(since = null, docGuid = null) {
    const kbGuid = getKbGuid()
    if (!kbGuid) {
      throw new Error('[SyncService] kbGuid is not available, please login first')
    }

    if (docGuid) {
      const info = await WizNoteApi.KnowledgeBaseApi.getNoteInfo({
        kbGuid,
        docGuid
      })
      // execRequest 已解包，info 直接是笔记对象
      if (info) {
        const content = await WizNoteApi.KnowledgeBaseApi.getNoteContent({
          kbGuid,
          docGuid
        })
        return [{ ...info, content: content || '' }]
      }
      return []
    }

    const docs = []
    let start = 0
    const count = 100

    for (;;) {
      const result = await WizNoteApi.KnowledgeBaseApi.getCategoryNotes({
        kbGuid,
        data: { category: '', start, count }
      })

      // execRequest 已解包，result 直接是数组
      const items = Array.isArray(result) ? result : (result?.result || [])

      if (items.length === 0) break

      for (const doc of items) {
        try {
          const content = await WizNoteApi.KnowledgeBaseApi.getNoteContent({
            kbGuid,
            docGuid: doc.guid || doc.docGuid
          })
          docs.push({ ...doc, content: content || '' })
        } catch (e) {
          docs.push({ ...doc, content: '' })
        }
      }

      if (items.length < count) break
      start += count
    }

    return docs
  },

  /**
   * 创建云端笔记
   * 将 markdown 内容用 embedMDNote 包装为为知笔记接受的 html 格式
   */
  async createDoc(note) {
    const kbGuid = getKbGuid()
    if (!kbGuid) {
      throw new Error('[SyncService] kbGuid is not available, please login first')
    }

    // 先创建笔记壳，获取 docGuid
    const result = await WizNoteApi.KnowledgeBaseApi.createNote({
      kbGuid,
      data: {
        title: note.title || 'Untitled',
        category: note.category || '/',
        tags: note.tags || []
      }
    })

    // execRequest 已解包，result 直接是创建结果
    if (result && result.guid) {
      const docGuid = result.guid
      // 将 markdown 包装成 html 后上传内容
      const html = helper.embedMDNote(note.content || '', [], {
        wrapWithPreTag: false,
        kbGuid,
        docGuid
      })
      await WizNoteApi.KnowledgeBaseApi.updateNote({
        kbGuid,
        docGuid,
        data: {
          html,
          title: note.title || 'Untitled',
          kbGuid,
          docGuid,
          resources: [],
          type: 'document'
        }
      })
      return { guid: docGuid }
    }

    throw new Error(result?.returnMessage || 'Failed to create note')
  },

  /**
   * 更新云端笔记
   * 将 markdown 内容用 embedMDNote 包装为为知笔记接受的 html 格式
   * 注意：不传 category，避免触发为知笔记的移动/删除文件夹逻辑
   */
  async updateDoc(docGuid, updates) {
    const kbGuid = getKbGuid()
    if (!kbGuid) {
      throw new Error('[SyncService] kbGuid is not available, please login first')
    }

    // 将 markdown 包装成 html
    const html = helper.embedMDNote(updates.content || '', [], {
      wrapWithPreTag: false,
      kbGuid,
      docGuid
    })

    const data = {
      html,
      title: updates.title,
      kbGuid,
      docGuid,
      resources: updates.resources || [],
      type: 'document'
    }

    // 只有明确传入 category 时才包含（注意：传 category 会触发移动操作）
    if (updates.category) {
      data.category = updates.category
    }

    const result = await WizNoteApi.KnowledgeBaseApi.updateNote({
      kbGuid,
      docGuid,
      data
    })

    return result
  },

  /**
   * 删除云端笔记
   */
  async deleteDoc(docGuid) {
    const kbGuid = getKbGuid()
    if (!kbGuid) {
      throw new Error('[SyncService] kbGuid is not available, please login first')
    }
    return await WizNoteApi.KnowledgeBaseApi.deleteNote({ kbGuid, docGuid })
  }
}

class SyncService {
  constructor() {
    this.isSyncing = false
    this.syncQueue = []
    this.listeners = []
  }

  addListener(callback) {
    this.listeners.push(callback)
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback)
  }

  notifyListeners(event) {
    this.listeners.forEach(callback => {
      try { callback(event) } catch (e) {
        console.error('[SyncService] Listener error:', e)
      }
    })
  }

  /**
   * 执行全量同步
   */
  async sync(options = {}) {
    if (this.isSyncing) {
      console.info('[SyncService] Sync already in progress, skipping')
      return { success: false, reason: 'already_syncing' }
    }

    this.isSyncing = true
    this.notifyListeners({ type: 'sync_start' })

    try {
      const stats = { pulled: 0, pushed: 0, conflicts: 0, errors: 0 }

      // Step 1: 拉取云端变更
      console.info('[SyncService] Starting pull from cloud...')
      const pullResult = await this.pullFromCloud()
      stats.pulled = pullResult.count
      stats.conflicts += pullResult.conflicts

      // Step 2: 上传本地变更
      console.info('[SyncService] Starting push to cloud...')
      const pushResult = await this.pushToCloud()
      stats.pushed = pushResult.count
      stats.errors += pushResult.errors

      // Step 3: 检测冲突
      console.info('[SyncService] Checking for conflicts...')
      const conflictNotes = await DatabaseService.getConflictNotes()
      if (conflictNotes.length > 0) {
        stats.conflicts += conflictNotes.length
        this.notifyListeners({ type: 'conflicts_found', count: conflictNotes.length })
      }

      console.info('[SyncService] Sync completed:', stats)
      this.notifyListeners({ type: 'sync_complete', stats })
      return { success: true, stats }
    } catch (error) {
      console.error('[SyncService] Sync failed:', error)
      this.notifyListeners({ type: 'sync_error', error: error.message })
      return { success: false, error: error.message }
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * 从云端拉取数据
   * 只拉取本地没有的笔记，已有笔记不覆盖（本地优先）
   */
  async pullFromCloud(since = null) {
    try {
      const kbGuid = getKbGuid()
      if (!kbGuid) {
        console.warn('[SyncService] pullFromCloud skipped: no kbGuid')
        return { count: 0, conflicts: 0 }
      }

      // 只获取笔记列表（不下载内容），确认哪些是本地没有的
      const docs = []
      let start = 0
      const count = 100

      for (;;) {
        const result = await WizNoteApi.KnowledgeBaseApi.getCategoryNotes({
          kbGuid,
          data: { category: '', start, count, withAbstract: false }
        })

        if (Array.isArray(result) && result.length > 0) {
          docs.push(...result)
          if (result.length < count) break
          start += count
        } else {
          break
        }
      }

      let pulledCount = 0
      let conflictsCount = 0

      for (const doc of docs) {
        const docGuid = doc.docGuid || doc.guid
        if (!docGuid) continue

        const existingNote = await DatabaseService.getNoteByDocGuid(docGuid)

        if (!existingNote) {
          // 本地没有这个笔记，从云端下载完整内容
          try {
            const content = await WizNoteApi.KnowledgeBaseApi.getNoteContent({
              kbGuid,
              docGuid
            })
            // 提取 markdown 再存储：content 是 { info, html, resources }，需要从 html 解析出 markdown
            const markdownContent = content && content.html
              ? helper.extractMarkdownFromMDNote(content.html, kbGuid, docGuid, content.resources || [])
              : ''
            await DatabaseService.createNote({
              doc_guid: docGuid,
              title: doc.title,
              content: markdownContent,
              category: doc.category || '/',
              tags: doc.tags || '',
              data_created: doc.dataCreated || doc.data_created,
              data_modified: doc.dataModified || doc.data_modified,
              sync_status: 'synced',
              server_modified: doc.dataModified || doc.data_modified
            })

            // 创建 GUID 映射
            const newNote = await DatabaseService.getNoteByDocGuid(docGuid)
            if (newNote) {
              await DatabaseService.createGuidMapping(newNote.id, docGuid, 'wiznote')
            }

            pulledCount++
          } catch (e) {
            console.warn('[SyncService] Failed to download note content:', docGuid, e)
          }
        }
        // 如果本地已有该笔记，不做任何处理（本地优先原则）
      }

      return { count: pulledCount, conflicts: conflictsCount }
    } catch (error) {
      console.error('[SyncService] Pull from cloud failed:', error)
      throw error
    }
  }

  /**
   * 上传本地变更到云端
   * 只更新内容，不改变笔记所在文件夹（避免触发为知笔记的移动/删除文件夹逻辑）
   */
  async pushToCloud() {
    const pendingNotes = await DatabaseService.getPendingSyncNotes()
    console.log('[SyncService] pushToCloud: found', pendingNotes?.length || 0, 'pending notes')
    let pushedCount = 0
    let errors = 0

    for (const note of pendingNotes) {
      try {
        if (!note.doc_guid) {
          // 纯本地新建的笔记（无 doc_guid）：尝试在云端创建
          console.log('[SyncService] Creating new note on cloud:', note.title)
          const result = await api.createDoc({
            title: note.title,
            content: note.content,
            category: note.category
          })
          if (result?.guid) {
            await DatabaseService.updateNote(note.id, {
              doc_guid: result.guid,
              sync_status: 'synced'
            })
            await DatabaseService.createGuidMapping(note.id, result.guid, 'wiznote')
            pushedCount++
            continue
          } else {
            // 创建失败，保持 local_only 状态
            console.warn('[SyncService] createDoc returned no guid:', result)
            errors++
            continue
          }
        }

        console.log('[SyncService] Updating note:', note.doc_guid, 'title:', note.title)
        await api.updateDoc(note.doc_guid, {
          title: note.title,
          content: note.content
          // 不传 category — 避免触发为知笔记的移动/删除文件夹逻辑
          // 如果需要移动笔记，应该通过专门的 moveNote 操作
        })
        await DatabaseService.updateNote(note.id, { sync_status: 'synced' })
        pushedCount++
      } catch (error) {
        console.error(`[SyncService] Push note ${note.id} (${note.doc_guid || 'local_only'}) failed:`, error)
        errors++
        // 推送失败时，回退 sync_status 为 pending_upload，下次同步时重试
        await DatabaseService.updateNote(note.id, { sync_status: 'pending_upload' })
      }
    }

    return { count: pushedCount, errors }
  }

  /**
   * 解决冲突
   */
  async resolveConflict(noteId, resolution, mergedContent = null) {
    const note = await DatabaseService.getNoteById(noteId)
    if (!note || note.sync_status !== 'conflict') {
      console.warn('[SyncService] Note not in conflict state:', noteId)
      return false
    }

    try {
      switch (resolution) {
        case 'local':
          if (note.doc_guid) {
            await api.updateDoc(note.doc_guid, {
              title: note.title,
              content: note.content,
              category: note.category
            })
          } else {
            const result = await api.createDoc({
              title: note.title,
              content: note.content,
              category: note.category
            })
            if (result.guid) {
              await DatabaseService.updateNote(noteId, { doc_guid: result.guid })
              await DatabaseService.createGuidMapping(noteId, result.guid, 'wiznote')
            }
          }
          await DatabaseService.updateNote(noteId, { sync_status: 'synced' })
          break

        case 'server': {
          const docs = await api.getDocs(null, note.doc_guid)
          if (docs.length > 0) {
            const serverDoc = docs[0]
            await DatabaseService.updateNote(noteId, {
              title: serverDoc.title,
              content: serverDoc.content,
              category: serverDoc.category,
              sync_status: 'synced',
              server_modified: serverDoc.data_modified
            })
          }
          break
        }

        case 'merge':
          if (mergedContent !== null) {
            await DatabaseService.updateNote(noteId, {
              content: mergedContent,
              sync_status: 'pending_upload'
            })
            await this.pushToCloud()
          }
          break

        default:
          console.error('[SyncService] Unknown resolution:', resolution)
          return false
      }

      console.info(`[SyncService] Conflict resolved for note ${noteId}: ${resolution}`)
      this.notifyListeners({ type: 'conflict_resolved', noteId, resolution })
      return true
    } catch (error) {
      console.error('[SyncService] Failed to resolve conflict:', error)
      throw error
    }
  }

  /**
   * 获取同步状态
   */
  async getStatus() {
    const stats = await DatabaseService.getStats()
    return {
      isSyncing: this.isSyncing,
      ...stats
    }
  }
}

export default new SyncService()
