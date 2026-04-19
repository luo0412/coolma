/**
 * DatabaseService - 渲染进程数据库服务
 * 通过 IPC 调用主进程的 sql.js 数据库操作
 */

import { ipcRenderer } from 'electron'

class DatabaseService {
  /**
   * 创建新笔记
   */
  createNote(note = {}) {
    return ipcRenderer.invoke('db:createNote', note)
  }

  /**
   * 根据ID获取笔记
   */
  getNoteById(id) {
    return ipcRenderer.invoke('db:getNote', id)
  }

  /**
   * 根据 doc_guid 获取笔记
   */
  getNoteByDocGuid(docGuid) {
    return ipcRenderer.invoke('db:getNoteByDocGuid', docGuid)
  }

  /**
   * 获取所有笔记
   */
  getAllNotes(options = {}) {
    return ipcRenderer.invoke('db:getNotes', options)
  }

  /**
   * 更新笔记
   */
  updateNote(id, updates = {}) {
    return ipcRenderer.invoke('db:updateNote', { id, updates })
  }

  /**
   * 删除笔记
   */
  deleteNote(id) {
    return ipcRenderer.invoke('db:deleteNote', id)
  }

  /**
   * 标记笔记为冲突状态
   */
  markAsConflict(id, serverData = {}) {
    return ipcRenderer.invoke('db:markAsConflict', { id, serverData })
  }

  /**
   * 创建标签
   */
  createTag(tag = {}) {
    return ipcRenderer.invoke('db:createTag', tag)
  }

  /**
   * 获取所有标签
   */
  getAllTags() {
    return ipcRenderer.invoke('db:getTags')
  }

  /**
   * 删除标签
   */
  deleteTag(id) {
    return ipcRenderer.invoke('db:deleteTag', id)
  }

  /**
   * 记录同步操作日志
   */
  logSyncAction(noteId, action, direction) {
    return ipcRenderer.invoke('db:logSyncAction', { noteId, action, direction })
  }

  /**
   * 获取待同步的笔记
   */
  getPendingSyncNotes() {
    return ipcRenderer.invoke('db:getPendingSyncNotes')
  }

  /**
   * 获取冲突的笔记
   */
  getConflictNotes() {
    return ipcRenderer.invoke('db:getConflictNotes')
  }

  /**
   * 获取 GUID 映射
   */
  getGuidMapping(serverGuid) {
    return ipcRenderer.invoke('db:getGuidMapping', serverGuid)
  }

  /**
   * 创建 GUID 映射
   */
  createGuidMapping(localId, serverGuid, service = 'wiznote') {
    return ipcRenderer.invoke('db:createGuidMapping', { localId, serverGuid, service })
  }

  /**
   * 获取笔记统计数据
   */
  getStats() {
    return ipcRenderer.invoke('db:getStats')
  }

  /**
   * 获取所有符文
   */
  getRunes() {
    return ipcRenderer.invoke('db:getRunes')
  }

  /**
   * 保存符文（创建或更新）
   */
  saveRune(rune) {
    return ipcRenderer.invoke('db:saveRune', rune)
  }

  /**
   * 删除符文
   */
  deleteRune(id) {
    return ipcRenderer.invoke('db:deleteRune', id)
  }

  /**
   * 批量保存符文（用于排序）
   */
  saveRunes(runes) {
    return ipcRenderer.invoke('db:saveRunes', runes)
  }
}

export default new DatabaseService()
