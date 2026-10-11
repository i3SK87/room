/**
 * La geometría de una foto: girar de 90 en 90, voltear, enderezar y recortar.
 *
 * Hay tres espacios:
 *   - la FUENTE: la foto tal cual, en coordenadas de 0 a 1 con el origen
 *     arriba a la izquierda;
 *   - el MARCO: la foto ya girada y volteada, en píxeles (W × H). Enderezar la
 *     gira un poco más alrededor de su centro, sin cambiar el marco;
 *   - la SALIDA: lo que queda dentro del recorte, de 0 a 1.
 *
 * Todo lo que va de la salida a la fuente es afín, así que cabe en una matriz
 * que la tarjeta gráfica aplica a cada píxel, y su inversa sirve para pintar
 * encima de la foto (el marco del recorte, los trazos de Eliminar).
 *
 * Como en Lightroom, el recorte no puede salirse de la foto enderezada: al
 * girarla, el recorte encoge lo justo para que no asomen esquinas vacías.
 */

export const PROPORCIONES = ['original', 'libre', '1:1', '4:5', '3:2', '16:9'] as const
export type Proporcion = (typeof PROPORCIONES)[number]

export const NOMBRES_PROPORCION: Record<Proporcion, string> = {
  original: 'Original',
  libre: 'Libre',
  '1:1': '1 : 1 · cuadrada',
  '4:5': '4 : 5',
  '3:2': '3 : 2',
  '16:9': '16 : 9'
}

const MEDIDAS: Partial<Record<Proporcion, [number, number]>> = {
  '1:1': [1, 1],
  '4:5': [4, 5],
  '3:2': [3, 2],
  '16:9': [16, 9]
}

/** Un rectángulo en fracciones del marco. */
export interface Recorte {
  x: number
  y: number
  w: number
  h: number
}

export interface Geometria {
  /** Cuartos de vuelta en el sentido de las agujas del reloj. */
  giro: 0 | 1 | 2 | 3
  voltH: boolean
  voltV: boolean
  /** Enderezar, en grados: positivo gira la foto como las agujas del reloj. */
  angulo: number
  recorte: Recorte
  proporcion: Proporcion
  /** La proporción tumbada: 5 : 4 en vez de 4 : 5. */
  invertida: boolean
}

export const ANGULO_MAX = 45

export function geometriaNeutra(): Geometria {
  return {
    giro: 0,
    voltH: false,
    voltV: false,
    angulo: 0,
    recorte: { x: 0, y: 0, w: 1, h: 1 },
    proporcion: 'original',
    invertida: false
  }
}

export function geometriaTocada(g: Geometria): boolean {
  return JSON.stringify(g) !== JSON.stringify(geometriaNeutra())
}

/** Lo que mide el marco: la foto girada. */
export function marco(giro: number, ancho: number, alto: number): { W: number; H: number } {
  return giro % 2 === 1 ? { W: alto, H: ancho } : { W: ancho, H: alto }
}

/** La proporción en píxeles (ancho / alto), o null si es libre. */
export function razonDe(proporcion: Proporcion, invertida: boolean, W: number, H: number): number | null {
  if (proporcion === 'libre') return null
  const m = MEDIDAS[proporcion]
  const r = m ? m[0] / m[1] : W / H
  return invertida ? 1 / r : r
}

/** «4 : 5», «5 : 4», «Vertical»… lo que pone el botón de tumbar. */
export function textoProporcion(g: Geometria, W: number, H: number): string {
  if (g.proporcion === 'libre') return 'Libre'
  const m = MEDIDAS[g.proporcion]
  if (!m) return (razonDe(g.proporcion, g.invertida, W, H) ?? 1) >= 1 ? 'Horizontal' : 'Vertical'
  return g.invertida ? `${m[1]} : ${m[0]}` : `${m[0]} : ${m[1]}`
}

/* ---------- Matrices afines ---------- */

/** x' = a·x + b·y + c; y' = d·x + e·y + f */
export type Afin = [number, number, number, number, number, number]

export function componer(p: Afin, q: Afin): Afin {
  // Primero q, luego p.
  return [
    p[0] * q[0] + p[1] * q[3],
    p[0] * q[1] + p[1] * q[4],
    p[0] * q[2] + p[1] * q[5] + p[2],
    p[3] * q[0] + p[4] * q[3],
    p[3] * q[1] + p[4] * q[4],
    p[3] * q[2] + p[4] * q[5] + p[5]
  ]
}

export function invertir(m: Afin): Afin {
  const det = m[0] * m[4] - m[1] * m[3]
  const a = m[4] / det
  const b = -m[1] / det
  const d = -m[3] / det
  const e = m[0] / det
  return [a, b, -(a * m[2] + b * m[5]), d, e, -(d * m[2] + e * m[5])]
}

export function aplicar(m: Afin, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
}

/** Del marco en píxeles a la fuente en fracciones: deshace el volteo y el giro. */
function marcoAFuente(g: Geometria, ancho: number, alto: number): Afin {
  const { W, H } = marco(g.giro, ancho, alto)
  const volteo: Afin = [g.voltH ? -1 : 1, 0, g.voltH ? W : 0, 0, g.voltV ? -1 : 1, g.voltV ? H : 0]
  const giros: Record<number, Afin> = {
    0: [1, 0, 0, 0, 1, 0],
    1: [0, 1, 0, -1, 0, alto],
    2: [-1, 0, ancho, 0, -1, alto],
    3: [0, -1, ancho, 1, 0, 0]
  }
  const normal: Afin = [1 / ancho, 0, 0, 0, 1 / alto, 0]
  return componer(normal, componer(giros[g.giro], volteo))
}

/** Lo que se ve en el punto P del marco es el punto Q = R(−θ)·(P − c) + c de la foto. */
function enderezar(angulo: number, W: number, H: number): Afin {
  const t = (-angulo * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const cx = W / 2
  const cy = H / 2
  return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy]
}

/**
 * De la salida (0..1, origen arriba a la izquierda) a la fuente (0..1). Con
 * `recorte` se usa ese en vez del de la geometría: el modo Recortar enseña el
 * marco entero.
 */
export function matrizSalida(g: Geometria, ancho: number, alto: number, recorte: Recorte = g.recorte): Afin {
  const { W, H } = marco(g.giro, ancho, alto)
  const deSalida: Afin = [recorte.w * W, 0, recorte.x * W, 0, recorte.h * H, recorte.y * H]
  return componer(marcoAFuente(g, ancho, alto), componer(enderezar(g.angulo, W, H), deSalida))
}

/** Lo que mide la salida a tamaño completo, en píxeles. */
export function medidasSalida(g: Geometria, ancho: number, alto: number, recorte: Recorte = g.recorte): { ancho: number; alto: number } {
  const { W, H } = marco(g.giro, ancho, alto)
  return {
    ancho: Math.max(1, Math.round(recorte.w * W)),
    alto: Math.max(1, Math.round(recorte.h * H))
  }
}

/* ---------- Que el recorte no se salga de la foto enderezada ---------- */

const HOLGURA = 1e-6

/**
 * La media altura (en píxeles del marco) del mayor recorte de proporción `r`
 * centrado en (cx, cy) que cabe en la foto girada `angulo` grados.
 */
function mediaAlturaMax(r: number, cx: number, cy: number, angulo: number, W: number, H: number): number {
  const t = (angulo * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  // El centro del recorte, visto desde la foto sin girar.
  const dx = cx - W / 2
  const dy = cy - H / 2
  const qx = Math.abs(Math.cos(-t) * dx - Math.sin(-t) * dy)
  const qy = Math.abs(Math.sin(-t) * dx + Math.cos(-t) * dy)
  // Y sin salirse del marco, que con la foto girada es más pequeño que ella por las esquinas.
  const enMarco = Math.min(cy, H - cy, Math.min(cx, W - cx) / r)
  return Math.min((W / 2 - qx) / (r * c + s), (H / 2 - qy) / (r * s + c), enMarco)
}

/** Si las cuatro esquinas del recorte caen dentro de la foto enderezada. */
export function cabe(rec: Recorte, angulo: number, W: number, H: number): boolean {
  if (rec.w <= 0 || rec.h <= 0) return false
  if (rec.x < -HOLGURA || rec.y < -HOLGURA || rec.x + rec.w > 1 + HOLGURA || rec.y + rec.h > 1 + HOLGURA) return false
  const m = enderezar(angulo, W, H)
  for (const [u, v] of [
    [rec.x, rec.y],
    [rec.x + rec.w, rec.y],
    [rec.x, rec.y + rec.h],
    [rec.x + rec.w, rec.y + rec.h]
  ]) {
    const [qx, qy] = aplicar(m, u * W, v * H)
    if (qx < -HOLGURA * W || qy < -HOLGURA * H || qx > W * (1 + HOLGURA) || qy > H * (1 + HOLGURA)) return false
  }
  return true
}

function rectDe(cx: number, cy: number, mediaAlto: number, r: number, W: number, H: number): Recorte {
  const h = (2 * mediaAlto) / H
  const w = (2 * mediaAlto * r) / W
  return { x: cx / W - w / 2, y: cy / H - h / 2, w, h }
}

/** El mayor recorte de proporción `r` (en píxeles) que cabe, centrado en la foto. */
export function mayorRecorte(r: number, angulo: number, W: number, H: number): Recorte {
  const b = mediaAlturaMax(r, W / 2, H / 2, angulo, W, H)
  return rectDe(W / 2, H / 2, Math.max(1, b), r, W, H)
}

/** La proporción en píxeles de un recorte. */
export function razonDeRecorte(rec: Recorte, W: number, H: number): number {
  return (rec.w * W) / (rec.h * H)
}

/** Encoge el recorte alrededor de su centro, sin cambiarle la proporción, hasta que quepa. */
export function encajar(rec: Recorte, angulo: number, W: number, H: number): Recorte {
  if (cabe(rec, angulo, W, H)) return rec
  const r = razonDeRecorte(rec, W, H)
  let cx = (rec.x + rec.w / 2) * W
  let cy = (rec.y + rec.h / 2) * H
  let b = mediaAlturaMax(r, cx, cy, angulo, W, H)
  if (b < 4) {
    // El centro se ha quedado fuera de la foto: se lleva al centro.
    cx = W / 2
    cy = H / 2
    b = mediaAlturaMax(r, cx, cy, angulo, W, H)
  }
  return rectDe(cx, cy, Math.min(b, (rec.h * H) / 2), r, W, H)
}

function igual(a: Recorte, b: Recorte): boolean {
  return Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.w - b.w) < 1e-4 && Math.abs(a.h - b.h) < 1e-4
}

/**
 * Enderezar a `angulo`. Si el recorte era el mayor posible (no se había
 * tocado), sigue siéndolo con el ángulo nuevo, y crece al volver a cero; si se
 * había recortado a mano, solo encoge lo necesario.
 */
export function conAngulo(g: Geometria, angulo: number, ancho: number, alto: number): Geometria {
  const a = Math.max(-ANGULO_MAX, Math.min(ANGULO_MAX, angulo))
  const { W, H } = marco(g.giro, ancho, alto)
  const r = razonDeRecorte(g.recorte, W, H)
  const eraMayor = igual(g.recorte, mayorRecorte(r, g.angulo, W, H))
  return {
    ...g,
    angulo: a,
    recorte: eraMayor ? mayorRecorte(r, a, W, H) : encajar(g.recorte, a, W, H)
  }
}

/** Elegir proporción, o tumbarla: el mayor recorte con ella que quepa, centrado donde estaba. */
export function conProporcion(g: Geometria, proporcion: Proporcion, invertida: boolean, ancho: number, alto: number): Geometria {
  const { W, H } = marco(g.giro, ancho, alto)
  const r = razonDe(proporcion, invertida, W, H)
  const n = { ...g, proporcion, invertida }
  if (r === null) return n
  const cx = (g.recorte.x + g.recorte.w / 2) * W
  const cy = (g.recorte.y + g.recorte.h / 2) * H
  const b = mediaAlturaMax(r, cx, cy, g.angulo, W, H)
  const centrado = mayorRecorte(r, g.angulo, W, H)
  // Si centrado donde estaba no cabe uno que valga la pena, al centro de la foto.
  const rec = b > 0 && (2 * b) / H >= centrado.h * 0.6 ? rectDe(cx, cy, b, r, W, H) : centrado
  return { ...n, recorte: rec }
}

/** Girar de 90 en 90: el recorte vuelve a ser el mayor posible. */
export function conGiro(g: Geometria, paso: 1 | -1, ancho: number, alto: number): Geometria {
  const giro = ((((g.giro + paso) % 4) + 4) % 4) as Geometria['giro']
  const { W, H } = marco(giro, ancho, alto)
  const r = razonDe(g.proporcion, g.invertida, W, H) ?? razonDeRecorte(g.recorte, H, W) ** -1
  return { ...g, giro, recorte: mayorRecorte(r, g.angulo, W, H) }
}

/** Voltear no cambia el recorte de sitio: lo que se ve, se ve en espejo. */
export function conVolteo(g: Geometria, eje: 'h' | 'v'): Geometria {
  return eje === 'h' ? { ...g, voltH: !g.voltH } : { ...g, voltV: !g.voltV }
}

export interface Bordes {
  l: boolean
  r: boolean
  t: boolean
  b: boolean
}

/**
 * El recorte con sus bordes llevados a (px, py), en fracciones del marco.
 * Con proporción fija, una esquina manda el ancho; un borde suelto, su
 * dimensión, y la otra crece por igual a los dos lados. Null si no queda
 * un recorte que valga.
 */
export function redimensionar(c0: Recorte, b: Bordes, px: number, py: number, r: number | null, W: number, H: number): Recorte | null {
  const min = 24 / Math.max(W, H)
  let x1 = c0.x
  let y1 = c0.y
  let x2 = c0.x + c0.w
  let y2 = c0.y + c0.h
  if (b.l) x1 = Math.min(px, x2 - min)
  if (b.r) x2 = Math.max(px, x1 + min)
  if (b.t) y1 = Math.min(py, y2 - min)
  if (b.b) y2 = Math.max(py, y1 + min)
  if (r) {
    const A = W / H
    if (b.l || b.r) {
      const h = ((x2 - x1) * A) / r
      if (b.t) y1 = y2 - h
      else if (b.b) y2 = y1 + h
      else {
        const cy = c0.y + c0.h / 2
        y1 = cy - h / 2
        y2 = cy + h / 2
      }
    } else {
      const w = ((y2 - y1) * r) / A
      const cx = c0.x + c0.w / 2
      x1 = cx - w / 2
      x2 = cx + w / 2
    }
  }
  if (x2 - x1 <= 0 || y2 - y1 <= 0) return null
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/**
 * Lleva el recorte hacia `objetivo` todo lo que se pueda sin salirse de la
 * foto: si el objetivo no cabe, se busca el punto del camino donde deja de
 * caber. `hacia(t)` da el recorte a una fracción t del camino.
 */
export function hastaDondeQuepa(hacia: (t: number) => Recorte | null, angulo: number, W: number, H: number): Recorte | null {
  const fin = hacia(1)
  if (fin && cabe(fin, angulo, W, H)) return fin
  let bien = 0
  let mal = 1
  for (let i = 0; i < 14; i++) {
    const t = (bien + mal) / 2
    const r = hacia(t)
    if (r && cabe(r, angulo, W, H)) bien = t
    else mal = t
  }
  return bien > 0 ? hacia(bien) : null
}

/* ---------- La distorsión del objetivo ---------- */

/**
 * La corrección de distorsión manual, como la de Lightroom: positivo
 * corrige el barril (las rectas que se curvan hacia fuera). Para cada punto
 * corregido `p` da dónde mirar en la foto. Con negativo, se amplía lo justo
 * para que no asomen esquinas vacías.
 */
export function factorDistorsion(distorsion: number): { k: number; escala: number } {
  const k = (distorsion / 100) * 0.18
  return { k, escala: k < 0 ? 1 / (1 - k) : 1 }
}

export function distorsionar(u: number, v: number, distorsion: number, ancho: number, alto: number): [number, number] {
  if (!distorsion) return [u, v]
  const { k, escala } = factorDistorsion(distorsion)
  const mitadDiag = Math.hypot(ancho, alto) / 2
  const qx = ((u - 0.5) * ancho) / mitadDiag
  const qy = ((v - 0.5) * alto) / mitadDiag
  const f = (1 - k * (qx * qx + qy * qy)) * escala
  return [0.5 + (u - 0.5) * f, 0.5 + (v - 0.5) * f]
}

/** La inversa, por aproximaciones: de un punto de la foto, dónde se ve una vez corregida. */
export function desdistorsionar(su: number, sv: number, distorsion: number, ancho: number, alto: number): [number, number] {
  if (!distorsion) return [su, sv]
  let u = su
  let v = sv
  for (let i = 0; i < 12; i++) {
    const [du, dv] = distorsionar(u, v, distorsion, ancho, alto)
    u += su - du
    v += sv - dv
  }
  return [u, v]
}
