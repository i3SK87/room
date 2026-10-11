/**
 * Del revelado a los números que lee la tarjeta gráfica.
 *
 * Aquí está la traducción de cada deslizador —de -100..100 a lo que significa
 * en el color— que no cabe en el shader o que conviene calcular una vez por
 * cambio y no una vez por píxel: el balance de blancos, la matriz de la
 * calibración y el color de cada rueda de gradación.
 */
import { COLORES_MEZCLA, CANALES, curvaEsRecta, type PosRueda, type Revelado } from '@shared/revelado'
import { muestrearCurva } from '@shared/curva'

type Vec3 = [number, number, number]

/* ---------- OKLab en la CPU, el mismo del shader ---------- */

function aOklab([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

function deOklab([L, a, b]: Vec3): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

function aLineal(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** El color puro (HSL al 100 % y 50 %) de un tono, en sRGB lineal. */
function colorDeTono(grados: number): Vec3 {
  const h = (((grados % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const t: Vec3 = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  return t.map(aLineal) as Vec3
}

/* ---------- Balance de blancos ---------- */

/** Ganancia por canal: la temperatura mueve el rojo contra el azul, y el tinte, el verde. */
export function balance(temperatura: number, tinte: number, exposicion: number): Vec3 {
  const t = temperatura / 100
  const k = tinte / 100
  const g: Vec3 = [2 ** (0.5 * t), 2 ** (-0.35 * k), 2 ** (-0.5 * t)]
  // Que el gris no cambie de luminancia: el balance colorea, no ilumina.
  const y = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]
  const e = 2 ** exposicion
  return g.map((v) => (v / y) * e) as Vec3
}

/* ---------- Calibración ---------- */

/**
 * La matriz que mueve los tres primarios: cada columna es adónde va a parar el
 * rojo, el verde o el azul puros tras girarle el tono y cambiarle la
 * saturación. Luego se reescala por filas para que el blanco siga siendo
 * blanco. Es lo que hace la calibración de cámara de Lightroom, en pequeño.
 */
export function matrizCalibracion(r: Revelado): number[] {
  const primarios: Array<[Vec3, number, number]> = [
    [[1, 0, 0], r.calRojoH, r.calRojoS],
    [[0, 1, 0], r.calVerdeH, r.calVerdeS],
    [[0, 0, 1], r.calAzulH, r.calAzulS]
  ]
  const cols = primarios.map(([p, h, s]) => {
    if (h === 0 && s === 0) return p
    const [L, a, b] = aOklab(p)
    const giro = (h / 100) * (25 * Math.PI) / 180
    const escala = 1 + (s / 100) * 0.6
    const na = (a * Math.cos(giro) - b * Math.sin(giro)) * escala
    const nb = (a * Math.sin(giro) + b * Math.cos(giro)) * escala
    // La saturación se mezcla con el gris de su misma luz, para no salirse del todo de gama.
    return deOklab([L, na, nb])
  })
  // m[fila][columna]
  const m = [0, 1, 2].map((f) => [cols[0][f], cols[1][f], cols[2][f]])
  for (let f = 0; f < 3; f++) {
    const suma = m[f][0] + m[f][1] + m[f][2]
    if (Math.abs(suma) > 1e-6) for (let c = 0; c < 3; c++) m[f][c] /= suma
  }
  // WebGL quiere las matrices por columnas.
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]
}

/* ---------- Ruedas de gradación ---------- */

/** El tono que marca un punto de la rueda: 0° arriba (rojo) y girando como las agujas del reloj. */
export function tonoDeRueda(p: PosRueda): number {
  return (((Math.atan2(p.y, p.x) * 180) / Math.PI + 90) % 360 + 360) % 360
}

/** Cuánto empuja la rueda en el plano de color de OKLab. */
export function tinteDeRueda(p: PosRueda): [number, number] {
  const d = Math.min(1, Math.hypot(p.x, p.y))
  if (d < 1e-4) return [0, 0]
  const [, a, b] = aOklab(colorDeTono(tonoDeRueda(p)))
  const n = Math.hypot(a, b) || 1
  return [(a / n) * d * 0.07, (b / n) * d * 0.07]
}

/* ---------- Mezclador ---------- */

/**
 * El centro de cada color del mezclador, en grados del tono de OKLab. Son los
 * de los colores puros de la pantalla, salvo el azul, que se baja un poco hacia
 * el cian para abarcar los cielos.
 */
export const CENTROS_MEZCLA = [29, 62, 105, 142, 195, 255, 292, 328]

export function mezcla(r: Revelado): { h: number[]; s: number[]; l: number[] } {
  return {
    h: COLORES_MEZCLA.map((c) => r.mezcla[c].h / 100),
    s: COLORES_MEZCLA.map((c) => r.mezcla[c].s / 100),
    l: COLORES_MEZCLA.map((c) => r.mezcla[c].l / 100)
  }
}

/* ---------- Curvas ---------- */

export const ANCHO_CURVAS = 1024

/** Las cuatro curvas juntas: R = luz, G = rojo, B = verde, A = azul. */
export function tablaCurvas(r: Revelado): Float32Array | null {
  if (CANALES.every((c) => curvaEsRecta(r.curvas[c]))) return null
  const t = new Float32Array(ANCHO_CURVAS * 4)
  CANALES.forEach((c, k) => {
    const m = muestrearCurva(r.curvas[c], ANCHO_CURVAS)
    for (let i = 0; i < ANCHO_CURVAS; i++) t[i * 4 + k] = m[i]
  })
  return t
}

/* ---------- Tamaños que dependen de la foto ---------- */

/** Radios de desenfoque y grano, como fracción del lado largo. */
export const PROPORCION = {
  fino: 0.0012,
  ancho: 0.02,
  halo: 0.012,
  granoMin: 0.00035,
  granoMax: 0.0018
}
