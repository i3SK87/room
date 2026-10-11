/**
 * El revelado: todo lo que se le hace a una foto, como datos.
 *
 * Es lo que se guarda por foto, lo que va en un ajuste guardado y lo que lee
 * el motor para pintar. Todo empieza en cero: una foto recién abierta sale
 * tal cual vino del iPhone, y es el revelado el que la mueve.
 *
 * Los deslizadores van de -100 a 100 (o de 0 a 100 los que no tienen
 * sentido al revés), como en Lightroom; la exposición, en pasos de diafragma.
 * El motor traduce cada número a lo que le toca.
 */

import { PROPORCIONES, ANGULO_MAX, geometriaNeutra, type Geometria, type Proporcion } from './geometria'

export const CANALES = ['lum', 'r', 'g', 'b'] as const
export type Canal = (typeof CANALES)[number]

/** Un punto de la curva: `x` lo que entra y `y` lo que sale, los dos de 0 a 1. */
export interface Punto {
  x: number
  y: number
}

/** Dónde está el punto de una rueda de gradación: dentro del círculo de radio 1. */
export interface PosRueda {
  x: number
  y: number
}

export const COLORES_MEZCLA = ['rojo', 'naranja', 'amarillo', 'verde', 'aguamarina', 'azul', 'morado', 'magenta'] as const
export type ColorMezcla = (typeof COLORES_MEZCLA)[number]

export const RUEDAS = ['sombras', 'medios', 'luces'] as const
export type NombreRueda = (typeof RUEDAS)[number]

export interface TonoMezcla {
  h: number
  s: number
  l: number
}

export const MODOS_MANCHA = ['quitar', 'corregir', 'clonar'] as const
export type ModoMancha = (typeof MODOS_MANCHA)[number]

/**
 * Un trazo de Eliminar. Los puntos van en fracciones de la foto tal cual (sin
 * girar, recortar ni corregir el objetivo): así el trazo sigue en su sitio
 * aunque luego se recorte o se enderece.
 */
export interface Mancha {
  id: string
  modo: ModoMancha
  puntos: Punto[]
  /** El diámetro del pincel, en fracción del lado largo de la foto. */
  tamano: number
  desvanecer: number
  opacidad: number
  /** De dónde se copia (Corregir y Clonar), como desplazamiento en fracciones; Quitar no lo usa. */
  fuente: { dx: number; dy: number } | null
}

export const TAMANO_MANCHA = { min: 0.003, max: 0.15 }

export interface Revelado {
  v: 1
  // Básicos
  exposicion: number
  contraste: number
  luces: number
  sombras: number
  blancos: number
  negros: number
  temperatura: number
  tinte: number
  // Presencia
  textura: number
  claridad: number
  neblina: number
  viveza: number
  saturacion: number
  // Curva de tonos
  curvas: Record<Canal, Punto[]>
  // Mezclador de color
  mezcla: Record<ColorMezcla, TonoMezcla>
  // Gradación de color
  ruedas: Record<NombreRueda, PosRueda>
  lumSombras: number
  lumMedios: number
  lumLuces: number
  fusion: number
  equilibrio: number
  // Calibración
  calSombras: number
  calRojoH: number
  calRojoS: number
  calVerdeH: number
  calVerdeS: number
  calAzulH: number
  calAzulS: number
  // Reducción de ruido
  ruidoL: number
  ruidoLDetalle: number
  ruidoLContraste: number
  ruidoC: number
  ruidoCDetalle: number
  ruidoCSuavidad: number
  // Corrección de lente
  aberracion: boolean
  distorsion: number
  desflecarMorado: number
  desflecarVerde: number
  // Película
  grano: number
  tamanoGrano: number
  asperezaGrano: number
  halo: number
  vineteado: number
  suavizado: number
  // LUT
  lut: string | null
  intensidadLut: number
  // Lo que es de cada foto y no viaja en un ajuste guardado
  geometria: Geometria
  manchas: Mancha[]
}

/** Las claves de los deslizadores sueltos: todo lo que es un número a secas. */
export type ClaveNumero = {
  [K in keyof Revelado]: Revelado[K] extends number ? (K extends 'v' ? never : K) : never
}[keyof Revelado]

export function curvaRecta(): Punto[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ]
}

export function reveladoNeutro(): Revelado {
  const mezcla = {} as Record<ColorMezcla, TonoMezcla>
  for (const c of COLORES_MEZCLA) mezcla[c] = { h: 0, s: 0, l: 0 }
  return {
    v: 1,
    exposicion: 0,
    contraste: 0,
    luces: 0,
    sombras: 0,
    blancos: 0,
    negros: 0,
    temperatura: 0,
    tinte: 0,
    textura: 0,
    claridad: 0,
    neblina: 0,
    viveza: 0,
    saturacion: 0,
    curvas: { lum: curvaRecta(), r: curvaRecta(), g: curvaRecta(), b: curvaRecta() },
    mezcla,
    ruedas: { sombras: { x: 0, y: 0 }, medios: { x: 0, y: 0 }, luces: { x: 0, y: 0 } },
    lumSombras: 0,
    lumMedios: 0,
    lumLuces: 0,
    fusion: 50,
    equilibrio: 0,
    calSombras: 0,
    calRojoH: 0,
    calRojoS: 0,
    calVerdeH: 0,
    calVerdeS: 0,
    calAzulH: 0,
    calAzulS: 0,
    ruidoL: 0,
    ruidoLDetalle: 50,
    ruidoLContraste: 0,
    ruidoC: 0,
    ruidoCDetalle: 50,
    ruidoCSuavidad: 50,
    aberracion: false,
    distorsion: 0,
    desflecarMorado: 0,
    desflecarVerde: 0,
    grano: 0,
    tamanoGrano: 25,
    asperezaGrano: 50,
    halo: 0,
    vineteado: 0,
    suavizado: 0,
    lut: null,
    intensidadLut: 100,
    geometria: geometriaNeutra(),
    manchas: []
  }
}

/** Lo que es de cada foto: el recorte y lo eliminado. Un ajuste guardado no lo lleva ni lo pisa. */
export function sinLoDeLaFoto(r: Revelado): Revelado {
  return { ...r, geometria: geometriaNeutra(), manchas: [] }
}

/** Un ajuste guardado aplicado a una foto: todo, menos su recorte y lo eliminado. */
export function conLoDeLaFoto(guardado: Revelado, foto: Revelado): Revelado {
  return { ...guardado, geometria: foto.geometria, manchas: foto.manchas }
}

/* ---------- Los deslizadores, por secciones ---------- */

export interface DefDeslizador {
  clave: ClaveNumero
  etiqueta: string
  min: number
  max: number
  paso: number
  /** Decimales que se enseñan; sin él, enteros. */
  decimales?: number
  /** Los que van de 0 a 100 no llevan signo delante. */
  sinSigno?: boolean
  sufijo?: string
}

function bi(clave: ClaveNumero, etiqueta: string): DefDeslizador {
  return { clave, etiqueta, min: -100, max: 100, paso: 1 }
}

function uni(clave: ClaveNumero, etiqueta: string, sufijo?: string): DefDeslizador {
  return { clave, etiqueta, min: 0, max: 100, paso: 1, sinSigno: true, sufijo }
}

export const BASICOS: DefDeslizador[] = [
  { clave: 'exposicion', etiqueta: 'Exposición', min: -5, max: 5, paso: 0.05, decimales: 2 },
  bi('contraste', 'Contraste'),
  bi('luces', 'Luces'),
  bi('sombras', 'Sombras'),
  bi('blancos', 'Blancos'),
  bi('negros', 'Negros'),
  bi('temperatura', 'Temperatura'),
  bi('tinte', 'Tinte')
]

export const PRESENCIA: DefDeslizador[] = [
  bi('textura', 'Textura'),
  bi('claridad', 'Claridad'),
  bi('neblina', 'Neblina'),
  bi('viveza', 'Viveza'),
  bi('saturacion', 'Saturación')
]

export const GRADACION: DefDeslizador[] = [
  bi('lumSombras', 'Luminancia de sombras'),
  bi('lumMedios', 'Luminancia de medios'),
  bi('lumLuces', 'Luminancia de luces'),
  uni('fusion', 'Fusión'),
  bi('equilibrio', 'Equilibrio')
]

export const CALIBRACION: DefDeslizador[] = [
  bi('calSombras', 'Tinte de sombras'),
  bi('calRojoH', 'Primario rojo · tono'),
  bi('calRojoS', 'Primario rojo · saturación'),
  bi('calVerdeH', 'Primario verde · tono'),
  bi('calVerdeS', 'Primario verde · saturación'),
  bi('calAzulH', 'Primario azul · tono'),
  bi('calAzulS', 'Primario azul · saturación')
]

export const RUIDO: DefDeslizador[] = [
  uni('ruidoL', 'Luminancia'),
  uni('ruidoLDetalle', 'Detalle'),
  uni('ruidoLContraste', 'Contraste'),
  uni('ruidoC', 'Color'),
  uni('ruidoCDetalle', 'Detalle del color'),
  uni('ruidoCSuavidad', 'Suavidad del color')
]

export const LENTE: DefDeslizador[] = [
  bi('distorsion', 'Distorsión'),
  uni('desflecarMorado', 'Desflecar morado'),
  uni('desflecarVerde', 'Desflecar verde')
]

export const PELICULA: DefDeslizador[] = [
  uni('grano', 'Grano'),
  uni('tamanoGrano', 'Tamaño del grano'),
  uni('asperezaGrano', 'Aspereza del grano'),
  uni('halo', 'Halo'),
  uni('vineteado', 'Viñeteado'),
  uni('suavizado', 'Suavizado')
]

export const INTENSIDAD_LUT: DefDeslizador = uni('intensidadLut', 'Intensidad', ' %')

export const NOMBRES_MEZCLA: Record<ColorMezcla, string> = {
  rojo: 'Rojo',
  naranja: 'Naranja',
  amarillo: 'Amarillo',
  verde: 'Verde',
  aguamarina: 'Aguamarina',
  azul: 'Azul',
  morado: 'Morado',
  magenta: 'Magenta'
}

/** El número como se enseña junto al deslizador: «+0,35», «-12», «80 %». */
export function textoValor(def: DefDeslizador, n: number): string {
  if (def.decimales) return (n > 0 ? '+' : '') + n.toFixed(def.decimales).replace('.', ',')
  const entero = Math.round(n)
  if (def.sinSigno) return `${entero}${def.sufijo ?? ''}`
  return `${entero > 0 ? '+' : ''}${entero}`
}

/* ---------- Comparar y limpiar ---------- */

const NEUTRO = reveladoNeutro()

export function curvaEsRecta(p: Punto[]): boolean {
  return p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 1 && p[1].y === 1
}

/** Si una foto tiene algo hecho: decide el «Revelada» del carrete. */
export function estaTocado(r: Revelado): boolean {
  return JSON.stringify(r) !== JSON.stringify(NEUTRO)
}

export function seccionTocada(r: Revelado, defs: DefDeslizador[]): boolean {
  return defs.some((d) => r[d.clave] !== NEUTRO[d.clave])
}

function num(v: unknown, def: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
}

function puntos(v: unknown): Punto[] {
  if (!Array.isArray(v) || v.length < 2) return curvaRecta()
  const p = v
    .filter((q): q is Punto => !!q && typeof q.x === 'number' && typeof q.y === 'number')
    .map((q) => ({ x: num(q.x, 0, 0, 1), y: num(q.y, 0, 0, 1) }))
    .sort((a, b) => a.x - b.x)
  if (p.length < 2) return curvaRecta()
  p[0].x = 0
  p[p.length - 1].x = 1
  return p
}

/**
 * Lo que llega de fuera —la base de datos, un ajuste guardado de otra
 * versión— se pasa por aquí: lo que falte se pone en neutro y lo que se salga
 * de rango se recorta. Así el motor nunca recibe un NaN.
 */
export function sanear(entrada: unknown): Revelado {
  const r = reveladoNeutro()
  if (!entrada || typeof entrada !== 'object') return r
  const e = entrada as Record<string, unknown>
  for (const d of [...BASICOS, ...PRESENCIA, ...GRADACION, ...CALIBRACION, ...RUIDO, ...LENTE, ...PELICULA, INTENSIDAD_LUT]) {
    r[d.clave] = num(e[d.clave], r[d.clave], d.min, d.max)
  }
  const curvas = (e.curvas ?? {}) as Record<string, unknown>
  for (const c of CANALES) r.curvas[c] = puntos(curvas[c])
  const mezcla = (e.mezcla ?? {}) as Record<string, Partial<TonoMezcla> | undefined>
  for (const c of COLORES_MEZCLA) {
    const t = mezcla[c] ?? {}
    r.mezcla[c] = {
      h: num(t.h, 0, -100, 100),
      s: num(t.s, 0, -100, 100),
      l: num(t.l, 0, -100, 100)
    }
  }
  const ruedas = (e.ruedas ?? {}) as Record<string, Partial<PosRueda> | undefined>
  for (const n of RUEDAS) {
    let x = num(ruedas[n]?.x, 0, -1, 1)
    let y = num(ruedas[n]?.y, 0, -1, 1)
    const m = Math.hypot(x, y)
    if (m > 1) {
      x /= m
      y /= m
    }
    r.ruedas[n] = { x, y }
  }
  r.lut = typeof e.lut === 'string' && e.lut ? e.lut : null
  r.aberracion = e.aberracion === true
  r.geometria = geometria(e.geometria)
  r.manchas = Array.isArray(e.manchas)
    ? e.manchas
        .map(mancha)
        .filter((m): m is Mancha => m !== null)
        .slice(0, MAX_MANCHAS)
    : []
  return r
}

export const MAX_MANCHAS = 200

function geometria(v: unknown): Geometria {
  const g = geometriaNeutra()
  if (!v || typeof v !== 'object') return g
  const e = v as Record<string, unknown>
  const giro = num(e.giro, 0, 0, 3)
  g.giro = Math.round(giro) as Geometria['giro']
  g.voltH = e.voltH === true
  g.voltV = e.voltV === true
  g.angulo = num(e.angulo, 0, -ANGULO_MAX, ANGULO_MAX)
  g.proporcion = PROPORCIONES.includes(e.proporcion as Proporcion) ? (e.proporcion as Proporcion) : 'original'
  g.invertida = e.invertida === true
  const rec = (e.recorte ?? {}) as Record<string, unknown>
  const x = num(rec.x, 0, 0, 1)
  const y = num(rec.y, 0, 0, 1)
  const w = num(rec.w, 1, 0.001, 1 - x)
  const h = num(rec.h, 1, 0.001, 1 - y)
  g.recorte = { x, y, w, h }
  return g
}

function mancha(v: unknown): Mancha | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  const puntos = Array.isArray(e.puntos)
    ? e.puntos
        .filter((q): q is Punto => !!q && typeof q.x === 'number' && typeof q.y === 'number' && Number.isFinite(q.x) && Number.isFinite(q.y))
        .map((q) => ({ x: num(q.x, 0, -0.5, 1.5), y: num(q.y, 0, -0.5, 1.5) }))
        .slice(0, 2000)
    : []
  if (!puntos.length) return null
  const modo = MODOS_MANCHA.includes(e.modo as ModoMancha) ? (e.modo as ModoMancha) : 'quitar'
  const f = e.fuente as Record<string, unknown> | null | undefined
  const fuente =
    modo !== 'quitar' && f && typeof f.dx === 'number' && typeof f.dy === 'number' && Number.isFinite(f.dx) && Number.isFinite(f.dy)
      ? { dx: num(f.dx, 0, -1, 1), dy: num(f.dy, 0, -1, 1) }
      : null
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 40) : Math.random().toString(36).slice(2, 10),
    modo,
    puntos,
    tamano: num(e.tamano, 0.02, TAMANO_MANCHA.min, TAMANO_MANCHA.max),
    desvanecer: num(e.desvanecer, 50, 0, 100),
    opacidad: num(e.opacidad, 100, 0, 100),
    fuente
  }
}
