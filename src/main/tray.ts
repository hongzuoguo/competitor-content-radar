import { Menu, Tray, nativeImage } from 'electron'

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#176c72"/><path d="M7 17h4l2-6 4 12 3-8 2 2h3" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

export function createAppTray(actions: {
  showWindow(): void
  runNow(): void
  quit(): void
}): Tray {
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString('base64')}`
  )
  const tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('对标内容雷达')
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
