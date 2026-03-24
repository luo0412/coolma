import { webContents, BrowserWindow } from 'electron'

async function sendNotification (notificationPayload, event) {
  let wcs = BrowserWindow.fromWebContents(event.sender)?.webContents
  if (!wcs) {
    wcs = webContents.getFocusedWebContents()
  }
  return wcs?.send('show-notification', notificationPayload)
}

async function triggerRendererContextMenu (eventName, eventData, event) {
  let wcs = BrowserWindow.fromWebContents(event.sender)?.webContents
  if (!wcs) {
    wcs = webContents.getFocusedWebContents()
  }
  console.log('triggerRendererContextMenu', eventName, eventData)
  return wcs?.send('pop-context-menu-event', {
    eventName,
    eventData
  })
}

// async function requestResourceTempUrl (kbGuid, docGuid, resName) {
//   if (!wcs) {
//     wcs = webContents.getFocusedWebContents()
//   }
//   return wcs.send('request-resource-temp-url', { kbGuid, docGuid, resName })
// }

export {
  sendNotification,
  triggerRendererContextMenu
}
