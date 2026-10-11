/**
 * El historial de una foto: los pasos del revelado, cada uno con su nombre,
 * como el panel Historial de Lightroom.
 *
 * Un paso es un estado entero del revelado. Deshacer y rehacer mueven el
 * índice; pinchar un paso lleva a él. Si desde un paso de atrás se cambia
 * algo, los de después se descartan.
 */
import {
  BASICOS,
  CALIBRACION,
  GRADACION,
  INTENSIDAD_LUT,
  LENTE,
  NOMBRES_MEZCLA,
  PELICULA,
  PRESENCIA,
  RUEDAS,
  RUIDO,
  COLORES_MEZCLA,
  textoValor,
  type DefDeslizador,
  type Revelado
} from './revelado'
import { NOMBRES_PROPORCION, geometriaTocada } from './geometria'

export interface Paso {
  revelado: Revelado
  nombre: string
}

export interface Historial {
  pasos: Paso[]
  /** El paso en el que está la foto. */
  indice: number
}

export const MAX_PASOS = 100

const iguales = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export function nuevoHistorial(r: Revelado, nombre = 'Al abrir'): Historial {
  return { pasos: [{ revelado: r, nombre }], indice: 0 }
}

export function actual(h: Historial): Revelado {
  return h.pasos[h.indice].revelado
}

/** Apunta un estado nuevo, si lo es. Los pasos que hubiera por delante se descartan. */
export function anotar(h: Historial, r: Revelado, nombre?: string): boolean {
  const antes = actual(h)
  if (iguales(antes, r)) return false
  h.pasos = h.pasos.slice(0, h.indice + 1)
  h.pasos.push({ revelado: r, nombre: nombre ?? describirCambio(antes, r) })
  // Lleno: se va el más viejo, pero el primero (cómo se abrió) se queda.
  if (h.pasos.length > MAX_PASOS) h.pasos.splice(1, 1)
  h.indice = h.pasos.length - 1
  return true
}

/** Ir a un paso. Devuelve su revelado, o null si no hay tal paso. */
export function irA(h: Historial, i: number): Revelado | null {
  if (i < 0 || i >= h.pasos.length || i === h.indice) return null
  h.indice = i
  return actual(h)
}

/* ---------- El nombre de cada paso ---------- */

const NOMBRES_RUEDA: Record<string, string> = { sombras: 'sombras', medios: 'medios', luces: 'luces' }

/** Los deslizadores con el nombre que llevan en el historial (los de ruido, con su sección delante). */
const DESLIZADORES: Array<[DefDeslizador, string]> = [
  ...[...BASICOS, ...PRESENCIA, ...GRADACION, ...CALIBRACION, ...LENTE, ...PELICULA].map((d): [DefDeslizador, string] => [d, d.etiqueta]),
  ...RUIDO.map((d): [DefDeslizador, string] => [d, `Ruido: ${d.etiqueta.charAt(0).toLowerCase()}${d.etiqueta.slice(1)}`]),
  [INTENSIDAD_LUT, 'Intensidad del LUT']
]

const MODOS: Record<string, string> = { quitar: 'Quitar', corregir: 'Corregir', clonar: 'Clonar' }

function cambioGeometria(a: Revelado, b: Revelado): string {
  const ga = a.geometria
  const gb = b.geometria
  if (!geometriaTocada(gb)) return 'Restablecer recorte'
  if (ga.giro !== gb.giro) return 'Girar'
  if (ga.voltH !== gb.voltH || ga.voltV !== gb.voltV) return 'Voltear'
  if (ga.angulo !== gb.angulo) return `Enderezar ${gb.angulo > 0 ? '+' : ''}${gb.angulo.toFixed(1).replace('.', ',')}°`
  if (ga.proporcion !== gb.proporcion) return `Proporción ${NOMBRES_PROPORCION[gb.proporcion].split(' · ')[0]}`
  if (ga.invertida !== gb.invertida) return 'Tumbar la proporción'
  return 'Recorte'
}

function cambioManchas(a: Revelado, b: Revelado): string {
  const na = a.manchas.length
  const nb = b.manchas.length
  if (nb > na) return `Trazo: ${MODOS[b.manchas[nb - 1].modo]}`
  if (nb === 0 && na > 1) return 'Borrar todos los trazos'
  if (nb < na) return 'Borrar trazo'
  const i = b.manchas.findIndex((m, k) => !iguales(m, a.manchas[k]))
  if (i < 0) return 'Eliminar'
  const ma = a.manchas[i]
  const mb = b.manchas[i]
  if (ma.modo !== mb.modo) return `Trazo a ${MODOS[mb.modo]}`
  if (!iguales(ma.puntos, mb.puntos)) return 'Mover trazo'
  if (!iguales(ma.fuente, mb.fuente)) return 'Cambiar el origen'
  return 'Ajustar trazo'
}

/** «Exposición +2,50», «Recorte», «Trazo: Quitar»… o «Varios ajustes» si cambió más de una cosa. */
export function describirCambio(a: Revelado, b: Revelado): string {
  const cambios: string[] = []
  for (const [d, nombre] of DESLIZADORES) if (a[d.clave] !== b[d.clave]) cambios.push(`${nombre} ${textoValor(d, b[d.clave])}`)
  if (!iguales(a.curvas, b.curvas)) cambios.push('Curva de tonos')
  for (const c of COLORES_MEZCLA) if (!iguales(a.mezcla[c], b.mezcla[c])) cambios.push(`Mezclador: ${NOMBRES_MEZCLA[c].toLowerCase()}`)
  for (const r of RUEDAS) if (!iguales(a.ruedas[r], b.ruedas[r])) cambios.push(`Rueda de ${NOMBRES_RUEDA[r]}`)
  if (a.lut !== b.lut) cambios.push(b.lut ? 'LUT' : 'Sin LUT')
  if (a.aberracion !== b.aberracion) cambios.push(b.aberracion ? 'Quitar la aberración' : 'Dejar la aberración')
  if (!iguales(a.geometria, b.geometria)) cambios.push(cambioGeometria(a, b))
  if (!iguales(a.manchas, b.manchas)) cambios.push(cambioManchas(a, b))
  if (cambios.length === 1) return cambios[0]
  return cambios.length ? 'Varios ajustes' : 'Cambio'
}
