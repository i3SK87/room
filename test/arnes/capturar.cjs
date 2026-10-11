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
    webPreferences: {
      preload: join(raiz, 'out/preload/index.js'),
      offscreen: true,
      backgroundThrottling: false,
      sandbox: false
    }
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
      v: 1,
      contraste: 18,
      sombras: 20,
      luces: -25,
      temperatura: 22,
      saturacion: -12,
      textura: 0,
      claridad: 10,
      neblina: 0,
      viveza: 0,
      curvas: {
        lum: [
          { x: 0, y: 0.1 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 0.95 }
        ],
        r: [
          { x: 0, y: 0 },
          { x: 1, y: 1 }
        ],
        g: [
          { x: 0, y: 0 },
          { x: 1, y: 1 }
        ],
        b: [
          { x: 0, y: 0.04 },
          { x: 1, y: 1 }
        ]
      },
      ruedas: {
        sombras: { x: -0.35, y: 0.45 },
        medios: { x: 0, y: 0 },
        luces: { x: 0.25, y: -0.5 }
      },
      grano: 35,
      tamanoGrano: 30,
      asperezaGrano: 50,
      halo: 25,
      vineteado: 30,
      suavizado: 8
    })
  }
  w.webContents.send('fotos:abrir', fotos)
  await espera(9000)
  writeFileSync(join(salida, `1-${escena}.png`), ultima.toPNG())

  if (escena === 'herramientas') {
    // Con el teclado y el ratón de verdad: R abre Recortar, Q abre Eliminar y se pinta un trazo.
    const tecla = async (k) => {
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k })
      w.webContents.sendInputEvent({ type: 'char', keyCode: k })
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k })
      await espera(1500)
    }
    const caja = async () =>
      w.webContents.executeJavaScript('JSON.stringify(document.querySelector(".visor-foto").getBoundingClientRect())').then(JSON.parse)
    const textos = async () =>
      w.webContents.executeJavaScript(
        '[...document.querySelectorAll(".visor-pie, .toast, [role=alert], [role=status]")].map((e) => e.textContent).join(" | ")'
      )
    await w.webContents.executeJavaScript('document.activeElement && document.activeElement.blur()')
    // Zoom: un clic corto amplía al 100 % donde se pulsa; arrastrar mueve; Z vuelve a encajar.
    const ratonZ = (type, x, y) =>
      w.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [] })
    let z = await caja()
    ratonZ('mouseDown', z.left + z.width * 0.7, z.top + z.height * 0.6)
    ratonZ('mouseUp', z.left + z.width * 0.7, z.top + z.height * 0.6)
    await espera(1500)
    writeFileSync(join(salida, 'z1-ampliada.png'), ultima.toPNG())
    console.log('[arnés] zoom tras el clic:', await textos())
    z = await caja()
    ratonZ('mouseDown', z.left + 300, z.top + 300)
    for (let i = 1; i <= 10; i++) ratonZ('mouseMove', z.left + 300 + i * 20, z.top + 300 + i * 10)
    ratonZ('mouseUp', z.left + 500, z.top + 400)
    await espera(1200)
    writeFileSync(join(salida, 'z2-movida.png'), ultima.toPNG())
    await tecla('Z')
    console.log('[arnés] tras Z:', await textos())
    await tecla('R')
    writeFileSync(join(salida, '2-recortar.png'), ultima.toPNG())
    // Enderezar arrastrando por fuera del marco, y un recorte desde la esquina.
    let c = await caja()
    const raton = (type, x, y) =>
      w.webContents.sendInputEvent({
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: 'left',
        clickCount: 1,
        modifiers: type === 'mouseMove' ? ['leftButtonDown'] : []
      })
    raton('mouseDown', c.right - 2, c.bottom - 2)
    for (let i = 1; i <= 10; i++) raton('mouseMove', c.right - 2 - i * 25, c.bottom - 2 - i * 15)
    raton('mouseUp', c.right - 252, c.bottom - 152)
    await espera(1200)
    writeFileSync(join(salida, '3-recortado.png'), ultima.toPNG())
    console.log('[arnés] tras recortar:', await textos())
    // Enderezar arrastrando por fuera de la foto, a la izquierda.
    c = await caja()
    raton('mouseDown', c.left - 14, c.top + c.height / 2)
    for (let i = 1; i <= 8; i++) raton('mouseMove', c.left - 14, c.top + c.height / 2 + i * 12)
    raton('mouseUp', c.left - 14, c.top + c.height / 2 + 96)
    await espera(1200)
    writeFileSync(join(salida, '3b-enderezado.png'), ultima.toPNG())
    const geo = await w.webContents.executeJavaScript(`new Promise((ok) => setTimeout(() => window.room.fotos.leer(${JSON.stringify(fotos[0])}).then((f) => ok(JSON.stringify(f.revelado && f.revelado.geometria))), 700))`)
    console.log('[arnés] geometría guardada:', geo)
    await tecla('R')
    await tecla('Q')
    // Se pinta con la foto ampliada, para probar que el trazo cae donde se pinta.
    await tecla('Z')
    console.log('[arnés] Eliminar ampliado:', await textos())
    c = await caja()
    const x0 = c.left + c.width * 0.3
    const y0 = c.top + c.height * 0.3
    const zona = { x: Math.round(x0 - 30), y: Math.round(y0 - 30), width: 140, height: 120 }
    const antes = ultima.crop(zona).toBitmap()
    raton('mouseDown', x0, y0)
    for (let i = 1; i <= 12; i++) raton('mouseMove', x0 + i * 6, y0 + i * 4)
    raton('mouseUp', x0 + 72, y0 + 48)
    await espera(300)
    console.log('[arnés] pintando:', await textos())
    await espera(4000)
    writeFileSync(join(salida, '4-eliminar.png'), ultima.toPNG())
    const despues = ultima.crop(zona).toBitmap()
    let dif = 0
    for (let i = 0; i < antes.length; i++) dif += Math.abs(antes[i] - despues[i])
    console.log('[arnés] cambio en la zona del trazo:', (dif / antes.length).toFixed(2))
    const guardado = await w.webContents.executeJavaScript(
      `window.room.fotos.leer(${JSON.stringify(fotos[0])}).then((f) => JSON.stringify(f.revelado && f.revelado.manchas.map((m) => [m.modo, m.puntos.length])))`
    )
    console.log('[arnés] trazos guardados:', guardado)

    // Exportar con el lado largo en 1000 px, a una carpeta temporal (nunca a Imágenes).
    const destino = mkdtempSync(join(tmpdir(), 'room-exportar-'))
    await w.webContents.executeJavaScript(`window.room.ajustes.cambiar(${JSON.stringify({ carpetaExportar: destino, tamano: 'lado', lado: 1000 })})`)
    // Que la ventana se entere de los ajustes nuevos: se vuelve a cargar, y la foto sigue como se dejó.
    await w.webContents.reload()
    await espera(1500)
    w.webContents.send('fotos:abrir', [fotos[0]])
    await espera(6000)
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'E', modifiers: ['control', 'shift'] })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'E', modifiers: ['control', 'shift'] })
    await espera(1500)
    writeFileSync(join(salida, '5-exportar.png'), ultima.toPNG())
    console.log(
      '[arnés] diálogo:',
      await w.webContents.executeJavaScript('document.querySelector(".modal") && document.querySelector(".modal").innerText.replace(/\\n+/g, " · ")')
    )
    await w.webContents.executeJavaScript('[...document.querySelectorAll(".modal .btn.primary")].pop().click()')
    await espera(8000)
    const { readdirSync } = require('node:fs')
    const { nativeImage } = require('electron')
    for (const n of readdirSync(destino)) {
      const im = nativeImage.createFromPath(join(destino, n))
      console.log('[arnés] exportada:', n, im.getSize())
    }
    console.log('[arnés] tras eliminar:', await textos())
  }
  app.exit(0)
})
