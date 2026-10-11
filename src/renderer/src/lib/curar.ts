/**
 * Eliminar y la aberración, desde la ventana: los píxeles de cada foto, el
 * trabajador que hace los parches, y lo que se calcula una vez por foto.
 */
import { buscarFuente, medirAberracion, reducir, type Imagen, type Parche } from '@shared/curar'
import type { Mancha } from '@shared/revelado'
import type { Fuente } from '../motor/motor'
import type { Peticion, Respuesta } from '../curar/trabajador'
import Trabajador from '../curar/trabajador?worker'

/* ---------- Los píxeles de la foto, en la CPU ---------- */

const pixeles = new WeakMap<Fuente, Imagen>()
const reducidas = new WeakMap<Fuente, Imagen>()
const aberraciones = new WeakMap<Fuente, { rojo: number; azul: number }>()

/** La foto en RGBA de 8 bits, tal como la ve la tarjeta gráfica. */
export function pixelesDe(f: Fuente): Imagen {
  const hay = pixeles.get(f)
  if (hay) return hay
  let datos: Uint8ClampedArray
  if (f.rgba) datos = new Uint8ClampedArray(f.rgba.buffer, f.rgba.byteOffset, f.rgba.byteLength)
  else if (f.bitmap) {
    const lienzo = new OffscreenCanvas(f.ancho, f.alto)
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(f.bitmap, 0, 0)
    datos = ctx.getImageData(0, 0, f.ancho, f.alto).data
  } else throw new Error('La foto no tiene píxeles')
  const img = { ancho: f.ancho, alto: f.alto, datos }
  pixeles.set(f, img)
  return img
}

function reducidaDe(f: Fuente): Imagen {
  let r = reducidas.get(f)
  if (!r) {
    r = reducir(pixelesDe(f), 768)
    reducidas.set(f, r)
  }
  return r
}

/** De dónde copiar un trazo de Corregir o Clonar: la zona de alrededor que más se le parece. */
export function fuenteAutomatica(f: Fuente, m: Pick<Mancha, 'puntos' | 'tamano' | 'desvanecer'>): { dx: number; dy: number } {
  return buscarFuente(reducidaDe(f), m)
}

/** La aberración cromática de esta foto, medida una vez. */
export function aberracionDe(f: Fuente): { rojo: number; azul: number } {
  let a = aberraciones.get(f)
  if (!a) {
    a = medirAberracion(pixelesDe(f))
    aberraciones.set(f, a)
  }
  return a
}

/* ---------- El trabajador ---------- */

let trabajador: Worker | null = null
let siguiente = 1
const esperando = new Map<number, (r: Respuesta) => void>()
/** Las fotos que ya tiene el trabajador (se queda con dos). */
const enviadas: string[] = []

function elTrabajador(): Worker {
  if (!trabajador) {
    trabajador = new Trabajador()
    trabajador.onmessage = (e: MessageEvent<Respuesta>) => {
      const fn = esperando.get(e.data.id)
      esperando.delete(e.data.id)
      fn?.(e.data)
    }
    trabajador.onerror = (e) => {
      // Si se cae, las peticiones pendientes fallan y el siguiente se crea de nuevo.
      for (const fn of esperando.values()) fn({ id: 0, error: e.message || 'El trabajador de Eliminar se ha caído' })
      esperando.clear()
      enviadas.length = 0
      trabajador?.terminate()
      trabajador = null
    }
  }
  return trabajador
}

function enviar(clave: string, f: Fuente): void {
  const img = pixelesDe(f)
  // Se copia: la ventana se queda con la suya.
  elTrabajador().postMessage({
    tipo: 'imagen',
    clave,
    ancho: img.ancho,
    alto: img.alto,
    datos: new Uint8ClampedArray(img.datos)
  } satisfies Peticion)
  const i = enviadas.indexOf(clave)
  if (i >= 0) enviadas.splice(i, 1)
  enviadas.push(clave)
  while (enviadas.length > 2) enviadas.shift()
}

function pedir(clave: string, manchas: Mancha[]): Promise<Respuesta> {
  const id = siguiente++
  return new Promise((ok) => {
    esperando.set(id, ok)
    elTrabajador().postMessage({ tipo: 'curar', id, clave, manchas } satisfies Peticion)
  })
}

/** Los parches de los trazos de una foto, en orden. */
export async function parchesDe(ruta: string, f: Fuente, manchas: Mancha[]): Promise<Parche[]> {
  if (!manchas.length) return []
  const clave = ruta.toLowerCase()
  if (!enviadas.includes(clave)) enviar(clave, f)
  let r = await pedir(clave, manchas)
  if ('sinImagen' in r && r.sinImagen) {
    enviar(clave, f)
    r = await pedir(clave, manchas)
  }
  if ('error' in r) throw new Error(`No se ha podido eliminar: ${r.error}`)
  return r.parches
}

/** Lo que identifica unos trazos: si no cambia, los parches tampoco. */
export function claveManchas(manchas: Mancha[]): string {
  return manchas.length ? JSON.stringify(manchas) : ''
}
