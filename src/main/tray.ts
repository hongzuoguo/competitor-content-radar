import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'

export function createAppTray(actions: {
  showWindow(): void
  runNow(): void
  quit(): void
}): Tray {
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'hitmuse-mark.png')
    : join(__dirname, '../renderer/hitmuse-mark.png')
  const image = nativeImage.createFromPath(icon)
  const tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('HitMuse')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开工作台', click: actions.showWindow },
      { label: '立即运行', click: actions.runNow },
      { type: 'separator' },
      { label: '退出', click: actions.quit }
    ])
  )
  tray.on('double-click', actions.showWindow)
  return tray
}
