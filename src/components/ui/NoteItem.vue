/** * @Description: * @Author: TankNee * @Date: 9/8/2020 1:24 PM **/
<template>
  <q-card
    flat
    :class='`note-card${darkTag} bg-transparent`'
    @click='noteItemClickHandler'
  >
    <div :class='`note-item-title${darkTag} ${denseTag}`'>
      <q-icon :name="fileIcon" class="note-file-icon" size="16px" />
      <span v-html='title'></span>
    </div>

    <div v-if="!dense" :class='`note-item-summary${darkTag}`' v-html='summary'></div>

    <div :class='`note-item-summary${darkTag} flex justify-between no-wrap overflow-hidden fa-align-center`'>
      <span class='text-left note-info-tag'><q-icon name='category' size='17px' /> {{ category }}</span>
      <span class='text-right note-info-tag'><q-icon name='timer' size='17px' /> {{ modifiedDate }}</span>
    </div>
  </q-card>
</template>

<script>
import _ from 'lodash'
import { createNamespacedHelpers } from 'vuex'
import helper from 'src/utils/helper'
import DatabaseClient from 'src/utils/DatabaseClient'

const {
  mapActions: mapServerActions,
  mapState: mapServerState
} = createNamespacedHelpers('server')
export default {
  name: 'NoteItem',
  props: {
    data: {
      type: Object,
      default () {
        return {
          abstractText: '',
          docGuid: '',
          category: ''
        }
      }
    },
    maxSummaryLength: {
      type: Number,
      default: 40
    },
    markdown: Boolean,
    contextmenuHandler: {
      type: Function,
      default: () => {}
    },
    dense: {
      type: Boolean,
      default: true
    },
    titleWrap: {
      type: Boolean,
      default: false
    },
    maxTitleLength: {
      type: Number,
      default: 25
    }
  },
  data () {
    return {
      categoryDialogLabel: '',
      categoryDialogHandler: () => {},
      count: 0
    }
  },
  computed: {
    fileIcon () {
      const title = this.data.title || ''
      if (_.endsWith(title, '.md')) return 'description'
      if (_.endsWith(title, '.txt')) return 'text_snippet'
      if (_.endsWith(title, '.html') || _.endsWith(title, '.htm')) return 'html'
      if (_.endsWith(title, '.pdf')) return 'pdf'
      return 'note'
    },
    summary () {
      if (helper.isNullOrEmpty(this.data.abstractText) && !helper.isNullOrEmpty(this.data.highlight)) {
        const { highlight: { text = [] } } = this.data
        const summary = text.join('')
        return summary.length > this.maxSummaryLength
          ? summary.substring(0, this.maxSummaryLength) + '...'
          : summary
      }
      return this.data.abstractText &&
      this.data.abstractText.length > this.maxSummaryLength
        ? this.data.abstractText.substring(0, this.maxSummaryLength) + '...'
        : this.data.abstractText
    },
    title () {
      if (!helper.isNullOrEmpty(this.data.highlight)) {
        const { highlight: { title = [] } } = this.data
        const tempTitle = title.join('')
        if (this.titleWrap) {
          return tempTitle &&
          tempTitle.length > this.maxTitleLength
            ? tempTitle.substring(0, this.maxTitleLength) + '...'
            : tempTitle
        }
        return title.join('')
      }
      return this.data.title
    },
    docGuid () {
      return this.data.docGuid
    },
    darkMode () {
      return this.$q.dark.isActive
    },
    darkTag () {
      return this.darkMode ? '-dark' : ''
    },
    denseTag () {
      return this.dense ? 'dense' : ''
    },
    modifiedDate () {
      return helper.displayDateElegantly(this.data.dataModified)
    },
    category () {
      if (helper.isNullOrEmpty(this.data.category)) return ''
      try {
        if (helper.wizIsPredefinedLocation(this.data.category)) return this.$t(this.data.category)
        const categoryList = this.data.category.split('/')
        return categoryList[categoryList.length - 2]
      } catch (e) {
        return ''
      }
    },
    ...mapServerState(['noteState', 'currentCategory'])
  },
  methods: {
    noteItemClickHandler: function () {
      if (this.noteState !== 'default') {
        // 有未保存的修改：先存 SQLite（原样），再切笔记，后台同步云端
        this.saveToSQLite().then(() => {
          console.time('NoteLoadTime')
          this.getNoteContent({ docGuid: this.docGuid }).then(() => console.timeEnd('NoteLoadTime'))
        })
        // 后台异步同步云端（不等待）
        this.asyncSyncToCloud()
      } else {
        console.time('NoteLoadTime')
        this.getNoteContent({ docGuid: this.docGuid }).then(() => console.timeEnd('NoteLoadTime'))
      }
    },
    // 获取当前编辑器的 markdown 内容
    getCurrentMarkdown () {
      // 优先尝试通过 $root 找到 Index 页面组件
      const findIndexPage = (root) => {
        const queue = [...root.$children]
        while (queue.length) {
          const child = queue.shift()
          if (child.$refs?.muya && typeof child.$refs.muya.getValue === 'function') {
            return child
          }
          if (child.$refs?.monaco && typeof child.$refs.monaco.getValue === 'function') {
            return child
          }
          queue.push(...child.$children)
        }
        return null
      }

      const page = findIndexPage(this.$root)
      if (!page) {
        console.warn('[NoteItem] Cannot find editor page')
        return ''
      }

      // Muya 编辑器
      const muya = page.$refs.muya
      if (muya && typeof muya.getValue === 'function') {
        return muya.getValue()
      }
      // Monaco 编辑器
      const monaco = page.$refs.monaco
      if (monaco && typeof monaco.getValue === 'function') {
        return monaco.getValue()
      }
      return ''
    },
    // 保存当前笔记到本地 SQLite（切换时调用，保存编辑器最新内容）
    async saveToSQLite () {
      try {
        const state = this.$store.state.server
        const currentNote = state.currentNote
        const docGuid = currentNote?.info?.docGuid
        const info = currentNote?.info
        console.log('[NoteItem] saveToSQLite called, docGuid:', docGuid, 'hasInfo:', !!info)
        if (!docGuid || !info) {
          console.warn('[NoteItem] saveToSQLite skipped: no docGuid or info')
          return false
        }

        const markdown = this.getCurrentMarkdown()
        console.log('[NoteItem] getCurrentMarkdown returned length:', markdown?.length || 0)
        if (!markdown) {
          console.warn('[NoteItem] saveToSQLite skipped: empty markdown')
          return false
        }

        const localNote = await DatabaseClient.getNoteByDocGuid(docGuid)
        console.log('[NoteItem] SQLite lookup result:', localNote ? `id=${localNote.id}` : 'null')
        if (localNote) {
          await DatabaseClient.updateNote(localNote.id, {
            content: markdown,
            title: info.title,
            category: info.category || '/',
            sync_status: 'pending_upload'
          })
          console.log('[NoteItem] SQLite updated:', docGuid, 'content length:', markdown.length)
        } else {
          await DatabaseClient.createNote({
            doc_guid: docGuid,
            title: info.title,
            content: markdown,
            category: info.category || '/',
            sync_status: 'pending_upload'
          })
          console.log('[NoteItem] SQLite created:', docGuid, 'content length:', markdown.length)
        }
        return true
      } catch (err) {
        console.error('[NoteItem] saveToSQLite failed:', err)
        return false
      }
    },
    // 保存当前笔记（云端）
    async saveCurrentNote (markdown) {
      if (markdown && typeof this.$store.dispatch === 'function') {
        await this.$store.dispatch('server/updateNote', markdown)
      }
    },
    // 后台异步同步到云端（不等待）
    async asyncSyncToCloud () {
      try {
        if (this.$store && this.$store.hasModule('offline')) {
          this.$store.dispatch('offline/sync')
        }
      } catch (error) {
        console.error('[NoteItem] Async sync failed:', error)
      }
    },
    ...mapServerActions(['getNoteContent', 'updateNoteInfo'])
  }
}
</script>

<style scoped>

</style>
