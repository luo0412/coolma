<template>
  <q-dialog
    ref="dialog"
    @hide="onDialogHide"
    :seamless="true"
    position="top"
    class="conflict-dialog"
  >
    <q-card class="conflict-resolve-card">
      <!-- Header -->
      <q-card-section class="conflict-header">
        <div class="row items-center no-wrap">
          <q-icon name="warning" color="warning" size="24px" class="q-mr-sm" />
          <span class="text-subtitle1 text-weight-bold">{{ $t('syncConflict') }}</span>
        </div>
      </q-card-section>

      <!-- Note Info -->
      <q-card-section class="conflict-note-info">
        <div class="text-subtitle2 q-mb-sm">{{ currentNote?.title || 'Untitled' }}</div>
        <div class="text-caption text-grey">
          {{ $t('conflictNote', { localTime: formatTime(localModified), serverTime: formatTime(serverModified) }) }}
        </div>
      </q-card-section>

      <!-- Comparison -->
      <q-card-section class="conflict-comparison">
        <div class="row q-col-gutter-md">
          <!-- Local Version -->
          <div class="col-6">
            <div class="conflict-version-header">
              <q-icon name="computer" color="primary" />
              <span class="q-ml-sm">{{ $t('localVersion') }}</span>
            </div>
            <div class="conflict-version-content">
              <div class="text-caption text-grey q-mb-xs">{{ $t('modifiedAt', { time: formatTime(localModified) }) }}</div>
              <div class="conflict-content-preview" v-html="localPreview"></div>
            </div>
            <q-btn
              :color="selectedVersion === 'local' ? 'primary' : 'grey-7'"
              :outline="selectedVersion !== 'local'"
              :label="$t('keepLocal')"
              class="full-width q-mt-sm"
              @click="selectVersion('local')"
            />
          </div>

          <!-- Server Version -->
          <div class="col-6">
            <div class="conflict-version-header">
              <q-icon name="cloud" color="secondary" />
              <span class="q-ml-sm">{{ $t('serverVersion') }}</span>
            </div>
            <div class="conflict-version-content">
              <div class="text-caption text-grey q-mb-xs">{{ $t('modifiedAt', { time: formatTime(serverModified) }) }}</div>
              <div class="conflict-content-preview" v-html="serverPreview"></div>
            </div>
            <q-btn
              :color="selectedVersion === 'server' ? 'secondary' : 'grey-7'"
              :outline="selectedVersion !== 'server'"
              :label="$t('keepServer')"
              class="full-width q-mt-sm"
              @click="selectVersion('server')"
            />
          </div>
        </div>
      </q-card-section>

      <!-- Merge Option -->
      <q-card-section v-if="selectedVersion === 'merge'" class="conflict-merge">
        <div class="text-subtitle2 q-mb-sm">
          <q-icon name="merge_type" class="q-mr-xs" />
          {{ $t('mergeContent') }}
        </div>
        <q-input
          v-model="mergedContent"
          type="textarea"
          outlined
          autogrow
          :placeholder="$t('enterMergedContent')"
          class="merge-input"
        />
      </q-card-section>

      <!-- Manual Merge Button -->
      <q-card-section v-if="selectedVersion !== 'merge'" class="conflict-merge-hint">
        <q-btn
          flat
          dense
          color="primary"
          :label="$t('manualMerge')"
          icon="edit"
          @click="startMerge"
        />
      </q-card-section>

      <!-- Actions -->
      <q-card-actions align="right" class="conflict-actions">
        <q-btn
          flat
          :label="$t('skipForNow')"
          color="grey"
          @click="skipForNow"
        />
        <q-btn
          unelevated
          :label="$t('resolve')"
          color="primary"
          :disable="!canResolve"
          @click="resolveConflict"
        />
      </q-card-actions>

      <!-- Progress -->
      <q-linear-progress
        v-if="isResolving"
        :value="1"
        color="primary"
        indeterminate
        class="conflict-progress"
      />
    </q-card>
  </q-dialog>
</template>

<script>
import { createDOMPurify } from 'dompurify'

const DOMPurify = createDOMPurify ? createDOMPurify(window) : {
  sanitize: (html) => html
}

export default {
  name: 'ConflictResolveDialog',

  data() {
    return {
      noteId: null,
      currentNote: null,
      localContent: '',
      serverContent: '',
      localModified: null,
      serverModified: null,
      selectedVersion: null,
      mergedContent: '',
      isResolving: false
    }
  },

  computed: {
    localPreview() {
      if (!this.localContent) return '<em class="text-grey">-</em>'
      const preview = this.localContent.substring(0, 500)
      return DOMPurify.sanitize(preview) + (this.localContent.length > 500 ? '...' : '')
    },

    serverPreview() {
      if (!this.serverContent) return '<em class="text-grey">-</em>'
      const preview = this.serverContent.substring(0, 500)
      return DOMPurify.sanitize(preview) + (this.serverContent.length > 500 ? '...' : '')
    },

    canResolve() {
      if (this.selectedVersion === 'local' || this.selectedVersion === 'server') {
        return true
      }
      if (this.selectedVersion === 'merge' && this.mergedContent.trim()) {
        return true
      }
      return false
    }
  },

  methods: {
    show(note) {
      this.noteId = note.id
      this.currentNote = note
      this.localContent = note.content || ''
      this.localModified = note.local_modified
      this.serverModified = note.server_modified
      this.selectedVersion = null
      this.mergedContent = ''
      this.isResolving = false

      // Load server content from backup
      this.loadServerContent()

      this.$refs.dialog.show()
    },

    hide() {
      this.$refs.dialog.hide()
    },

    onDialogHide() {
      this.$emit('hide')
    },

    async loadServerContent() {
      // Server content should be loaded before showing dialog
      // This is handled by the parent component
    },

    selectVersion(version) {
      this.selectedVersion = version
      if (version === 'merge') {
        this.mergedContent = this.localContent
      }
    },

    startMerge() {
      this.selectedVersion = 'merge'
      this.mergedContent = this.localContent
    },

    formatTime(timestamp) {
      if (!timestamp) return '-'
      const date = new Date(timestamp)
      return date.toLocaleString()
    },

    async resolveConflict() {
      if (!this.canResolve) return

      this.isResolving = true
      this.$emit('resolve', {
        noteId: this.noteId,
        resolution: this.selectedVersion,
        mergedContent: this.mergedContent
      })

      // Close after a short delay to allow parent to process
      setTimeout(() => {
        this.hide()
      }, 500)
    },

    skipForNow() {
      this.hide()
      this.$emit('skip', this.noteId)
    }
  }
}
</script>

<style lang="scss" scoped>
.conflict-resolve-card {
  min-width: 700px;
  max-width: 900px;
  max-height: 80vh;
  overflow-y: auto;
}

.conflict-header {
  background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
  border-bottom: 1px solid #ffcc80;
}

.conflict-note-info {
  border-bottom: 1px solid #eee;
}

.conflict-comparison {
  padding-top: 16px;
  padding-bottom: 16px;
}

.conflict-version-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  background: #f5f5f5;
  border-radius: 4px 4px 0 0;
  font-weight: 500;
}

.conflict-version-content {
  padding: 12px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-top: none;
  min-height: 150px;
  max-height: 200px;
  overflow-y: auto;
}

.conflict-content-preview {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.conflict-merge {
  border-top: 1px solid #eee;
  background: #fafafa;
}

.merge-input {
  :deep(.q-field__control) {
    min-height: 100px;
  }
}

.conflict-merge-hint {
  padding-top: 0;
}

.conflict-actions {
  border-top: 1px solid #eee;
  padding: 12px 16px;
}

.conflict-progress {
  height: 3px;
}
</style>
