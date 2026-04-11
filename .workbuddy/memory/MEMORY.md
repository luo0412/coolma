# Memocast 项目记忆

## 项目概述
- Memocast 是基于 Muya 编辑器的 Markdown 笔记应用
- 工作目录：`e:/work-github/demo/Memocast`
- 核心编辑器：`src/libs/muya/`
- **包管理器**：使用 yarn（不是 npm）

## 用户偏好
- 包管理器：yarn（优先使用 yarn install/yarn add）
- UI 风格：偏好紧凑布局（减少间距/宽度、保持原字号）
- 开发策略：先在子类验证修复方案，不行再提升至基类；方案不符合预期时优先回滚

## 离线优先架构重构（2026-04-11）

### 新增文件
- `src/services/DatabaseService.js` - 渲染进程数据库服务（通过 IPC 调用主进程 sql.js）
- `src/services/SyncService.js` - 为知笔记同步服务（pull/push/conflict resolve）
- `src/store/offline/index.js` - Vuex offline 模块
- `src/components/ui/dialog/ConflictResolveDialog.vue` - 冲突解决对话框
- `src/utils/DatabaseClient.js` - 渲染进程数据库客户端（IPC 封装）

### 修改文件
- `src-electron/main-process/electron-main.js` - 添加数据库初始化和 IPC 处理器
- `src/components/ui/dialog/LoginDialog.vue` - 添加「暂不登录」按钮
- `src/App.vue` - 集成 offline store 初始化
- `src/store/index.js` - 注册 offline 模块
- `src/i18n/zh-cn/other.js` / `en-us/other.js` - 添加同步相关翻译

### 新增依赖
- `sql.js` - WASM-based SQLite（替代 better-sqlite3，避免 native 模块编译问题）
- `uuid: ^9.0.0` - UUID 生成

### 核心设计
- 数据库位置：`userData/memocast.db`
- 同步状态：local_only | synced | pending_upload | pending_download | conflict
- 冲突解决：保留本地 / 保留云端 / 手动合并
- **SQLite 本地优先**：打开笔记时先查 SQLite，有则直接用；无则请求云端
- **切换自动保存**：切换笔记前自动保存编辑器内容到 SQLite（sync_status=pending_upload）
- **同步上传格式**：SyncService 上传时用 `helper.embedMDNote()` 将 markdown 包装成 html，匹配为知笔记 API 要求

## QuickInsert（快捷面板）修复记录

### 问题描述
快捷面板（QuickInsert）的左右键盘导航异常，而上下导航正常。

### 问题根因
`BaseScrollFloat` 基类的 `step()` 方法中：
- `previous`/`next`：使用 `index ± columns` 并正确处理分区边界
- `left`/`right`：只是简单的 `index ± 1`，忽略分区边界

当 QuickInsert 有多个分区（basic block、advance block）且网格布局（columnsCount=3）时，简单 `±1` 会导致跳转到错误位置或跨越分区边界。

### 修复方案
在 `QuickInsert` 中重写 `step()` 方法，让左右导航与上下导航使用相同的"分区内相对位置"计算逻辑。

### 涉及文件
- `src/libs/muya/lib/ui/quickInsert/index.js` - 重写 step() 方法
- `src/libs/muya/lib/ui/baseScrollFloat/index.js` - 基类（暂不修改）

## BaseScrollFloat 继承关系
以下组件继承自 BaseScrollFloat：
- `QuickInsert` - 网格布局（3列），有分区，需重写 step()
- `ImagePathPicker` - 单列列表，无需重写
- `EmojiPicker` - 单列列表，无需重写
- `CodePicker` - 单列列表，无需重写

## 关键配置常量
- QuickInsert GRID_COLUMNS = 3（可配置网格列数）
