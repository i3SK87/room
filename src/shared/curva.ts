/**
 * La curva de tonos como función.
 *
 * Los puntos se unen con un spline cúbico de Hermite con las pendientes de
 * Fritsch y Carlson: pasa por todos los puntos, es suave y, entre dos puntos
 * que suben, no se pasa de largo ni hace la ola que hace un spline natural.
 * Es lo que hace que subir un punto no hunda el de al lado.
 *
 * La misma función dibuja la curva en el panel y llena la tabla que usa el
 * motor, así que lo que se ve es lo que se aplica.
 */
import type { Punto } from './revelado'

/** Pendientes en cada punto. */
function pendientes(p: Punto[]): number[] {
  const n = p.length
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / Math.max(1e-6, p[i + 1].x - p[i].x))
  const m: number[] = new Array(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    // En un pico o un valle, plana: así no se sale por arriba ni por abajo.
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  return m
}

/** Una función de 0..1 en 0..1 a partir de los puntos, que tienen que venir ordenados por `x`. */
export function funcionCurva(p: Punto[]): (x: number) => number {
  if (p.length < 2) return (x) => x
  const m = pendientes(p)
  return (x: number): number => {
    if (x <= p[0].x) return p[0].y
    if (x >= p[p.length - 1].x) return p[p.length - 1].y
    let i = 0
    while (i < p.length - 2 && x > p[i + 1].x) i++
    const h = p[i + 1].x - p[i].x
    const t = (x - p[i].x) / h
    const t2 = t * t
    const t3 = t2 * t
    const y =
      (2 * t3 - 3 * t2 + 1) * p[i].y +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * p[i + 1].y +
      (t3 - t2) * h * m[i + 1]
    return Math.min(1, Math.max(0, y))
  }
}

/** La tabla de `n` valores que se sube a la tarjeta gráfica. */
export function muestrearCurva(p: Punto[], n = 1024): Float32Array {
  const f = funcionCurva(p)
  const t = new Float32Array(n)
  for (let i = 0; i < n; i++) t[i] = f(i / (n - 1))
  return t
}

/**
 * Pone o mueve un punto respetando a sus vecinos: un punto no adelanta al de
 * al lado, y los extremos solo suben y bajan. Devuelve la lista nueva.
 */
export function moverPunto(p: Punto[], i: number, x: number, y: number): Punto[] {
  const q = p.map((o) => ({ ...o }))
  const ult = q.length - 1
  const sep = 0.01
  const nx = i === 0 ? 0 : i === ult ? 1 : Math.min(q[i + 1].x - sep, Math.max(q[i - 1].x + sep, x))
  q[i] = { x: nx, y: Math.min(1, Math.max(0, y)) }
  return q
}

export const MAX_PUNTOS = 14

/** Añade un punto donde se ha pulsado y devuelve la lista y su posición en ella. */
export function anadirPunto(p: Punto[], x: number, y: number): { puntos: Punto[]; indice: number } | null {
  if (p.length >= MAX_PUNTOS) return null
  if (p.some((o) => Math.abs(o.x - x) < 0.012)) return null
  const q = [...p.map((o) => ({ ...o })), { x, y: Math.min(1, Math.max(0, y)) }].sort((a, b) => a.x - b.x)
  return { puntos: q, indice: q.findIndex((o) => o.x === x) }
}
