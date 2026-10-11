/**
 * Recorrer ROOM entera con el ratón y el teclado, midiendo cómo va.
 *
 * La aplicación compilada de verdad (IPC, base de datos y trabajador), en una
 * ventana fuera de pantalla con userData temporal. En cada paso se apuntan
 * los fotogramas (cuánto tarda la ventana en pintar mientras se arrastra), las
 * tareas largas que congelan la ventana y cualquier error.
 *
 *   MUESTRAS=… SALIDA=… npx electron test/arnes/explorar.cjs
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

// VISIBLE=1: una ventana normal en el escritorio, con la pantalla y la composición de verdad.
const visible = process.env.VISIBLE === '1'
if (!visible) app.commandLine.appendSwitch('force-device-scale-factor', '1.5')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'room-explorar-')))
const raiz = join(__dirname, '../..')
copyFileSync(join(raiz, 'out/main/heic.js'), join(raiz, 'out/test/heic.js'))
const { registrarIpc } = require(join(raiz, 'out/test/arnes.cjs'))

const muestras = process.env.MUESTRAS
const salida = process.env.SALIDA
mkdirSync(salida, { recursive: true })
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const VIGIA = `(() => {
  if (window.__vigia) return
  const v = (window.__vigia = { marcos: [], largas: [], errores: [], gpu: [] })
  let ultimo = performance.now()
  // Leer un píxel obliga a esperar a que la tarjeta gráfica acabe: lo que tarda es lo que le costó pintar.
  const bucle = (t) => {
    v.marcos.push(t - ultimo); ultimo = t
    const c = document.querySelector('.visor-foto canvas'); const gl = c && c.getContext('webgl2')
    if (gl) { const t0 = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); v.gpu.push(performance.now() - t0) }
    requestAnimationFrame(bucle)
  }
  requestAnimationFrame(bucle)
  new PerformanceObserver((l) => { for (const e of l.getEntries()) v.largas.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: false })
  addEventListener('error', (e) => v.errores.push(String(e.message)))
  addEventListener('unhandledrejection', (e) => v.errores.push('promesa: ' + String(e.reason && e.reason.message || e.reason)))
})()`

app.whenReady().then(async () => {
  registrarIpc()
  const w = new BrowserWindow({
    show: visible,
    // Como la pantalla de verdad: 4K al 150 % (2560 × 1440 de interfaz, 1,5 píxeles por punto).
    width: 2560,
    height: 1380,
    webPreferences: { preload: join(raiz, 'out/preload/index.js'), offscreen: !visible, backgroundThrottling: false, sandbox: false }
  })
  if (!visible) w.webContents.setFrameRate(60)
  else {
    w.setBounds({ x: 40, y: 40, width: 1900, height: 1300 })
    w.show()
  }
  let ultima = null
  w.webContents.on('paint', (_e, _d, imagen) => {
    if (!imagen.isEmpty()) ultima = imagen
  })
  const consola = []
  w.webContents.on('console-message', (e) => {
    const m = String(e.message ?? e)
    if (e.level === 'error' || e.level === 3 || /error|warn/i.test(m)) consola.push(m.slice(0, 300))
  })
  await w.loadFile(join(raiz, 'out/renderer/index.html'))
  await espera(1000)

  const js = (codigo) => w.webContents.executeJavaScript(codigo)
  const foto = async (n) => writeFileSync(join(salida, `${n}.png`), (visible ? await w.webContents.capturePage() : ultima).toPNG())
  const tecla = async (k, modifiers = []) => {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers })
    if (!modifiers.includes('control')) w.webContents.sendInputEvent({ type: 'char', keyCode: k, modifiers })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers })
    await espera(400)
  }
  const raton = (type, x, y, extra = {}) =>
    w.webContents.sendInputEvent({
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: extra.button ?? 'left',
      clickCount: 1,
      modifiers: extra.modifiers ?? (type === 'mouseMove' && extra.pulsado !== false ? ['leftButtonDown'] : [])
    })
  /** Un arrastre de verdad: a 60 movimientos por segundo. */
  const arrastrar = async (x0, y0, x1, y1, pasos = 30) => {
    raton('mouseDown', x0, y0)
    for (let i = 1; i <= pasos; i++) {
      raton('mouseMove', x0 + ((x1 - x0) * i) / pasos, y0 + ((y1 - y0) * i) / pasos)
      await espera(16)
    }
    raton('mouseUp', x1, y1)
  }
  const clic = async (x, y) => {
    raton('mouseDown', x, y)
    raton('mouseUp', x, y)
    await espera(300)
  }
  const caja = (sel) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
  const pie = () => js('(document.querySelector(".visor-pie") || {}).textContent || ""')
  const texto = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ""`)

  const informe = []
  /** Mide un paso: fotogramas, tareas largas y errores mientras se hace. */
  const medir = async (nombre, fn, despues = 800) => {
    await js(VIGIA)
    await js('window.__vigia.marcos.length = 0; window.__vigia.largas.length = 0; window.__vigia.errores.length = 0; window.__vigia.gpu.length = 0')
    const t0 = Date.now()
    const extra = await fn()
    await espera(despues)
    const v = await js('JSON.parse(JSON.stringify(window.__vigia))')
    const m = v.marcos.slice(1).sort((a, b) => a - b)
    const p = (q) => (m.length ? m[Math.min(m.length - 1, Math.floor(q * m.length))].toFixed(0) : '-')
    const g = v.gpu.slice(1).sort((a, b) => a - b)
    const pg = (q) => (g.length ? g[Math.min(g.length - 1, Math.floor(q * g.length))].toFixed(1) : '-')
    const dpr = await js('devicePixelRatio')
    const lienzo = await js('(() => { const c = document.querySelector(".visor-foto canvas"); return c ? c.width + "×" + c.height : "" })()')
    const linea = `${nombre} [${lienzo} @${dpr}]: ${Date.now() - t0} ms · fotogramas ${m.length} (p50 ${p(0.5)} ms, p95 ${p(0.95)}, máx ${p(1)}) · gráfica p50 ${pg(0.5)} p95 ${pg(0.95)} máx ${pg(1)} ms · largas ${v.largas.length ? v.largas.join('+') + ' ms' : 'ninguna'}${v.errores.length ? ' · ERRORES ' + v.errores.join(' | ') : ''}${extra ? ' · ' + extra : ''}`
    informe.push(linea)
    console.log(linea)
  }

  /** Arrastra un deslizador del panel, por su etiqueta, de la posición `de` a `a` (0..1). */
  const deslizar = async (etiqueta, de, a) => {
    const r = await js(`(() => {
      const l = [...document.querySelectorAll('.panel label')].find((x) => x.textContent.trim() === ${JSON.stringify(etiqueta)})
      if (!l) return null
      const i = document.getElementById(l.htmlFor)
      i.scrollIntoView({ block: 'center' })
      const r = i.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    })()`)
    if (!r) return `NO ENCONTRADO ${etiqueta}`
    await espera(200)
    const y = r.y + r.h / 2
    await arrastrar(r.x + 8 + (r.w - 16) * de, y, r.x + 8 + (r.w - 16) * a, y, 40)
    const v = await js(`(() => { const l = [...document.querySelectorAll('.panel label')].find((x) => x.textContent.trim() === ${JSON.stringify(etiqueta)}); return l.closest('.control').querySelector('.control-valor').textContent })()`)
    return `valor ${v}`
  }
  const abrirSeccion = (titulo) =>
    js(`(() => { const b = [...document.querySelectorAll('.seccion-cabecera')].find((x) => x.querySelector('.seccion-titulo').textContent === ${JSON.stringify(titulo)}); if (b && b.getAttribute('aria-expanded') !== 'true') b.click() })()`)

  const fotos = ['grande.jpg', 'iphone.heic', 'example.heic'].map((n) => join(muestras, n)).filter(existsSync)

  await medir('abrir 3 fotos (la primera de 15 MP)', async () => {
    w.webContents.send('fotos:abrir', fotos)
    for (let i = 0; i < 60; i++) {
      await espera(250)
      const listo = await js('!document.querySelector(".visor-cargando") && document.querySelector(".visor-foto").style.visibility === "visible"')
      if (listo) return `lista en ${(i + 1) * 250} ms`
    }
    return 'NO SE HA ABIERTO'
  }, 3000)
  await foto('01-abierta')

  await medir('Exposición, arrastrando', () => deslizar('Exposición', 0.5, 0.75))
  await medir('Contraste, arrastrando', () => deslizar('Contraste', 0.5, 0.9))
  await abrirSeccion('Película')
  await medir('Grano, arrastrando', () => deslizar('Grano', 0, 0.6))
  await medir('Halo, arrastrando', () => deslizar('Halo', 0, 0.5))
  await abrirSeccion('Presencia')
  await medir('Claridad, arrastrando', () => deslizar('Claridad', 0.5, 0.8))
  await abrirSeccion('Reducción de ruido')
  await medir('Ruido · Luminancia, arrastrando', () => deslizar('Luminancia', 0, 0.6))
  await medir('Ruido · Color, arrastrando', () => deslizar('Color', 0, 0.5))
  await abrirSeccion('Corrección de lente')
  await medir('Aberración: marcar la casilla', async () => {
    await js(`[...document.querySelectorAll('.panel .checkbox')].find((x) => x.textContent.includes('aberración')).querySelector('input').click()`)
  }, 2000)
  await medir('Distorsión, arrastrando', () => deslizar('Distorsión', 0.5, 0.7))
  await foto('02-revelada')

  await medir('Deshacer ×5 (Ctrl+Z)', async () => {
    for (let i = 0; i < 5; i++) await tecla('Z', ['control'])
    return `Distorsión ${await texto('.panel .control:has(#ctl-distorsion-Distorsión) .control-valor')}`
  })
  await medir('Rehacer ×5 (Ctrl+Y)', async () => {
    for (let i = 0; i < 5; i++) await tecla('Y', ['control'])
  })

  // Historial
  const pasos = () => js(`[...document.querySelectorAll('.historial-paso')].map((b) => (b.classList.contains('actual') ? '▶' : b.classList.contains('futuro') ? '·' : '') + b.textContent).join(' | ')`)
  await medir('Historial: los pasos', pasos)
  await medir('Historial: pinchar «Contraste»', async () => {
    await js(`[...document.querySelectorAll('.historial-paso')].find((b) => b.textContent.startsWith('Contraste')).click()`)
    await espera(400)
    return `Exposición ${await texto('.panel .control:has(#ctl-exposicion-Exposición) .control-valor')} · Grano ${await js(`(() => { const l = [...document.querySelectorAll('.panel label')].find((x) => x.textContent.trim() === 'Grano'); return l.closest('.control').querySelector('.control-valor').textContent })()`)} · ${(await pasos()).slice(0, 160)}`
  })
  await foto('02b-historial')
  await medir('Historial: Ctrl+Y vuelve al siguiente', async () => {
    await tecla('Y', ['control'])
    return (await pasos()).slice(0, 120)
  })
  await medir('Historial: volver al último', async () => {
    await js(`document.querySelector('.historial-paso').click()`)
    await espera(300)
    return (await pasos()).slice(0, 80)
  })

  // Zoom
  let v = await caja('.visor-foto')
  await medir('Zoom: clic al 100 %', async () => {
    await clic(v.x + v.w * 0.6, v.y + v.h * 0.4)
    await espera(500)
    return await pie()
  })
  await foto('03-zoom')
  v = await caja('.visor-foto')
  await medir('Zoom: moverse arrastrando', () => arrastrar(v.x + 400, v.y + 400, v.x + 150, v.y + 250, 40))
  await medir('Zoom: Ctrl+ y Ctrl−', async () => {
    await tecla('=', ['control'])
    const a = await pie()
    await tecla('-', ['control'])
    await tecla('-', ['control'])
    return `${a.split('·')[0]}→ ${(await pie()).split('·')[0]}`
  })
  await tecla('Z')

  // Recortar
  await medir('Recortar: abrir (R)', async () => {
    await tecla('R')
    return await pie()
  })
  v = await caja('.visor-foto')
  await medir('Recortar: esquina', () => arrastrar(v.x + v.w - 3, v.y + v.h - 3, v.x + v.w * 0.7, v.y + v.h * 0.75, 40))
  await medir('Recortar: mover el marco', () => arrastrar(v.x + v.w * 0.3, v.y + v.h * 0.3, v.x + v.w * 0.45, v.y + v.h * 0.4, 30))
  v = await caja('.visor-foto')
  await medir('Recortar: enderezar por fuera', () => arrastrar(v.x - 12, v.y + v.h * 0.5, v.x - 12, v.y + v.h * 0.8, 40))
  await medir('Recortar: deslizador Enderezar', () => deslizar('Enderezar', 0.4, 0.6))
  await medir('Recortar: proporción 1:1 y tumbar 4:5', async () => {
    await js(`(() => { const s = document.getElementById('recortar-proporcion'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '4:5'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await espera(300)
    await tecla('X')
  })
  await medir('Recortar: girar a la derecha', () => js(`document.querySelector('[aria-label="Girar a la derecha"]').click()`))
  await foto('04-recortando')
  await medir('Recortar: Listo (R)', () => tecla('R'))
  await foto('05-recortada')

  // Eliminar
  await medir('Eliminar: abrir (Q)', () => tecla('Q'))
  v = await caja('.visor-foto')
  await medir('Eliminar: pintar un trazo (Quitar)', async () => {
    await arrastrar(v.x + v.w * 0.3, v.y + v.h * 0.3, v.x + v.w * 0.45, v.y + v.h * 0.4, 40)
    const t0 = Date.now()
    for (let i = 0; i < 80; i++) {
      await espera(100)
      if (!(await pie()).includes('Rellenando')) return `relleno en ${Date.now() - t0} ms`
    }
    return 'SIGUE RELLENANDO'
  })
  await foto('06-quitado')
  await medir('Eliminar: Corregir y pintar', async () => {
    await js(`[...document.querySelectorAll('.panel-herramienta .segmented button')].find((b) => b.textContent === 'Corregir').click()`)
    await espera(200)
    await arrastrar(v.x + v.w * 0.6, v.y + v.h * 0.6, v.x + v.w * 0.62, v.y + v.h * 0.66, 15)
    const t0 = Date.now()
    for (let i = 0; i < 80; i++) {
      await espera(100)
      if (!(await pie()).includes('Rellenando')) return `relleno en ${Date.now() - t0} ms`
    }
    return 'SIGUE RELLENANDO'
  })
  const hastaRellenar = async () => {
    const t0 = Date.now()
    for (let i = 0; i < 150; i++) {
      if (!(await pie()).includes('Rellenando')) return `relleno ${Date.now() - t0} ms después de soltar`
      await espera(50)
    }
    return 'SIGUE RELLENANDO'
  }
  await medir('Eliminar: Tamaño con un trazo elegido', async () => `${await deslizar('Tamaño', 0.5, 0.7)} · ${await hastaRellenar()}`, 300)
  await medir('Eliminar: Z con el foco en el deslizador', async () => {
    await tecla('Z')
    const p = (await pie()).split('·')[0]
    await tecla('Z')
    return p
  })
  await medir('Eliminar: Z y pintar ampliado', async () => {
    await tecla('Z')
    v = await caja('.visor-foto')
    await arrastrar(v.x + v.w * 0.5, v.y + v.h * 0.5, v.x + v.w * 0.55, v.y + v.h * 0.55, 15)
    await espera(1500)
    return await pie()
  })
  await foto('07-eliminar-ampliado')
  await medir('Eliminar: clic derecho y borrar', async () => {
    await espera(300)
    raton('mouseDown', v.x + v.w * 0.52, v.y + v.h * 0.52, { button: 'right' })
    raton('mouseUp', v.x + v.w * 0.52, v.y + v.h * 0.52, { button: 'right' })
    await espera(400)
    const hay = await js(`[...document.querySelectorAll('[role=menuitem], .menu-contextual button')].map((b) => b.textContent).join(',')`)
    await js(`(() => { const b = [...document.querySelectorAll('[role=menuitem], .menu-contextual button')].find((x) => x.textContent.includes('Borrar')); b && b.click() })()`)
    await espera(500)
    return `menú: ${hay || 'NO HAY'} · ${await texto('.panel-herramienta-pie .small')}`
  }, 2000)
  await tecla('Z')
  await tecla('Q')

  await medir('Eliminar: deshacer un trazo mientras se rellena', async () => {
    await tecla('Q')
    v = await caja('.visor-foto')
    const antes = await texto('.panel-herramienta-pie .small')
    await arrastrar(v.x + v.w * 0.2, v.y + v.h * 0.7, v.x + v.w * 0.4, v.y + v.h * 0.8, 20)
    await espera(50)
    await tecla('Z', ['control'])
    await espera(300)
    return `${antes} → ${await texto('.panel-herramienta-pie .small')} · ${await hastaRellenar()}`
  })
  await medir('Eliminar: cambiar de foto mientras se rellena', async () => {
    v = await caja('.visor-foto')
    await arrastrar(v.x + v.w * 0.2, v.y + v.h * 0.7, v.x + v.w * 0.4, v.y + v.h * 0.8, 20)
    await espera(50)
    await js(`document.querySelectorAll('.carrete-item')[1].click()`)
    await espera(2500)
    await js(`document.querySelectorAll('.carrete-item')[0].click()`)
    await espera(500)
    return `${await texto('.panel-herramienta-pie .small')} · ${await hastaRellenar()}`
  }, 1500)
  await foto('07b-tras-cambiar')
  await tecla('Q')
  await medir('Antes con la foto ampliada', async () => {
    v = await caja('.visor-foto')
    await clic(v.x + v.w * 0.5, v.y + v.h * 0.5)
    await espera(400)
    v = await caja('.visor-foto')
    raton('mouseDown', v.x + 200, v.y + 200)
    await espera(500)
    const p = await pie()
    await foto('07c-antes-ampliada')
    raton('mouseUp', v.x + 200, v.y + 200)
    await espera(300)
    const p2 = (await pie()).split('·')[0]
    await tecla('Z')
    return `${p} → ${p2}`
  })

  // Cambiar de foto y volver
  await medir('Cambiar de foto y volver', async () => {
    await js(`document.querySelectorAll('.carrete-item')[1].click()`)
    await espera(2500)
    await js(`document.querySelectorAll('.carrete-item')[0].click()`)
    await espera(2500)
  })
  await foto('08-vuelta')

  await medir('Restablecer todo', () => js(`[...document.querySelectorAll('.panel-pie .btn')].find((b) => b.textContent.includes('Restablecer')).click()`))
  await medir('Deshacer el restablecer', () => tecla('Z', ['control']))
  await foto('09-final')

  informe.push('', 'Consola:', ...consola.slice(0, 40))
  writeFileSync(join(salida, 'informe.txt'), informe.join('\n'))
  console.log('\nConsola:\n' + consola.slice(0, 40).join('\n'))
  app.exit(0)
})
