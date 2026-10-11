/**
 * Leer una foto del disco: el archivo, sus datos de cámara y, si es HEIC,
 * sus píxeles ya decodificados.
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import exifr from 'exifr'
import { exifDeJpeg, leerHeic, tipoDeImagen } from '@shared/exif'
import type { FotoLeida } from '@shared/tipos'
import { leerRevelado } from './datos'

/* ---------- El proceso del HEIC ---------- */

let decodificador: UtilityProcess | null = null
let siguienteId = 1
const pendientes = new Map<number, { ok: (r: { ancho: number; alto: number; rgba: Uint8Array }) => void; mal: (e: Error) => void }>()

function proceso(): UtilityProcess {
  if (decodificador) return decodificador
  const p = utilityProcess.fork(join(__dirname, 'heic.js'), [], { serviceName: 'ROOM · HEIC' })
  p.on('message', (m: { id: number; error?: string; ancho: number; alto: number; rgba: Uint8Array }) => {
    const espera = pendientes.get(m.id)
    if (!espera) return
    pendientes.delete(m.id)
    if (m.error) espera.mal(new Error(m.error))
    else espera.ok({ ancho: m.ancho, alto: m.alto, rgba: m.rgba })
  })
  p.on('exit', () => {
    decodificador = null
    for (const e of pendientes.values()) e.mal(new Error('El decodificador de HEIC se ha cerrado'))
    pendientes.clear()
  })
  decodificador = p
  return p
}

function decodificarHeic(datos: Uint8Array): Promise<{ ancho: number; alto: number; rgba: Uint8Array }> {
  return new Promise((ok, mal) => {
    const id = siguienteId++
    pendientes.set(id, { ok, mal })
    proceso().postMessage({ id, datos })
  })
}

export function pararDecodificador(): void {
  decodificador?.kill()
  decodificador = null
}

/* ---------- Los datos de cámara ---------- */

const decimal = (n: number, d = 1): string => (Number.isInteger(n) ? String(n) : n.toFixed(d).replace('.', ','))

/** «iPhone 15 Pro · 24 mm · ƒ/1,78 · 1/120 s · ISO 80», con lo que haya. */
async function resumenExif(datos: Uint8Array, tiff: Uint8Array | null = null): Promise<string | null> {
  try {
    const campos = {
      pick: ['Make', 'Model', 'FocalLength', 'FocalLengthIn35mmFormat', 'FNumber', 'ExposureTime', 'ISO', 'ISOSpeedRatings']
    }
    // Si exifr no se aclara con el contenedor, el bloque EXIF sacado a mano.
    let e = (await exifr.parse(datos, campos).catch(() => undefined)) as Record<string, unknown> | undefined
    if ((!e || !e.Model) && tiff) e = (await exifr.parse(tiff, campos).catch(() => undefined)) as Record<string, unknown> | undefined
    if (!e) return null
    const partes: string[] = []
    if (typeof e.Model === 'string') partes.push(e.Model.trim())
    const focal = typeof e.FocalLengthIn35mmFormat === 'number' ? e.FocalLengthIn35mmFormat : null
    if (focal) partes.push(`${focal} mm`)
    else if (typeof e.FocalLength === 'number') partes.push(`${decimal(e.FocalLength)} mm`)
    if (typeof e.FNumber === 'number') partes.push(`ƒ/${decimal(e.FNumber, 2)}`)
    if (typeof e.ExposureTime === 'number' && e.ExposureTime > 0) {
      const t = e.ExposureTime
      partes.push(t >= 1 ? `${decimal(t)} s` : `1/${Math.round(1 / t)} s`)
    }
    const iso = typeof e.ISO === 'number' ? e.ISO : Array.isArray(e.ISOSpeedRatings) ? e.ISOSpeedRatings[0] : e.ISOSpeedRatings
    if (typeof iso === 'number') partes.push(`ISO ${iso}`)
    return partes.length ? partes.join(' · ') : null
  } catch {
    return null
  }
}

/* ---------- Leer ---------- */

export async function leerFoto(ruta: string): Promise<FotoLeida> {
  const datos = new Uint8Array(await readFile(ruta))
  const tipo = tipoDeImagen(datos)
  if (!tipo) throw new Error(`«${basename(ruta)}» no es una foto que ROOM sepa abrir (HEIC, JPEG o PNG)`)
  const heic = tipo === 'heic' ? leerHeic(datos) : null
  const resumen = await resumenExif(datos, heic?.exif ?? null)
  const revelado = leerRevelado(ruta)
  const nombre = basename(ruta)

  if (heic) {
    const { p3 } = heic
    const { ancho, alto, rgba } = await decodificarHeic(datos)
    return { ruta, nombre, tipo, rgba, ancho, alto, p3, resumen, revelado }
  }
  // JPEG y PNG los decodifica la ventana, que ya los pasa a sRGB con su perfil.
  return { ruta, nombre, tipo, archivo: datos, p3: false, resumen, revelado }
}

/** El bloque EXIF del original, para meterlo en la exportada. */
export async function exifDe(ruta: string): Promise<Uint8Array | null> {
  try {
    const datos = new Uint8Array(await readFile(ruta))
    const tipo = tipoDeImagen(datos)
    if (tipo === 'jpeg') return exifDeJpeg(datos)
    if (tipo === 'heic') return leerHeic(datos).exif
    return null
  } catch {
    return null
  }
}
