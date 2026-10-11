/**
 * Los dos motores de revelado y las fotos ya decodificadas.
 *
 * El de la vista vive en el lienzo grande y solo tiene la foto que se está
 * mirando. El de trabajo, en un lienzo que no se ve, hace las miniaturas del
 * carrete y las exportaciones, sin tocar lo que hay en pantalla.
 *
 * Decodificar un HEIC de 24 megapíxeles cuesta un par de segundos, así que las
 * últimas fotos leídas se guardan a mano: cambiar de una a otra y volver no
 * las vuelve a decodificar.
 */
import { Motor, type Fuente } from '../motor/motor'
import type { FotoLeida } from '@shared/tipos'

let vista: Motor | null = null
let trabajo: Motor | null = null

export function ponerMotorVista(m: Motor | null): void {
  vista = m
}

export function motorVista(): Motor | null {
  return vista
}

export function motorTrabajo(): Motor {
  if (!trabajo || trabajo.contextoPerdido) trabajo = new Motor(document.createElement('canvas'))
  return trabajo
}

/* ---------- Fotos decodificadas ---------- */

export interface FotoDecodificada {
  info: Omit<FotoLeida, 'rgba' | 'archivo'>
  fuente: Fuente
}

const CABEN = 3
const recientes = new Map<string, Promise<FotoDecodificada>>()

async function decodificar(ruta: string): Promise<FotoDecodificada> {
  const leida = await window.room.fotos.leer(ruta)
  const { rgba, archivo, ...info } = leida
  if (rgba && leida.ancho && leida.alto) {
    return { info, fuente: { rgba, ancho: leida.ancho, alto: leida.alto, p3: leida.p3 } }
  }
  if (!archivo) throw new Error('La foto ha llegado vacía')
  const tipo = leida.tipo === 'png' ? 'image/png' : 'image/jpeg'
  // El navegador la gira según su EXIF y la pasa a sRGB con su perfil de color.
  const bitmap = await createImageBitmap(new Blob([archivo as BlobPart], { type: tipo }), {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'default'
  })
  return { info: { ...info, ancho: bitmap.width, alto: bitmap.height }, fuente: { bitmap, ancho: bitmap.width, alto: bitmap.height, p3: false } }
}

export function fotoDecodificada(ruta: string): Promise<FotoDecodificada> {
  const clave = ruta.toLowerCase()
  const hay = recientes.get(clave)
  if (hay) {
    // Al final de la cola: es la más reciente.
    recientes.delete(clave)
    recientes.set(clave, hay)
    return hay
  }
  const promesa = decodificar(ruta)
  recientes.set(clave, promesa)
  promesa.catch(() => recientes.delete(clave))
  while (recientes.size > CABEN) {
    const vieja = recientes.keys().next().value as string
    const p = recientes.get(vieja)
    recientes.delete(vieja)
    void p?.then((d) => d.fuente.bitmap?.close()).catch(() => undefined)
  }
  return promesa
}

export function olvidarFoto(ruta: string): void {
  recientes.delete(ruta.toLowerCase())
}

/* ---------- Miniaturas ---------- */

/** La foto revelada en pequeño, como imagen para el carrete: ya recortada. */
export function miniatura(m: Motor, revelado: Parameters<Motor['leer']>[0], lado = 240): string {
  const medidas = m.medidasSalida(revelado)
  if (!medidas) return ''
  const k = lado / Math.max(medidas.ancho, medidas.alto)
  const ancho = Math.max(1, Math.round(medidas.ancho * k))
  const alto = Math.max(1, Math.round(medidas.alto * k))
  const px = m.leer(revelado, ancho, alto, 'mini:')
  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto
  lienzo.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), ancho, alto), 0, 0)
  return lienzo.toDataURL('image/jpeg', 0.85)
}
