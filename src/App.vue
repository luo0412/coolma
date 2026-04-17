<template>
  <div id='q-app'>
    <a-config-provider :locale='antdZhCN'>
      <router-view />
    </a-config-provider>
    <!-- 冲突解决对话框 -->
    <ConflictResolveDialog ref="conflictDialog" />
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
  components: { ConflictResolveDialog },
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
    checkUpdate()
    this.initClientStore().then()
    this.initServerStore().then()
    // 初始化离线存储后，如果已登录则触发一次自动同步
    this.initOfflineStore().then(() => {
      if (this.isLogin) {
        this.sync() // fire-and-forget，不阻塞
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
    // 显示冲突解决对话框
    showConflictDialog (note) {
      if (this.$refs.conflictDialog) {
        this.$refs.conflictDialog.show(note)
      }
    },
    ...mapClientActions(['initClientStore']),
    ...mapServerActions(['initServerStore', 'reLogin']),
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
  }
}
</script>
