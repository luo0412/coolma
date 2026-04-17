// scripts/after-pack.js
// electron-builder afterPack 钩子：在 app 完全解压后裁剪 Electron 多余文件
const path = require('path')
const fs = require('fs')

module.exports = function afterPack(context) {
  const { appOutDir, packager } = context
  const platform = packager.platform.name // 'mac', 'windows', or 'linux'

  // 确定 locales 目录的实际路径（各平台位置不同）
  let localesPath
  let resourcesPath

  if (platform === 'mac') {
    // macOS: Electron locales 在 .app/Contents/Frameworks/Electron Framework.framework/ 中
    const appBundlePath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
    resourcesPath = path.join(appBundlePath, 'Contents', 'Resources')
    localesPath = path.join(appBundlePath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources', 'locales')
  } else if (platform === 'windows') {
    // Windows: locales 直接在 win-unpacked\ 下，与 resources 同级
    resourcesPath = path.join(appOutDir, 'resources')
    localesPath = path.join(appOutDir, 'locales')
  } else {
    // Linux: locales 在 resources 目录下
    resourcesPath = path.join(appOutDir, 'resources')
    localesPath = path.join(resourcesPath, 'locales')
  }

  console.log(`[afterPack] 平台: ${platform}`)
  console.log(`[afterPack] resources: ${resourcesPath}`)
  console.log(`[afterPack] locales: ${localesPath}`)

  // ─── 1. 裁剪 locales，只保留中英文 ───
  if (fs.existsSync(localesPath)) {
    const whitelist = ['en-US.pak', 'en.pak', 'zh-CN.pak']
    const files = fs.readdirSync(localesPath)
    let removedCount = 0
    let removedSize = 0
    files.forEach((f) => {
      if (!whitelist.includes(f)) {
        const fullPath = path.join(localesPath, f)
        const size = fs.statSync(fullPath).size
        fs.unlinkSync(fullPath)
        removedCount++
        removedSize += size
      }
    })
    console.log(`[afterPack] locales 裁剪完成: 删除了 ${removedCount} 个文件 (${formatSize(removedSize)}), 保留了 en-US/en/zh-CN`)
  } else {
    console.log(`[afterPack] locales 目录不存在: ${localesPath}`)
  }

  // ─── 2. 删除调试文件 ───
  const debugLog = path.join(resourcesPath, 'debug.log')
  if (fs.existsSync(debugLog)) {
    fs.unlinkSync(debugLog)
    console.log('[afterPack] 已删除 debug.log')
  }

  // ─── 3. 清理 crashpad (生产环境不需要) ───
  if (platform === 'mac') {
    const crashpadDir = path.join(resourcesPath, 'crashpad')
    if (fs.existsSync(crashpadDir)) {
      rmrf(crashpadDir)
      console.log('[afterPack] 已删除 crashpad 目录')
    }
  }
  if (platform === 'windows') {
    const crashpadClient = path.join(resourcesPath, 'crashpad_handler.exe')
    if (fs.existsSync(crashpadClient)) {
      fs.unlinkSync(crashpadClient)
      console.log('[afterPack] 已删除 crashpad_handler.exe')
    }
    const crashpadReports = path.join(resourcesPath, 'Crashpad')
    if (fs.existsSync(crashpadReports)) {
      rmrf(crashpadReports)
      console.log('[afterPack] 已删除 Crashpad 目录')
    }
  }
}

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((file) => {
      const cur = path.join(dir, file)
      if (fs.lstatSync(cur).isDirectory()) {
        rmrf(cur)
      } else {
        fs.unlinkSync(cur)
      }
    })
    fs.rmdirSync(dir)
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
