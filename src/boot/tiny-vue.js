import Vue from 'vue'
import OpentinyVue from '@opentiny/vue'

Vue.use(OpentinyVue)

export default ({ app }) => {
  app.opentiny = OpentinyVue
}

export { OpentinyVue }
