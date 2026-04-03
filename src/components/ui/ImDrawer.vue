<template>
  <q-drawer
    ref="drawer"
    :value="false"
    :width="$q.screen.width"
    overlay
    elevated
    content-class="hide-scrollbar"
    class="im-drawer"
  >
    <div class="im-wujie-wrapper">
      <WujieVue
        v-if="visible"
        width="100%"
        height="100%"
        name="box-im"
        :url="imUrl"
        :sync="false"
        :props="wujieProps"
      />
    </div>
  </q-drawer>
</template>

<script>
import WujieVue from 'wujie-vue2'

export default {
  name: 'ImDrawer',
  components: {
    WujieVue
  },
  data () {
    return {
      visible: false
    }
  },
  computed: {
    imUrl () {
      if (process.env.MODE === 'electron') {
        return 'http://localhost:8080/box-im/'
      }
      return '/box-im/'
    },
    wujieProps () {
      return {
        data: {}
      }
    }
  },
  methods: {
    show () {
      this.visible = true
      this.$nextTick(() => {
        if (this.$refs.drawer) {
          this.$refs.drawer.show()
        }
      })
    },
    hide () {
      if (this.$refs.drawer) {
        this.$refs.drawer.hide()
      }
    },
    toggle () {
      if (this.$refs.drawer && this.$refs.drawer.showing) {
        this.hide()
      } else {
        this.show()
      }
    }
  }
}
</script>

<style scoped>
.im-drawer {
  background-color: var(--editorBgColor, #ffffff);
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.12);
}

.im-wujie-wrapper {
  height: 100%;
  overflow: hidden;
  position: relative;
}
</style>
