/**
 * Capturas de ROOM sin ventana a la vista y sin tocar los datos de nadie:
 * userData temporal, el IPC de verdad, la ventana de verdad (fuera de
 * pantalla) y las fotos de MUESTRAS.
 *
 *   node scripts → npm run capturas   (con MUESTRAS y SALIDA)
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

app.setPath('userData', mkdtempSync(join(tmpdir(), 'room-arnes-')))
const raiz = join(__dirname, '../..')
copyFileSync(join(raiz, 'out/main/heic.js'), join(raiz, 'out/test/heic.js'))
const { registrarIpc, guardarRevelado } = require(join(raiz, 'out/test/arnes.cjs'))

const muestras = process.env.MUESTRAS
const salida = process.env.SALIDA
mkdirSync(salida, { recursive: true })
const escena = process.env.ESCENA ?? 'revelada'

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  registrarIpc()
  const w = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { preload: join(raiz, 'out/preload/index.js'), offscreen: true, backgroundThrottling: false, sandbox: false }
  })
  w.webContents.setFrameRate(10)
  let ultima = null
  w.webContents.on('paint', (_e, _d, imagen) => {
    if (!imagen.isEmpty()) ultima = imagen
  })
  w.webContents.on('console-message', (e) => {
    const m = e.message ?? e
    if (String(m).length < 400) console.log('[ventana]', m)
  })
  await w.loadFile(join(raiz, 'out/renderer/index.html'))
  await espera(1200)
  writeFileSync(join(salida, '0-vacia.png'), ultima.toPNG())

  const fotos = ['iphone.heic', 'example.heic', 'con-exif.jpg'].map((n) => join(muestras, n)).filter(existsSync)
  if (escena === 'revelada') {
    const neutro = require(join(raiz, 'out/test/arnes.cjs'))
    // Un aspecto de carrete puesto de antemano, como si se hubiera revelado otro día.
    guardarRevelado(fotos[0], {
      v: 1, contraste: 18, sombras: 20, luces: -25, temperatura: 22, saturacion: -12, textura: 0, claridad: 10, neblina: 0, viveza: 0,
      curvas: { lum: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.95 }], r: [{ x: 0, y: 0 }, { x: 1, y: 1 }], g: [{ x: 0, y: 0 }, { x: 1, y: 1 }], b: [{ x: 0, y: 0.04 }, { x: 1, y: 1 }] },
      ruedas: { sombras: { x: -0.35, y: 0.45 }, medios: { x: 0, y: 0 }, luces: { x: 0.25, y: -0.5 } },
      grano: 35, tamanoGrano: 30, asperezaGrano: 50, halo: 25, vineteado: 30, suavizado: 8
    })
  }
  w.webContents.send('fotos:abrir', fotos)
  await espera(9000)
  writeFileSync(join(salida, `1-${escena}.png`), ultima.toPNG())
  app.exit(0)
})
