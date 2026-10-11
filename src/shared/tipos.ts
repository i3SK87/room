/** Lo que viaja entre la ventana y el proceso principal. */
import type { Revelado } from './revelado'

export type Formato = 'jpeg' | 'png'

/** La foto ya leída del disco, lista para subir a la tarjeta gráfica. */
export interface FotoLeida {
  ruta: string
  nombre: string
  tipo: 'jpeg' | 'png' | 'heic'
  /**
   * HEIC: los píxeles ya decodificados (RGBA, 8 bits, girada como toca).
   * JPEG y PNG: el archivo tal cual, que el navegador sabe decodificar solo.
   */
  rgba?: Uint8Array
  archivo?: Uint8Array
  ancho?: number
  alto?: number
  /** El color viene en Display P3, como las fotos del iPhone: hay que pasarlo a sRGB. */
  p3: boolean
  /** La línea de debajo del título: cámara, focal, diafragma, velocidad, ISO. */
  resumen: string | null
  /** El último revelado que se le hizo a este archivo, si se le hizo alguno. */
  revelado: Revelado | null
}

export interface LutInfo {
  id: string
  nombre: string
  tamano: number
  creado: string
}

export interface Guardado {
  id: string
  nombre: string
  revelado: Revelado
}

export interface Ajustes {
  tema: 'system' | 'light' | 'dark'
  paleta: string
  carpetaExportar: string | null
  formato: Formato
  calidad: number
}

export const AJUSTES_DE_FABRICA: Ajustes = {
  tema: 'dark',
  paleta: 'ghost',
  carpetaExportar: null,
  formato: 'jpeg',
  calidad: 92
}
