/**
 * Arranca las pruebas del motor en una ventana de Electron que no se ve, y de
 * paso prueba el decodificador de HEIC en su proceso aparte, como lo usa ROOM.
 *
 *   npm run prueba:motor            (MUESTRAS=carpeta con fotos HEIC, opcional)
 */
const { app, BrowserWindow, utilityProcess } = require('electron')
const { existsSync, readFileSync, readdirSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

app.setPath('userData', mkdtempSync(join(tmpdir(), 'room-prueba-')))

async function heic() {
  const carpeta = process.env.MUESTRAS
  if (!carpeta || !existsSync(carpeta)) return 'HEIC: sin MUESTRAS, no se prueba'
  const p = utilityProcess.fork(join(__dirname, '../../out/main/heic.js'))
  const lineas = ['Decodificador de HEIC (proceso aparte)']
  let id = 1
  for (const nombre of readdirSync(carpeta).filter((n) => /\.heic$/i.test(n))) {
    const datos = new Uint8Array(readFileSync(join(carpeta, nombre)))
    const t0 = Date.now()
    const r = await new Promise((ok) => {
      const mio = id++
      const escuchar = (m) => {
        if (m.id !== mio) return
        p.removeListener('message', escuchar)
        ok(m)
      }
      p.on('message', escuchar)
      p.postMessage({ id: mio, datos })
    })
    if (r.error) lineas.push(`  ✗ ${nombre}: ${r.error}`)
    else {
      const bien = r.rgba.length === r.ancho * r.alto * 4 && r.rgba.some((v) => v > 0)
      lineas.push(`  ${bien ? '✓' : '✗'} ${nombre}: ${r.ancho}×${r.alto} en ${Date.now() - t0} ms`)
    }
  }
  p.kill()
  return lineas.join('\n')
}

app.whenReady().then(async () => {
  let codigo = 0
  try {
    console.log(await heic())
    const w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { backgroundThrottling: false } })
    await w.loadFile(join(__dirname, 'pagina.html'))
    const informe = await w.webContents.executeJavaScript('window.ejecutar()')
    console.log(informe)
    if (!/\n(\d+) de \1 comprobaciones bien$/.test(informe)) codigo = 1
    const exportacion = await w.webContents.executeJavaScript('window.exportacion()')
    console.log(exportacion)
    if (exportacion.includes('HAY FALLOS')) codigo = 1
  } catch (e) {
    console.error(e)
    codigo = 1
  }
  app.exit(codigo)
})
