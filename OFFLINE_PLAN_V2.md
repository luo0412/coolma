# 离线优先同步方案 - 最终版

> 更新日期：2026-04-17

---

## 一、核心需求

1. **编辑后切换文件** → 实时写入本地 SQLite
2. **切换回来时** → 用 SQLite 的数据，不用云端请求
3. **在线同步失败** → 不影响离线功能

---

## 二、架构概览

### 2.1 数据流向

```
读（打开笔记）：
  SQLite ───────────────────────────────────────► 渲染到编辑器
      │ (有记录)
      │
      └── 有记录但 content 为空 → 云端恢复 ───────► 渲染 + 回填 SQLite
                                                      │
无 ────► 云端请求 ───────────────────────────────► 渲染 + 写入 SQLite

写（保存笔记）：
  编辑器内容 ──► SQLite (sync_status=pending_upload) ──► 异步推送云端 (sync_status=synced)

切换（离开笔记）：
  检测 noteState ──► SQLite ──► 加载新笔记

启动：
  initOfflineStore ──► sync() (fire-and-forget)
```

### 2.2 关键文件位置

```
src/
├── store/server/actions.js
│   ├── getNoteContent (~第400行)     读：SQLite 优先 + 云端恢复
│   └── updateNote (~第495行)          写：先本地后云端
├── components/ui/
│   ├── NoteItem.vue
│   │   ├── noteItemClickHandler       点击笔记时保存旧笔记
│   │   ├── saveToSQLite              直接写 SQLite
│   │   └── asyncSyncToCloud          后台推云端
│   └── editor/Muya.vue
│       ├── watch.currentNote           切换前自动保存 + 加载新笔记
│       └── saveHandler                Ctrl+S / 自动保存
├── store/offline/index.js            离线状态管理
├── services/SyncService.js           pullFromCloud / pushToCloud
└── App.vue                           启动时自动 sync
```

---

## 三、实现状态

### 阶段 1：核心数据流 ✅ 全部完成

| 功能 | 状态 | 代码位置 |
|------|------|----------|
| SQLite 优先读 | ✅ | `actions.js` getNoteContent |
| SQLite 空内容云端恢复 | ✅ | `actions.js` getNoteContent（第437-458行，新增）|
| 先本地后云端写 | ✅ | `actions.js` updateNote |
| 新建笔记流程 | ✅ | `actions.js` createNote |
| 删除笔记流程 | ✅ | `actions.js` deleteNote |
| 导入笔记流程 | ✅ | `actions.js` importNote |
| 笔记切换自动保存 | ✅ | `NoteItem.vue` + `Muya.vue` |
| 启动自动 sync | ✅ | `App.vue` mounted |
| pullFromCloud 不覆盖本地 | ✅ | `SyncService.js` |
| pushToCloud 不动文件夹 | ✅ | `SyncService.js` pushToCloud |

### 阶段 2：UI 层 🔧 待完成

| 功能 | 状态 |
|------|------|
| Header.vue 同步状态指示器 | 待做 |
| NoteList.vue 冲突角标 | 待做 |
| 冲突解决对话框接入 | 待做 |

### 阶段 3：配置与边界 🔧 待完成

| 功能 | 状态 |
|------|------|
| SettingsDialog 同步策略选项 | 待做 |
| 本地数据库重置功能 | 待做 |
| 网络断开 / token 失效处理 | 待做 |

---

## 四、核心逻辑详解

### 4.1 读：getNoteContent 决策树

```
输入：docGuid

1. 查 SQLite.getNoteByDocGuid(docGuid)
   │
   ├─ 找不到 → 请求云端 → 回填 SQLite → 返回云端结果
   │
   └─ 找到了 → 检查 content
               │
               ├─ content 有值 → 直接返回本地版本
               │
               └─ content 为空 → 检查 sync_status + local_modified
                                  │
                                  ├─ sync_status='synced' && !local_modified
                                  │   → 同步占位符，请求云端 → 回填 SQLite → 返回云端结果
                                  │
                                  └─ 其他情况（local_only/pending_upload/有本地修改）
                                      → 云端恢复：先请求云端
                                          │
                                          ├─ 云端有内容 → 回填 SQLite → 返回云端结果 ✅（新增）
                                          │
                                          └─ 云端也为空 → 返回本地空笔记（真正的空笔记）
```

### 4.2 写：updateNote 流程

```
Step 1（同步）：
  DatabaseClient.updateNote(id, {
    content: markdown,
    sync_status: 'pending_upload'
  })

Step 2（异步，不阻塞）：
  api.updateDoc(doc_guid, { title, content })  // markdown 转 html 上传
    .then(() => DatabaseClient.updateNote(id, { sync_status: 'synced' }))
    .catch(err → console.warn)
```

### 4.3 切换：双重保存机制

**NoteItem.vue noteItemClickHandler**（点击笔记列表）：
- 检测 `noteState !== 'default'` → 调用 `saveToSQLite()` → 调用 `asyncSyncToCloud()` → 加载新笔记

**Muya.vue watch.currentNote**（编辑器内切换）：
- 检测 `noteState === 'changed' || 'none'` → 调用 `updateNote()` → 加载新笔记

两者均保存到 SQLite，noteState 状态互为兜底。

---

## 五、已知修复的 Bug

1. `_pushToCloud` 重复查询 `getNoteByDocGuid` → 直接用 Step1 捕获的 `localNoteId`
2. `DatabaseClient.createGuidMapping` 方法缺失 → 已添加
3. `offline/deleteNote` 二次删除 SQLite → 改为只操作 Vuex 状态
4. `getNoteContent` SQLite content 为空时无法恢复云端 → 新增云端恢复逻辑（2026-04-17）

---

## 六、测试用例

| 场景 | 操作 | 预期结果 |
|------|------|----------|
| 正常编辑 | 编辑A → 切换B → 切回A | 显示本地修改 |
| 空内容恢复 | SQLite 有记录但 content 空 | 自动从云端恢复 |
| 真正空笔记 | 云端也是空 | 显示空白笔记 |
| 网络断开 | 离线编辑 → 保存 → 切换 | SQLite 正常记录 |
| 同步中切换 | sync 运行时切换笔记 | 不覆盖本地 |

---

## 七、待办

### 高优先级
- [ ] Header.vue 同步状态指示器（已同步 / 同步中 / 待同步数 / 冲突提醒）
- [ ] SettingsDialog 同步策略选项（本地优先 / 云端优先 / 手动）

### 中优先级
- [ ] NoteList.vue 冲突角标
- [ ] 网络断开时静默失败（不弹窗打断用户）
- [ ] token 失效时自动重新登录

### 低优先级
- [ ] 本地数据库重置功能
- [ ] content hash 校验（检测数据损坏）
- [ ] "强制从云端刷新" 按钮

---

## 八、与旧版方案的差异

OFFLINE_PLAN_V2（旧）vs 本版：

| 项目 | 旧版 | 本版 |
|------|------|------|
| SQLite content 为空 | 直接返回本地空笔记 | 新增云端恢复逻辑 |
| getNoteContent 逻辑 | `if (localNote && localNote.content)` | `if (localNote)` → 云端兜底恢复 |
| 文档结构 | 方案分析为主 | 实现状态为主 |
| 待办清单 | 分散在 TODO.md | 集中在本文档 |
