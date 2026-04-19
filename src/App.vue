<template>
  <div id='q-app'>
    <a-config-provider :locale='antdZhCN'>
      <router-view />
    </a-config-provider>
    <!-- 冲突解决对话框 -->
    <ConflictResolveDialog ref="conflictDialog" />
    <!-- 离线笔记同步提示对话框 -->
    <OfflineSyncPromptDialog ref="offlineSyncDialog" @sync="handleOfflineSync" @skip="handleOfflineSkipSync" />
  </div>
</template>
<script>
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import ErrorHandler from './ErrorHandler'
import ScheduleHandler from './ScheduleHandler'
import ApiHandler from 'src/ApiHandler'
import { createNamespacedHelpers } from 'vuex'
import bus from './components/bus'
import events from './constants/events'
import { checkUpdate } from './ApiInvoker'
import ConflictResolveDialog from './components/ui/dialog/ConflictResolveDialog.vue'
import OfflineSyncPromptDialog from './components/ui/dialog/OfflineSyncPromptDialog.vue'

const { RegisterErrorHandler } = ErrorHandler
const { RegisterScheduleJobs } = ScheduleHandler
const { RegisterApiHandler } = ApiHandler

const { mapActions: mapClientActions, mapState: mapClientState } = createNamespacedHelpers('client')
const {
  mapActions: mapServerActions,
  mapState: mapServerState
} = createNamespacedHelpers('server')
const {
  mapActions: mapOfflineActions,
  mapState: mapOfflineState
} = createNamespacedHelpers('offline')
export default {
  name: 'App',
  components: { ConflictResolveDialog, OfflineSyncPromptDialog },
  data () {
    return {
      autoSaveInterval: null,
      antdZhCN: zhCN,
      // 记录上次冲突数，避免重复弹出
      lastConflictCount: 0
    }
  },
  computed: {
    ...mapClientState(['autoSaveGap']),
    ...mapOfflineState(['isInitialized', 'conflictNotes'])
  },
  async mounted () {
    RegisterErrorHandler()
    RegisterScheduleJobs(this)
    RegisterApiHandler()
    bus.$on(events.RELOGIN, this.reLogin)
    bus.$on('showOfflineSyncPrompt', this.showOfflineSyncPrompt)
    checkUpdate()
    this.initClientStore().then()
    this.initServerStore().then()
    // 初始化离线存储后，如果已登录则触发一次自动同步
    // 如果未登录，也初始化离线模式（显示离线笔记树）
    this.initOfflineStore().then(() => {
      if (this.isLogin) {
        this.sync() // fire-and-forget，不阻塞
      } else {
        // 未登录：初始化离线模式，加载本地 SQLite 笔记
        this.initOfflineMode()
      }
    })
    this.setupAutoSaveInterval(this.autoSaveGap)
  },
  methods: {
    setupAutoSaveInterval: function (gap) {
      clearInterval(this.autoSaveInterval)
      if (gap === 0 && this.autoSaveInterval !== null) {
        this.autoSaveInterval = null
      } else if (gap !== 0) {
        this.autoSaveInterval = setInterval(() => {
          bus.$emit(events.NOTE_SHORTCUT_CALL.save)
        }, gap * 1000)
      }
    },
    // 显示离线笔记同步提示对话框
    showOfflineSyncPrompt (offlineNotes) {
      if (this.$refs.offlineSyncDialog) {
        this.$refs.offlineSyncDialog.show(offlineNotes)
      }
    },
    // 确认同步离线笔记
    async handleOfflineSync () {
      console.log('[App] handleOfflineSync: starting sync...')
      try {
        const result = await this.sync()
        if (result && result.success) {
          console.log('[App] Offline sync completed successfully')
        } else {
          console.warn('[App] Offline sync completed with issues:', result)
        }
      } catch (err) {
        console.error('[App] Offline sync failed:', err)
      }
    },
    // 跳过同步离线笔记
    handleOfflineSkipSync () {
      console.log('[App] handleOfflineSkipSync: skipped')
    },
    // 显示冲突解决对话框
    showConflictDialog (note) {
      if (this.$refs.conflictDialog) {
        this.$refs.conflictDialog.show(note)
      }
    },
    ...mapClientActions(['initClientStore']),
    ...mapServerActions(['initServerStore', 'reLogin', 'initOfflineMode']),
    ...mapServerState(['isLogin']),
    ...mapOfflineActions(['initOfflineStore', 'sync'])
  },
  watch: {
    autoSaveGap: function (val) {
      this.setupAutoSaveInterval(val)
    },
    // 冲突笔记变化时自动弹出对话框（只在数量增加时触发）
    conflictNotes: {
      handler (notes) {
        if (notes && notes.length > this.lastConflictCount) {
          this.showConflictDialog(notes[0])
        }
        this.lastConflictCount = notes ? notes.length : 0
      },
      deep: true
    }
  },
  beforeDestroy () {
    bus.$off('showOfflineSyncPrompt', this.showOfflineSyncPrompt)
  }
}
</script>
