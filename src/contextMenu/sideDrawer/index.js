import {
  OPEN_TIER_RANKING,
  // RENAME,
  CREATE_CATEGORY,
  CREATE_NOTE,
  OPEN_IMPORT,
  EXPORT,
  DELETE,
  SEPARATOR
} from './menuItems'
import { i18n } from 'boot/i18n'
import helper from 'src/utils/helper'
import { popContextMenu } from 'src/ApiInvoker'

/**
 * Show editor context menu.
 *
 * @param {MouseEvent} event The native mouse event.
 * @param {boolean} isCurrentCategory
 * @param {string} category
 * @param {boolean} isLogin Whether user is logged in
 */
export const showContextMenu = (event, isCurrentCategory, category, isLogin) => {
  const isRootCategory = helper.isNullOrEmpty(category)

  // 根目录禁用导出和删除
  EXPORT.enabled = !isRootCategory
  DELETE.enabled = !isRootCategory

  const ITEMS = []

  // 离线未登录时，隐藏创建文件夹、导入、导出选项
  if (isLogin) {
    ITEMS.push(CREATE_CATEGORY)
    ITEMS.push(OPEN_IMPORT)
    ITEMS.push(EXPORT)
  }

  ITEMS.push(CREATE_NOTE)
  ITEMS.push(SEPARATOR)

  // 只有登录用户才能使用标签排行榜
  if (isLogin) {
    ITEMS.push(OPEN_TIER_RANKING)
    ITEMS.push(SEPARATOR)
  }

  // 非根目录才能删除
  if (!isRootCategory) {
    ITEMS.push(DELETE)
  }

  const MENU_ITEM = ITEMS.map(item => {
    if (item.type === 'separator') return item
    return {
      ...item,
      label: i18n.t(item.label)
    }
  })

  popContextMenu({
    x: event.clientX,
    y: event.clientY,
    menuItems: MENU_ITEM
  }).then(console.log)
}
