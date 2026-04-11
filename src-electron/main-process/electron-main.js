import { app, BrowserWindow, nativeTheme, dialog, shell, protocol, Menu, ipcMain } from 'electron'
import Api from './api'
import windowStateKeeper from 'electron-window-state'
import unhandled from 'electron-unhandled'
import path from 'path'
import fs from 'fs'
import packageJSON from '../../package.json'
import configureMenu from './menu/templates'
import osLocale from 'os-locale'
import { openNewGitHubIssue, debugInfo, enforceMacOSAppLocation } from 'electron-util'
import KeyBindings from './keyboard/shortcut'
import { registerMemocastProtocol } from './utlis/resource-loader'
import ThemeManager from './utlis/theme-manager'
import Store from 'electron-store'
import i18n from './i18n'
import log from 'electron-log'

// sql.js 数据库
let db = null
let dbPath = null

/**
 * sql.js 查询辅助函数：将 exec 结果转为对象数组
 */
function execToObjects(sql, params = []) {
  try {
    if (params.length > 0) {
      const stmt = db.prepare(sql)
      stmt.bind(params)
      const results = []
      while (stmt.step()) {
        results.push(stmt.getAsObject())
      }
      stmt.free()
      return results
    } else {
      const result = db.exec(sql)
      if (result.length === 0) return []
      const { columns, values } = result[0]
      return values.map(row => {
        const obj = {}
        columns.forEach((col, i) => obj[col] = row[i])
        return obj
      })
    }
  } catch (error) {
    console.error('[DB] execToObjects error:', sql, error)
    return []
  }
}

/**
 * sql.js 单行查询
 */
function execOne(sql, params = []) {
  const results = execToObjects(sql, params)
  return results.length > 0 ? results[0] : null
}

/**
 * sql.js 执行语句
 */
function execRun(sql, params = []) {
  try {
    db.run(sql, params)
    saveDatabase()
    return { changes: db.getRowsModified(), lastInsertRowid: getLastInsertRowid() }
  } catch (error) {
    console.error('[DB] execRun error:', sql, error)
    return null
  }
}

/**
 * 获取最后插入的行ID
 */
function getLastInsertRowid() {
  const result = db.exec('SELECT last_insert_rowid() as id')
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0]
  }
  return null
}

/**
 * 保存数据库到文件
 */
function saveDatabase() {
  if (db && dbPath) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
  }
}

/**
 * 初始化本地 SQLite 数据库
 */
async function initDatabase() {
  console.log('[Main] initDatabase() called')
  try {
    // 动态导入 sql.js
    const initSqlJs = (await import('sql.js')).default
    console.log('[Main] sql.js loaded:', typeof initSqlJs)
    
    dbPath = path.join(app.getPath('userData'), 'memocast.db')
    console.log('[Main] Database path:', dbPath)
    log.info(`[Main] Initializing SQLite database at: ${dbPath}`)

    // 初始化 sql.js
    const SQL = await initSqlJs()
    
    // 尝试加载已有数据库
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath)
      db = new SQL.Database(fileBuffer)
      console.log('[Main] Loaded existing database')
    } else {
      db = new SQL.Database()
      console.log('[Main] Created new database')
    }

    // 创建表结构
    initSchema()
    console.log('[Main] Schema initialized')

    // 保存数据库到文件
    saveDatabase()
    
    log.info('[Main] Database initialized successfully')

    // 注册数据库 IPC 处理器
    registerDatabaseHandlers()
    console.log('[Main] Handlers registered')
  } catch (error) {
    console.error('[Main] Failed to initialize database:', error)
    log.error('[Main] Failed to initialize database:', error)
    throw error
  }
}

/**
 * 初始化数据库表结构
 */
function initSchema() {
  // Notes 表
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_guid TEXT UNIQUE,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT DEFAULT '',
      category TEXT DEFAULT '/',
      tags TEXT DEFAULT '',
      data_created INTEGER,
      data_modified INTEGER,
      sync_status TEXT DEFAULT 'local_only' CHECK(sync_status IN ('local_only', 'synced', 'pending_upload', 'pending_download', 'conflict')),
      local_modified INTEGER,
      server_modified INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )
  `)

  // 索引
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_doc_guid ON notes(doc_guid)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_sync_status ON notes(sync_status)`)

  // Tags 表
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1890ff',
      created_at INTEGER
    )
  `)

  // Note-Tag 关联表
  db.run(`
    CREATE TABLE IF NOT EXISTS note_tags (
      note_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (note_id, tag_id),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `)

  // 同步日志表
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER,
      action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
      direction TEXT NOT NULL CHECK(direction IN ('local_to_server', 'server_to_local')),
      timestamp INTEGER,
      synced INTEGER DEFAULT 0,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    )
  `)

  // GUID 映射表
  db.run(`
    CREATE TABLE IF NOT EXISTS guid_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id INTEGER NOT NULL,
      server_guid TEXT NOT NULL,
      service TEXT DEFAULT 'wiznote',
      created_at INTEGER,
      UNIQUE(local_id, server_guid),
      FOREIGN KEY (local_id) REFERENCES notes(id) ON DELETE CASCADE
    )
  `)

  // 冲突备份表
  db.run(`
    CREATE TABLE IF NOT EXISTS conflict_backup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL,
      local_content TEXT,
      server_content TEXT,
      local_modified INTEGER,
      server_modified INTEGER,
      created_at INTEGER,
      resolved INTEGER DEFAULT 0,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    )
  `)

  // 用户配置表
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER
    )
  `)

  log.info('[Main] Database schema initialized')
}

/**
 * 注册数据库 IPC 处理器
 */
function registerDatabaseHandlers() {
  // 获取所有笔记
  ipcMain.handle('db:getNotes', async (event, options = {}) => {
    try {
      let query = 'SELECT * FROM notes WHERE 1=1'
      const params = []

      if (options.category) {
        query += ' AND category = ?'
        params.push(options.category)
      }
      if (options.syncStatus) {
        query += ' AND sync_status = ?'
        params.push(options.syncStatus)
      }
      if (options.search) {
        query += ' AND (title LIKE ? OR content LIKE ?)'
        params.push(`%${options.search}%`, `%${options.search}%`)
      }

      query += ' ORDER BY data_modified DESC'

      if (options.limit) {
        query += ' LIMIT ?'
        params.push(options.limit)
      }
      if (options.offset) {
        query += ' OFFSET ?'
        params.push(options.offset)
      }

      return execToObjects(query, params)
    } catch (error) {
      log.error('[DB] getNotes error:', error)
      return []
    }
  })

  // 获取单个笔记
  ipcMain.handle('db:getNote', async (event, id) => {
    try {
      return execOne('SELECT * FROM notes WHERE id = ?', [id])
    } catch (error) {
      log.error('[DB] getNote error:', error)
      return null
    }
  })

  // 根据 doc_guid 获取单个笔记
  ipcMain.handle('db:getNoteByDocGuid', async (event, docGuid) => {
    try {
      return execOne('SELECT * FROM notes WHERE doc_guid = ?', [docGuid])
    } catch (error) {
      log.error('[DB] getNoteByDocGuid error:', error)
      return null
    }
  })

  // 创建笔记
  ipcMain.handle('db:createNote', async (event, note) => {
    try {
      const now = Date.now()
      db.run(`
        INSERT INTO notes (doc_guid, title, content, category, tags, data_created, data_modified, sync_status, local_modified, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        note.doc_guid || null,
        note.title || 'Untitled',
        note.content || '',
        note.category || '/',
        Array.isArray(note.tags) ? note.tags.join(',') : (note.tags || ''),
        note.data_created || now,
        note.data_modified || now,
        note.sync_status || 'local_only',
        note.local_modified || now,
        now,
        now
      ])
      saveDatabase()
      const lastId = getLastInsertRowid()
      return execOne('SELECT * FROM notes WHERE id = ?', [lastId])
    } catch (error) {
      log.error('[DB] createNote error:', error)
      return null
    }
  })

  // 更新笔记
  ipcMain.handle('db:updateNote', async (event, { id, updates }) => {
    try {
      const fields = []
      const values = []
      const now = Date.now()

      if (updates.title !== undefined) {
        fields.push('title = ?')
        values.push(updates.title)
      }
      if (updates.content !== undefined) {
        fields.push('content = ?')
        values.push(updates.content)
      }
      if (updates.category !== undefined) {
        fields.push('category = ?')
        values.push(updates.category)
      }
      if (updates.tags !== undefined) {
        fields.push('tags = ?')
        values.push(Array.isArray(updates.tags) ? updates.tags.join(',') : updates.tags)
      }
      if (updates.doc_guid !== undefined) {
        fields.push('doc_guid = ?')
        values.push(updates.doc_guid)
      }
      if (updates.sync_status !== undefined) {
        fields.push('sync_status = ?')
        values.push(updates.sync_status)
      }
      if (updates.server_modified !== undefined) {
        fields.push('server_modified = ?')
        values.push(updates.server_modified)
      }

      fields.push('data_modified = ?', 'local_modified = ?', 'updated_at = ?')
      values.push(now, now, now)
      values.push(id)

      const query = `UPDATE notes SET ${fields.join(', ')} WHERE id = ?`
      db.run(query, values)
      saveDatabase()

      // 记录同步日志
      if (updates.sync_status !== undefined) {
        db.run(`INSERT INTO sync_log (note_id, action, direction, timestamp, synced) VALUES (?, 'update', 'local_to_server', ?, 0)`, [id, now])
        saveDatabase()
      }

      return execOne('SELECT * FROM notes WHERE id = ?', [id])
    } catch (error) {
      log.error('[DB] updateNote error:', error)
      return null
    }
  })

  // 删除笔记
  ipcMain.handle('db:deleteNote', async (event, id) => {
    try {
      db.run(`INSERT INTO sync_log (note_id, action, direction, timestamp, synced) VALUES (?, 'delete', 'local_to_server', ?, 0)`, [id, Date.now()])
      db.run('DELETE FROM notes WHERE id = ?', [id])
      saveDatabase()
      return true
    } catch (error) {
      log.error('[DB] deleteNote error:', error)
      return false
    }
  })

  // 获取冲突笔记
  ipcMain.handle('db:getConflictNotes', async () => {
    try {
      return execToObjects("SELECT * FROM notes WHERE sync_status = 'conflict'")
    } catch (error) {
      log.error('[DB] getConflictNotes error:', error)
      return []
    }
  })

  // 获取同步状态统计
  ipcMain.handle('db:getStats', async () => {
    try {
      const total = execOne('SELECT COUNT(*) as count FROM notes')
      const synced = execOne("SELECT COUNT(*) as count FROM notes WHERE sync_status = 'synced'")
      const pending = execOne("SELECT COUNT(*) as count FROM notes WHERE sync_status IN ('pending_upload', 'local_only')")
      const conflict = execOne("SELECT COUNT(*) as count FROM notes WHERE sync_status = 'conflict'")
      return {
        total: total?.count || 0,
        synced: synced?.count || 0,
        pending: pending?.count || 0,
        conflict: conflict?.count || 0
      }
    } catch (error) {
      log.error('[DB] getStats error:', error)
      return { total: 0, synced: 0, pending: 0, conflict: 0 }
    }
  })

  // 获取所有标签
  ipcMain.handle('db:getTags', async () => {
    try {
      return execToObjects('SELECT * FROM tags ORDER BY name')
    } catch (error) {
      log.error('[DB] getTags error:', error)
      return []
    }
  })

  // 创建标签
  ipcMain.handle('db:createTag', async (event, tag) => {
    try {
      const now = Date.now()
      db.run(`INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)`, [tag.name, tag.color || '#1890ff', now])
      saveDatabase()
      const lastId = getLastInsertRowid()
      return { id: lastId, name: tag.name, color: tag.color || '#1890ff', created_at: now }
    } catch (error) {
      log.error('[DB] createTag error:', error)
      return null
    }
  })

  // 删除标签
  ipcMain.handle('db:deleteTag', async (event, id) => {
    try {
      db.run('DELETE FROM tags WHERE id = ?', [id])
      saveDatabase()
      return true
    } catch (error) {
      log.error('[DB] deleteTag error:', error)
      return false
    }
  })

  // 标记笔记为冲突状态
  ipcMain.handle('db:markAsConflict', async (event, { id, serverData = {} }) => {
    try {
      const note = execOne('SELECT * FROM notes WHERE id = ?', [id])
      if (!note) return false

      // 备份到冲突表
      db.run(`
        INSERT INTO conflict_backup (note_id, local_content, server_content, local_modified, server_modified)
        VALUES (?, ?, ?, ?, ?)
      `, [id, note.content, serverData.content || '', note.local_modified, serverData.data_modified || null])

      // 更新状态为冲突
      db.run(`UPDATE notes SET sync_status = 'conflict', updated_at = ? WHERE id = ?`, [Date.now(), id])
      saveDatabase()
      return true
    } catch (error) {
      log.error('[DB] markAsConflict error:', error)
      return false
    }
  })

  // 记录同步操作日志
  ipcMain.handle('db:logSyncAction', async (event, { noteId, action, direction }) => {
    try {
      db.run(`INSERT INTO sync_log (note_id, action, direction, timestamp, synced) VALUES (?, ?, ?, ?, 0)`,
        [noteId, action, direction, Date.now()])
      saveDatabase()
      return true
    } catch (error) {
      log.error('[DB] logSyncAction error:', error)
      return false
    }
  })

  // 获取待同步的笔记
  ipcMain.handle('db:getPendingSyncNotes', async () => {
    try {
      return execToObjects(`SELECT * FROM notes WHERE sync_status IN ('pending_upload', 'local_only') ORDER BY local_modified ASC`)
    } catch (error) {
      log.error('[DB] getPendingSyncNotes error:', error)
      return []
    }
  })

  // 获取 GUID 映射
  ipcMain.handle('db:getGuidMapping', async (event, serverGuid) => {
    try {
      return execOne('SELECT * FROM guid_mapping WHERE server_guid = ?', [serverGuid])
    } catch (error) {
      log.error('[DB] getGuidMapping error:', error)
      return null
    }
  })

  // 创建 GUID 映射
  ipcMain.handle('db:createGuidMapping', async (event, { localId, serverGuid, service = 'wiznote' }) => {
    try {
      db.run(`INSERT OR REPLACE INTO guid_mapping (local_id, server_guid, service, created_at) VALUES (?, ?, ?, ?)`,
        [localId, serverGuid, service, Date.now()])
      saveDatabase()
      return true
    } catch (error) {
      log.error('[DB] createGuidMapping error:', error)
      return false
    }
  })

  log.info('[Main] Database IPC handlers registered')
}

/**
 * 关闭数据库
 */
function closeDatabase() {
  if (db) {
    saveDatabase()
    db.close()
    db = null
    log.info('[Main] Database closed')
  }
}

console.log = log.log
console.error = log.error
log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs', new Date().getFullYear().toString(), (new Date().getMonth() + 1).toString(), 'main.log')

const ClientStorage = new Store({
  name: 'ClientFileStorage'
})
const { registerApiHandler } = Api

osLocale().then(locale => {
  const cur = ClientStorage.get('language')
  console.log(locale.toLocaleLowerCase(), cur)
  if (!cur) {
    ClientStorage.set('language', locale.toLocaleLowerCase() || 'en-us')
  }
})

unhandled({
  reportButton: error => {
    openNewGitHubIssue({
      user: 'TankNee',
      repo: 'Neeto-Vue',
      body: `\`\`\`\n${error.stack}\n\`\`\`\n\n---\n\n${debugInfo()}`
    })
  },
  showDialog: true
})

try {
  if (
    process.platform === 'win32' &&
    nativeTheme.shouldUseDarkColors === true
  ) {
    require('fs').unlinkSync(
      require('path').join(app.getPath('userData'), 'DevTools Extensions')
    )
  }
} catch (_) {
}

/**
 * Set `__statics` path to static files in production;
 * The reason we are setting it here is that the path needs to be evaluated at runtime
 */
if (process.env.PROD) {
  global.__statics = __dirname
}

let mainWindow, forceQuit
const isMac = process.platform === 'darwin'

function createWindow () {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 900,
    defaultHeight: 600
  })
  /**
   * Initial window options
   */
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width < 600 ? 600 : mainWindowState.width,
    height: mainWindowState.height < 400 ? 400 : mainWindowState.height,
    useContentSize: true,
    // transparent: true,
    vibrancy: ThemeManager.colorMode, // 'light', 'medium-light' etc
    webPreferences: {
      // Change from /quasar.conf.js > electron > nodeIntegration;
      // More info: https://quasar.dev/quasar-cli/developing-electron-apps/node-integration
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInWorker: process.env.QUASAR_NODE_INTEGRATION,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: false
      // Note: enableRemoteModule has been removed since Electron 28
      // @electron/remote now handles this automatically

      // More info: /quasar-cli/developing-electron-apps/electron-preload-script
      // preload: path.resolve(__dirname, 'electron-preload.js')
    },
    frame: false,
    titleBarStyle: 'hiddenInset'
  })

  protocol.interceptFileProtocol('file', (req, callback) => {
    const url = req.url.substr(8)
    callback(decodeURI(url))
  }, (error) => {
    if (error) {
      console.error('Failed to register protocol')
    }
  })

  registerMemocastProtocol()

  if (!process.env.PROD) {
    mainWindow.webContents.openDevTools()
  }
  const menu = Menu.buildFromTemplate(configureMenu(new KeyBindings(), mainWindow))
  Menu.setApplicationMenu(menu)

  mainWindow.isMainWindow = true
  mainWindowState.manage(mainWindow)

  mainWindow.loadURL(process.env.APP_URL).then()
  // mainWindow.on('closed', () => {
  //   mainWindow = null
  // })
  mainWindow.on('close', (event) => {
    if (!forceQuit) {
      event.preventDefault() // This will cancel the close
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on('new-window', (event, linkUrl) => {
    event.preventDefault()
    if (linkUrl.startsWith('http://localhost:') || linkUrl.startsWith('file://')) {
      // dialog.showErrorBox('Unsupported Url Protocol', `Memocast cannot resolve this protocol: ${linkUrl}, please copy it to browser manually!`)
      return
    }
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: i18n.t('openLinkHint'),
      message: i18n.t('openLinkHint'),
      detail: linkUrl,
      buttons: [i18n.t('confirm'), i18n.t('cancel')]
    }).then((res) => {
      if (!res.response) {
        shell.openExternal(linkUrl).then()
      }
    })
  })
  registerApiHandler()
  global.themeManager = ThemeManager
  if (isMac) {
    enforceMacOSAppLocation()
  }

  require('@electron/remote/main').initialize()
  require('@electron/remote/main').enable(mainWindow.webContents)

  // Reliable window control via IPC — avoids getFocusedWindow() returning null
  ipcMain.on('window-minimize', () => mainWindow.minimize())
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.on('window-close', () => mainWindow.close())
  ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized())

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false))
}

app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')

app.on('ready', async () => {
  // 初始化数据库
  await initDatabase()
  // 创建主窗口
  createWindow()
})

app.on('window-all-closed', () => {
  // 关闭数据库
  closeDatabase()
  if (!isMac) {
    app.quit()
  }
})

app.on('before-quit', () => {
  forceQuit = true
  closeDatabase()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  } else if (isMac) {
    mainWindow.show()
  }
})

app.setAboutPanelOptions({
  applicationName: 'coolma',
  copyright: 'luo0412',
  website: 'https://github.com/luo0412/coolma',
  iconPath: path.resolve('src-electron/icons', 'linux-512x512.png'),
  applicationVersion: packageJSON.version
})

if (!isMac) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })
}
