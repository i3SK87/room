/**
 * El puente: todo lo que la ventana puede pedirle al proceso principal.
 *
 * Cada canal devuelve `{ ok, data }` o `{ ok: false, error }` con un mensaje
 * pensado para enseñarse tal cual. La ventana no toca el disco: pide, y aquí
 * se hace.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { leerCube } from '@shared/cube'
import { prepararExif } from '@shared/exif'
import type { Revelado } from '@shared/revelado'
import type { Ajustes, Formato } from '@shared/tipos'
import {
  anadirLut,
  borrarGuardado,
  cambiarAjustes,
  existeGuardado,
  guardarAjuste,
  guardarRevelado,
  leerAjustes,
  listaGuardados,
  listaLuts,
  quitarLut,
  renombrarLut,
  rutaLut
} from './datos'
import { exifDe, leerFoto } from './fotos'

type Manejador = (...args: never[]) => unknown

function canal(nombre: string, fn: Manejador): void {
  ipcMain.handle(nombre, async (_e, ...args: unknown[]) => {
    try {
      return { ok: true, data: await (fn as (...a: unknown[]) => unknown)(...args) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

const EXTENSIONES_FOTO = ['heic', 'heif', 'hif', 'jpg', 'jpeg', 'png']

function ventanaDe(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function carpetaPorDefecto(): string {
  return join(app.getPath('pictures'), 'ROOM')
}

/** «IMG_4127.jpg», y si ya existe, «IMG_4127 (2).jpg»: nunca se pisa nada. */
function rutaLibre(carpeta: string, base: string, ext: string): string {
  let ruta = join(carpeta, `${base}.${ext}`)
  for (let n = 2; existsSync(ruta); n++) ruta = join(carpeta, `${base} (${n}).${ext}`)
  return ruta
}

export function registrarIpc(): void {
  /* — Fotos — */
  canal('fotos:elegir', async () => {
    const r = await dialog.showOpenDialog(ventanaDe()!, {
      title: 'Abrir fotos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Fotos (HEIC, JPEG, PNG)', extensions: EXTENSIONES_FOTO },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })
  canal('fotos:leer', (ruta: string) => leerFoto(ruta))
  canal('fotos:recordar', (ruta: string, revelado: Revelado | null) => guardarRevelado(ruta, revelado))
  canal('fotos:mostrar', (ruta: string) => shell.showItemInFolder(ruta))

  /* — Exportar — */
  canal('exportar:carpeta', async (actual: string | null) => {
    const r = await dialog.showOpenDialog(ventanaDe()!, {
      title: 'Carpeta donde dejar las fotos',
      defaultPath: actual ?? carpetaPorDefecto(),
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  canal('exportar:carpetaPorDefecto', () => carpetaPorDefecto())
  canal('exportar:exif', async (ruta: string, ancho: number, alto: number) => {
    const tiff = await exifDe(ruta)
    return tiff ? prepararExif(tiff, ancho, alto) : null
  })
  canal('exportar:escribir', async (carpeta: string, original: string, formato: Formato, datos: Uint8Array) => {
    mkdirSync(carpeta, { recursive: true })
    const base = basename(original, extname(original))
    const ruta = rutaLibre(carpeta, base, formato === 'png' ? 'png' : 'jpg')
    await writeFile(ruta, datos)
    return ruta
  })

  /* — Ajustes guardados — */
  canal('guardados:lista', () => listaGuardados())
  canal('guardados:existe', (nombre: string) => existeGuardado(nombre))
  canal('guardados:guardar', (nombre: string, revelado: Revelado) => guardarAjuste(nombre, revelado))
  canal('guardados:borrar', (id: string) => borrarGuardado(id))

  /* — Biblioteca de LUT — */
  canal('luts:lista', () => listaLuts())
  canal('luts:importar', async () => {
    const r = await dialog.showOpenDialog(ventanaDe()!, {
      title: 'Importar LUT',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'LUT (.cube)', extensions: ['cube'] }]
    })
    if (r.canceled) return { anadidos: [], fallos: [] }
    const anadidos = []
    const fallos: string[] = []
    for (const ruta of r.filePaths) {
      try {
        const texto = await readFile(ruta, 'utf8')
        const lut = leerCube(texto)
        const nombre = basename(ruta, extname(ruta))
        const info = anadirLut(nombre, lut.tamano)
        await writeFile(rutaLut(info.id), texto, 'utf8')
        anadidos.push(info)
      } catch (error) {
        fallos.push(`${basename(ruta)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { anadidos, fallos }
  })
  canal('luts:leer', (id: string) => readFile(rutaLut(id), 'utf8'))
  canal('luts:renombrar', (id: string, nombre: string) => renombrarLut(id, nombre))
  canal('luts:borrar', async (id: string) => {
    quitarLut(id)
    await rm(rutaLut(id), { force: true })
  })
  canal('luts:exportar', async (nombre: string, texto: string) => {
    const r = await dialog.showSaveDialog(ventanaDe()!, {
      title: 'Exportar el revelado como LUT',
      defaultPath: join(app.getPath('documents'), `${nombre.replace(/[\\/:*?"<>|]/g, '_')}.cube`),
      filters: [{ name: 'LUT (.cube)', extensions: ['cube'] }]
    })
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, texto, 'utf8')
    return r.filePath
  })

  /* — Ajustes de la aplicación — */
  canal('ajustes:leer', () => leerAjustes())
  canal('ajustes:cambiar', (cambios: Partial<Ajustes>) => cambiarAjustes(cambios))
}
