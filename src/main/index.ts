import { app, BrowserWindow, Menu, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registrarIpc } from './ipc'
import { cerrarDatos, leerAjustes } from './datos'
import { pararDecodificador } from './fotos'

let ventana: BrowserWindow | null = null

const isDev = !app.isPackaged
const APP_ID = 'com.room.desktop'
const rutaIcono = join(__dirname, '../../resources/icon.ico')
const icono = existsSync(rutaIcono) ? rutaIcono : undefined

/** El fondo de la ventana nativa mientras carga, el mismo que pinta la hoja. */
function fondo(): string {
  const { tema } = leerAjustes()
  const oscuro = tema === 'dark' || (tema === 'system' && nativeTheme.shouldUseDarkColors)
  return oscuro ? '#12101a' : '#e3ddd6'
}

/** Las fotos que llegan al abrir ROOM con ellas: «Abrir con» o arrastradas al icono. */
function fotosDeArgumentos(argv: string[]): string[] {
  return argv.slice(isDev ? 2 : 1).filter((a) => !a.startsWith('-') && /\.(heic|heif|hif|jpe?g|png)$/i.test(a) && existsSync(a))
}

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: fondo(),
    title: 'ROOM',
    ...(icono ? { icon: icono } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  ventana.once('ready-to-show', () => ventana?.show())
  ventana.on('closed', () => {
    ventana = null
  })

  // Nada se abre dentro: los enlaces van al navegador, y la ventana no navega.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  ventana.webContents.on('will-navigate', (evento, url) => {
    if (isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return
    evento.preventDefault()
  })

  const iniciales = fotosDeArgumentos(process.argv)
  if (iniciales.length) {
    ventana.webContents.once('did-finish-load', () => ventana?.webContents.send('fotos:abrir', iniciales))
  }

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void ventana.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void ventana.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Una sola ROOM: abrir otra foto con ella la manda a la que ya está abierta.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (!ventana) return
    if (ventana.isMinimized()) ventana.restore()
    ventana.focus()
    const fotos = fotosDeArgumentos(argv)
    if (fotos.length) ventana.webContents.send('fotos:abrir', fotos)
  })

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID)
    Menu.setApplicationMenu(null)
    registrarIpc()
    crearVentana()
  })

  app.on('window-all-closed', () => {
    pararDecodificador()
    cerrarDatos()
    app.quit()
  })
}
