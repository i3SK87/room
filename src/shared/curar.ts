/**
 * Eliminar, en la CPU: lo que hace cada trazo con los píxeles de la foto.
 *
 *   - Clonar copia otra zona tal cual.
 *   - Corregir copia otra zona y la funde: le suma la diferencia de luz y de
 *     color que hay en el borde del trazo, repartida por dentro, para que no
 *     se note la costura.
 *   - Quitar no copia de ningún sitio: rellena el hueco con trozos de lo que
 *     tiene alrededor (PatchMatch a varias escalas, como el «relleno según el
 *     contenido» de toda la vida). Todo aquí, sin IA ni nada que salga del
 *     ordenador.
 *
 * Cada trazo da un parche —un rectángulo de píxeles ya arreglado— que se pega
 * encima de la foto. Los trazos van en orden: uno puede tapar lo que dejó otro.
 *
 * Todo es determinista: con la misma foto y los mismos trazos sale lo mismo,
 * así que lo que se exporta es lo que se vio.
 */
import type { Mancha } from './revelado'

export interface Imagen {
  ancho: number
  alto: number
  /** RGBA de 8 bits, la fila de arriba primero. */
  datos: Uint8ClampedArray
}

export interface Parche {
  x: number
  y: number
  ancho: number
  alto: number
  datos: Uint8ClampedArray
}

/* ---------- La máscara de un trazo ---------- */

export interface Mascara {
  x: number
  y: number
  ancho: number
  alto: number
  /** Cuánto se aplica en cada píxel, de 0 a 1 (sin la opacidad). */
  alfa: Float32Array
}

/** El radio del pincel en píxeles. */
export function radioPx(m: Pick<Mancha, 'tamano'>, ancho: number, alto: number): number {
  return Math.max(1, (m.tamano * Math.max(ancho, alto)) / 2)
}

/**
 * La máscara de un trazo: todo lo que queda a menos de un radio de la línea.
 * Desvanecer suaviza el borde hacia dentro: a 0 el borde es duro y a 100 se
 * difumina desde el centro.
 */
export function mascara(
  m: Pick<Mancha, 'puntos' | 'tamano' | 'desvanecer'>,
  ancho: number,
  alto: number,
  desplazamiento = { dx: 0, dy: 0 }
): Mascara | null {
  const R = radioPx(m, ancho, alto)
  const pts = m.puntos.map((p) => ({
    x: (p.x + desplazamiento.dx) * ancho,
    y: (p.y + desplazamiento.dy) * alto
  }))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x - R)
    y0 = Math.min(y0, p.y - R)
    x1 = Math.max(x1, p.x + R)
    y1 = Math.max(y1, p.y + R)
  }
  const bx = Math.max(0, Math.floor(x0))
  const by = Math.max(0, Math.floor(y0))
  const ex = Math.min(ancho, Math.ceil(x1) + 1)
  const ey = Math.min(alto, Math.ceil(y1) + 1)
  if (ex <= bx || ey <= by) return null
  const w = ex - bx
  const h = ey - by
  // La distancia (al cuadrado) de cada píxel a la línea, tramo a tramo.
  const d2 = new Float32Array(w * h).fill(Infinity)
  const tramos = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p])
  for (const [a, b] of tramos) {
    const vx = b.x - a.x
    const vy = b.y - a.y
    const l2 = vx * vx + vy * vy
    const sx = Math.max(bx, Math.floor(Math.min(a.x, b.x) - R))
    const sy = Math.max(by, Math.floor(Math.min(a.y, b.y) - R))
    const tx = Math.min(ex, Math.ceil(Math.max(a.x, b.x) + R) + 1)
    const ty = Math.min(ey, Math.ceil(Math.max(a.y, b.y) + R) + 1)
    for (let y = sy; y < ty; y++) {
      const py = y + 0.5
      for (let x = sx; x < tx; x++) {
        const px = x + 0.5
        let t = l2 > 0 ? ((px - a.x) * vx + (py - a.y) * vy) / l2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const qx = px - (a.x + t * vx)
        const qy = py - (a.y + t * vy)
        const d = qx * qx + qy * qy
        const i = (y - by) * w + (x - bx)
        if (d < d2[i]) d2[i] = d
      }
    }
  }
  const alfa = new Float32Array(w * h)
  const duro = R * (1 - (m.desvanecer / 100) * 0.95)
  let alguno = false
  for (let i = 0; i < alfa.length; i++) {
    const d = Math.sqrt(d2[i])
    if (d >= R) continue
    let a = 1
    if (d > duro) {
      const t = (d - duro) / (R - duro)
      a = 1 - t * t * (3 - 2 * t)
    }
    alfa[i] = a
    alguno = true
  }
  return alguno ? { x: bx, y: by, ancho: w, alto: h, alfa } : null
}

/* ---------- Leer píxeles ---------- */

function muestra(img: Imagen, x: number, y: number, sal: number[]): void {
  // Bilineal, con el borde repetido.
  const fx = Math.min(img.ancho - 1, Math.max(0, x - 0.5))
  const fy = Math.min(img.alto - 1, Math.max(0, y - 0.5))
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const ax = fx - ix
  const ay = fy - iy
  const ix2 = Math.min(img.ancho - 1, ix + 1)
  const iy2 = Math.min(img.alto - 1, iy + 1)
  const d = img.datos
  const i00 = (iy * img.ancho + ix) * 4
  const i10 = (iy * img.ancho + ix2) * 4
  const i01 = (iy2 * img.ancho + ix) * 4
  const i11 = (iy2 * img.ancho + ix2) * 4
  for (let c = 0; c < 3; c++) {
    const a = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * ax
    const b = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * ax
    sal[c] = a + (b - a) * ay
  }
}

/* ---------- Clonar y Corregir ---------- */

/** El parche de Clonar o Corregir, ya mezclado con lo que había según la máscara y la opacidad. */
function copiar(img: Imagen, m: Mancha, mk: Mascara, fundir: boolean): Parche {
  const { ancho: W, alto: H } = img
  const ox = (m.fuente?.dx ?? 0) * W
  const oy = (m.fuente?.dy ?? 0) * H
  const n = mk.ancho * mk.alto
  const src = new Float32Array(n * 3)
  const s = [0, 0, 0]
  for (let y = 0; y < mk.alto; y++)
    for (let x = 0; x < mk.ancho; x++) {
      muestra(img, mk.x + x + 0.5 + ox, mk.y + y + 0.5 + oy, s)
      const i = (y * mk.ancho + x) * 3
      src[i] = s[0]
      src[i + 1] = s[1]
      src[i + 2] = s[2]
    }

  // Corregir: la diferencia en el borde, repartida por dentro (Shepard).
  let dif: Float32Array | null = null
  if (fundir) {
    const borde: Array<[number, number, number, number, number]> = []
    for (let y = 0; y < mk.alto; y++)
      for (let x = 0; x < mk.ancho; x++) {
        const i = y * mk.ancho + x
        if (mk.alfa[i] > 0) continue
        // Fuera del trazo pero tocándolo.
        let toca = false
        for (let dy = -1; dy <= 1 && !toca; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= mk.ancho || yy >= mk.alto) continue
            if (mk.alfa[yy * mk.ancho + xx] > 0) {
              toca = true
              break
            }
          }
        if (!toca) continue
        // La diferencia, con un poco de media para que el ruido no la manche.
        const acc = [0, 0, 0]
        let k = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const gx = mk.x + x + dx
            const gy = mk.y + y + dy
            if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue
            const g = (gy * W + gx) * 4
            muestra(img, gx + 0.5 + ox, gy + 0.5 + oy, s)
            acc[0] += img.datos[g] - s[0]
            acc[1] += img.datos[g + 1] - s[1]
            acc[2] += img.datos[g + 2] - s[2]
            k++
          }
        if (k) borde.push([x, y, acc[0] / k, acc[1] / k, acc[2] / k])
      }
    // Con muchos puntos de borde basta con una muestra repartida.
    const paso = Math.max(1, Math.floor(borde.length / 384))
    const usados = borde.filter((_, i) => i % paso === 0)
    if (usados.length) {
      dif = new Float32Array(n * 3)
      for (let y = 0; y < mk.alto; y++)
        for (let x = 0; x < mk.ancho; x++) {
          const i = y * mk.ancho + x
          if (mk.alfa[i] <= 0) continue
          let sw = 0
          let r = 0
          let g = 0
          let b = 0
          for (const p of usados) {
            const ddx = p[0] - x
            const ddy = p[1] - y
            const w = 1 / Math.pow(ddx * ddx + ddy * ddy + 0.5, 1.5)
            sw += w
            r += p[2] * w
            g += p[3] * w
            b += p[4] * w
          }
          dif[i * 3] = r / sw
          dif[i * 3 + 1] = g / sw
          dif[i * 3 + 2] = b / sw
        }
    }
  }

  return mezclar(img, mk, m.opacidad / 100, (i, c) => src[i * 3 + c] + (dif ? dif[i * 3 + c] : 0))
}

/** El parche final: lo que había, y encima lo nuevo según la máscara. */
function mezclar(img: Imagen, mk: Mascara, opacidad: number, nuevo: (i: number, c: number) => number): Parche {
  const datos = new Uint8ClampedArray(mk.ancho * mk.alto * 4)
  for (let y = 0; y < mk.alto; y++)
    for (let x = 0; x < mk.ancho; x++) {
      const i = y * mk.ancho + x
      const g = ((mk.y + y) * img.ancho + mk.x + x) * 4
      const a = mk.alfa[i] * opacidad
      for (let c = 0; c < 3; c++) {
        const viejo = img.datos[g + c]
        datos[i * 4 + c] = a > 0 ? viejo + (nuevo(i, c) - viejo) * a : viejo
      }
      datos[i * 4 + 3] = 255
    }
  return { x: mk.x, y: mk.y, ancho: mk.ancho, alto: mk.alto, datos }
}

/* ---------- Quitar: rellenar según el contenido ---------- */

/** Números al azar que salen siempre igual con la misma semilla. */
function azar(semilla: number): () => number {
  let s = semilla >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

function semillaDe(texto: string): number {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619)
  return h >>> 0
}

interface Nivel {
  w: number
  h: number
  /** RGB en coma flotante. */
  px: Float32Array
  /** 1 = hueco. */
  hueco: Uint8Array
}

const RADIO_PARCHE = 3

function reducirNivel(n: Nivel): Nivel {
  const w = Math.max(1, Math.floor(n.w / 2))
  const h = Math.max(1, Math.floor(n.h / 2))
  const px = new Float32Array(w * h * 3)
  const hueco = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let k = 0
      const acc = [0, 0, 0]
      let enHueco = 0
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const xx = Math.min(n.w - 1, x * 2 + dx)
          const yy = Math.min(n.h - 1, y * 2 + dy)
          const i = yy * n.w + xx
          if (n.hueco[i]) {
            enHueco = 1
            continue
          }
          acc[0] += n.px[i * 3]
          acc[1] += n.px[i * 3 + 1]
          acc[2] += n.px[i * 3 + 2]
          k++
        }
      const o = y * w + x
      hueco[o] = enHueco
      if (k) {
        px[o * 3] = acc[0] / k
        px[o * 3 + 1] = acc[1] / k
        px[o * 3 + 2] = acc[2] / k
      }
    }
  return { w, h, px, hueco }
}

/** Relleno inicial del nivel más pequeño: de fuera hacia dentro, con la media de los vecinos ya rellenos. */
function rellenoInicial(n: Nivel): void {
  const hecho = new Uint8Array(n.w * n.h)
  for (let i = 0; i < hecho.length; i++) hecho[i] = n.hueco[i] ? 0 : 1
  let quedan = true
  while (quedan) {
    quedan = false
    const nuevos: number[] = []
    for (let y = 0; y < n.h; y++)
      for (let x = 0; x < n.w; x++) {
        const i = y * n.w + x
        if (hecho[i]) continue
        let k = 0
        const acc = [0, 0, 0]
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= n.w || yy >= n.h) continue
            const j = yy * n.w + xx
            if (!hecho[j]) continue
            acc[0] += n.px[j * 3]
            acc[1] += n.px[j * 3 + 1]
            acc[2] += n.px[j * 3 + 2]
            k++
          }
        if (k) {
          n.px[i * 3] = acc[0] / k
          n.px[i * 3 + 1] = acc[1] / k
          n.px[i * 3 + 2] = acc[2] / k
          nuevos.push(i)
        } else quedan = true
      }
    for (const i of nuevos) hecho[i] = 1
    if (!nuevos.length) break
  }
}

/**
 * Rellena el hueco de `n` (in situ). `nnf` trae, para cada píxel, el centro del
 * trozo del que copia (o -1); se devuelve el de este nivel para el siguiente.
 */
function completar(n: Nivel, nnfPrevio: Int32Array | null, iteraciones: number, pasadasPM: number, rnd: () => number): Int32Array {
  const { w, h } = n
  const r = RADIO_PARCHE
  // Dónde puede estar el centro de un trozo de origen: entero dentro y sin tocar el hueco.
  const valido = new Uint8Array(w * h)
  const fuentes: number[] = []
  {
    // Suma acumulada del hueco para saber rápido si un cuadro lo toca.
    const sat = new Int32Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        sat[(y + 1) * (w + 1) + x + 1] = n.hueco[y * w + x] + sat[y * (w + 1) + x + 1] + sat[(y + 1) * (w + 1) + x] - sat[y * (w + 1) + x]
    for (let y = r; y < h - r; y++)
      for (let x = r; x < w - r; x++) {
        const x0 = x - r
        const y0 = y - r
        const x1 = x + r + 1
        const y1 = y + r + 1
        const s = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0]
        if (s === 0) {
          valido[y * w + x] = 1
          fuentes.push(y * w + x)
        }
      }
  }
  // Los centros cuyo trozo toca el hueco: los que hay que emparejar.
  const objetivo: number[] = []
  const tocaHueco = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!n.hueco[y * w + x]) continue
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) tocaHueco[yy * w + xx] = 1
        }
    }
  for (let i = 0; i < w * h; i++) if (tocaHueco[i]) objetivo.push(i)

  const nnf = new Int32Array(w * h).fill(-1)
  const dist = new Float32Array(w * h).fill(Infinity)
  if (!fuentes.length || !objetivo.length) return nnf

  const distancia = (t: number, s: number, tope: number): number => {
    const tx = t % w
    const ty = (t / w) | 0
    const sx = s % w
    const sy = (s / w) | 0
    // Cuántos píxeles se van a comparar, para poder dejarlo en cuanto ya no pueda ganar.
    const total = (Math.min(ty + r, h - 1) - Math.max(ty - r, 0) + 1) * (Math.min(tx + r, w - 1) - Math.max(tx - r, 0) + 1)
    const corte = tope * total
    let d = 0
    let k = 0
    for (let dy = -r; dy <= r; dy++) {
      const ay = ty + dy
      if (ay < 0 || ay >= h) continue
      const by = sy + dy
      for (let dx = -r; dx <= r; dx++) {
        const ax = tx + dx
        if (ax < 0 || ax >= w) continue
        const a = (ay * w + ax) * 3
        const b = (by * w + sx + dx) * 3
        const e0 = n.px[a] - n.px[b]
        const e1 = n.px[a + 1] - n.px[b + 1]
        const e2 = n.px[a + 2] - n.px[b + 2]
        d += e0 * e0 + e1 * e1 + e2 * e2
        k++
      }
      if (d > corte) return Infinity
    }
    return k ? d / k : Infinity
  }

  // Punto de partida: lo del nivel anterior, o al azar.
  for (const t of objetivo) {
    let s = -1
    if (nnfPrevio) {
      const p = nnfPrevio[t]
      if (p >= 0 && valido[p]) s = p
    }
    if (s < 0) s = fuentes[Math.floor(rnd() * fuentes.length)]
    nnf[t] = s
  }

  const radioBusqueda = Math.max(w, h)
  const votos = new Float32Array(w * h * 3)
  const pesos = new Float32Array(w * h)

  for (let it = 0; it < iteraciones; it++) {
    for (const t of objetivo) dist[t] = distancia(t, nnf[t], Infinity)
    for (let pasada = 0; pasada < pasadasPM; pasada++) {
      const adelante = pasada % 2 === 0
      const paso = adelante ? 1 : -1
      for (let k = 0; k < objetivo.length; k++) {
        const t = objetivo[adelante ? k : objetivo.length - 1 - k]
        const tx = t % w
        const ty = (t / w) | 0
        // Propagación: lo que le va bien al vecino, corrido uno.
        for (const [vx, vy] of [
          [tx - paso, ty],
          [tx, ty - paso]
        ]) {
          if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue
          const v = vy * w + vx
          if (nnf[v] < 0) continue
          const cx = (nnf[v] % w) + (tx - vx)
          const cy = ((nnf[v] / w) | 0) + (ty - vy)
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue
          const c = cy * w + cx
          if (!valido[c] || c === nnf[t]) continue
          const d = distancia(t, c, dist[t])
          if (d < dist[t]) {
            dist[t] = d
            nnf[t] = c
          }
        }
        // Búsqueda al azar, cada vez más cerca.
        const bx = nnf[t] % w
        const by = (nnf[t] / w) | 0
        for (let rad = radioBusqueda; rad >= 1; rad >>= 1) {
          const cx = Math.round(bx + (rnd() * 2 - 1) * rad)
          const cy = Math.round(by + (rnd() * 2 - 1) * rad)
          if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue
          const c = cy * w + cx
          if (!valido[c]) continue
          const d = distancia(t, c, dist[t])
          if (d < dist[t]) {
            dist[t] = d
            nnf[t] = c
          }
        }
      }
    }
    // Voto: cada píxel del hueco, la media de lo que le proponen los trozos que lo cubren.
    votos.fill(0)
    pesos.fill(0)
    for (const t of objetivo) {
      const s = nnf[t]
      if (s < 0) continue
      const tx = t % w
      const ty = (t / w) | 0
      const sx = s % w
      const sy = (s / w) | 0
      const peso = 1 / (1 + dist[t] / 400)
      for (let dy = -r; dy <= r; dy++) {
        const ay = ty + dy
        if (ay < 0 || ay >= h) continue
        for (let dx = -r; dx <= r; dx++) {
          const ax = tx + dx
          if (ax < 0 || ax >= w) continue
          const a = ay * w + ax
          if (!n.hueco[a]) continue
          const b = ((sy + dy) * w + sx + dx) * 3
          votos[a * 3] += n.px[b] * peso
          votos[a * 3 + 1] += n.px[b + 1] * peso
          votos[a * 3 + 2] += n.px[b + 2] * peso
          pesos[a] += peso
        }
      }
    }
    for (let a = 0; a < w * h; a++) {
      if (!n.hueco[a] || pesos[a] <= 0) continue
      n.px[a * 3] = votos[a * 3] / pesos[a]
      n.px[a * 3 + 1] = votos[a * 3 + 1] / pesos[a]
      n.px[a * 3 + 2] = votos[a * 3 + 2] / pesos[a]
    }
  }
  return nnf
}

/** Rellena el hueco de la máscara con lo de alrededor. */
function quitar(img: Imagen, m: Mancha, mk: Mascara): Parche {
  const { ancho: W, alto: H } = img
  // La zona de trabajo: el trazo y bastante de alrededor, de donde sacar trozos.
  const lado = Math.max(mk.ancho, mk.alto)
  const margen = Math.max(32, Math.round(lado * 1.2))
  const zx = Math.max(0, mk.x - margen)
  const zy = Math.max(0, mk.y - margen)
  const zw = Math.min(W, mk.x + mk.ancho + margen) - zx
  const zh = Math.min(H, mk.y + mk.alto + margen) - zy

  const base: Nivel = {
    w: zw,
    h: zh,
    px: new Float32Array(zw * zh * 3),
    hueco: new Uint8Array(zw * zh)
  }
  for (let y = 0; y < zh; y++)
    for (let x = 0; x < zw; x++) {
      const g = ((zy + y) * W + zx + x) * 4
      const i = y * zw + x
      base.px[i * 3] = img.datos[g]
      base.px[i * 3 + 1] = img.datos[g + 1]
      base.px[i * 3 + 2] = img.datos[g + 2]
    }
  for (let y = 0; y < mk.alto; y++)
    for (let x = 0; x < mk.ancho; x++) if (mk.alfa[y * mk.ancho + x] > 0) base.hueco[(mk.y - zy + y) * zw + mk.x - zx + x] = 1

  // La pirámide: hasta que el hueco sea pequeño.
  const niveles: Nivel[] = [base]
  while (niveles.length < 8) {
    const ultimo = niveles[niveles.length - 1]
    if (Math.max(mk.ancho, mk.alto) / 2 ** (niveles.length - 1) <= 20 || Math.min(ultimo.w, ultimo.h) < 40) break
    niveles.push(reducirNivel(ultimo))
  }
  const rnd = azar(semillaDe(m.id + JSON.stringify(m.puntos)))
  rellenoInicial(niveles[niveles.length - 1])

  let nnf: Int32Array | null = null
  for (let l = niveles.length - 1; l >= 0; l--) {
    const n = niveles[l]
    const final = l === 0
    nnf = completar(n, nnf, final ? 2 : l === niveles.length - 1 ? 6 : 3, final ? 3 : 4, rnd)
    if (l > 0) {
      // Al siguiente nivel: el relleno ampliado y los emparejamientos, al doble.
      const f = niveles[l - 1]
      const sig = new Int32Array(f.w * f.h).fill(-1)
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) {
          const cx = Math.min(n.w - 1, x >> 1)
          const cy = Math.min(n.h - 1, y >> 1)
          const c = cy * n.w + cx
          const i = y * f.w + x
          if (f.hueco[i]) {
            f.px[i * 3] = n.px[c * 3]
            f.px[i * 3 + 1] = n.px[c * 3 + 1]
            f.px[i * 3 + 2] = n.px[c * 3 + 2]
          }
          const s = nnf[c]
          if (s >= 0) {
            const sx = Math.min(f.w - 1, (s % n.w) * 2 + (x & 1))
            const sy = Math.min(f.h - 1, ((s / n.w) | 0) * 2 + (y & 1))
            sig[i] = sy * f.w + sx
          }
        }
      nnf = sig
    }
  }

  return mezclar(img, mk, m.opacidad / 100, (i, c) => {
    const x = i % mk.ancho
    const y = (i / mk.ancho) | 0
    return base.px[((mk.y - zy + y) * zw + mk.x - zx + x) * 3 + c]
  })
}

/* ---------- Un trazo, y todos ---------- */

/** El parche de un trazo sobre la imagen como esté ahora (con los anteriores ya pegados). */
export function curarMancha(img: Imagen, m: Mancha): Parche | null {
  const mk = mascara(m, img.ancho, img.alto)
  if (!mk) return null
  if (m.modo === 'quitar' || !m.fuente) return quitar(img, m, mk)
  return copiar(img, m, mk, m.modo === 'corregir')
}

export function pegar(img: Imagen, p: Parche): void {
  for (let y = 0; y < p.alto; y++) {
    const o = ((p.y + y) * img.ancho + p.x) * 4
    img.datos.set(p.datos.subarray(y * p.ancho * 4, (y + 1) * p.ancho * 4), o)
  }
}

/* ---------- De dónde copiar: buscar una zona parecida ---------- */

/** La foto en pequeño, para buscar deprisa. */
export function reducir(img: Imagen, lado = 768): Imagen {
  const k = Math.min(1, lado / Math.max(img.ancho, img.alto))
  if (k === 1) return img
  const ancho = Math.max(1, Math.round(img.ancho * k))
  const alto = Math.max(1, Math.round(img.alto * k))
  const datos = new Uint8ClampedArray(ancho * alto * 4)
  const paso = 1 / k
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++) {
      const x0 = Math.floor(x * paso)
      const y0 = Math.floor(y * paso)
      const x1 = Math.min(img.ancho, Math.max(x0 + 1, Math.floor((x + 1) * paso)))
      const y1 = Math.min(img.alto, Math.max(y0 + 1, Math.floor((y + 1) * paso)))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.ancho + xx) * 4
          r += img.datos[i]
          g += img.datos[i + 1]
          b += img.datos[i + 2]
          n++
        }
      const o = (y * ancho + x) * 4
      datos[o] = r / n
      datos[o + 1] = g / n
      datos[o + 2] = b / n
      datos[o + 3] = 255
    }
  return { ancho, alto, datos }
}

/**
 * Como Lightroom: al pintar un trazo de Corregir o Clonar, se elige solo de
 * dónde copiar. Se prueba alrededor, a varias distancias y en 24 direcciones,
 * y gana la zona cuyo contorno se parece más al contorno del trazo (lo de
 * dentro no sirve para comparar: es lo que se quiere quitar).
 */
export function buscarFuente(peq: Imagen, m: Pick<Mancha, 'puntos' | 'tamano' | 'desvanecer'>): { dx: number; dy: number } {
  const { ancho: W, alto: H } = peq
  const mk = mascara({ ...m, desvanecer: 0 }, W, H)
  const R = radioPx(m, W, H)
  if (!mk) return { dx: (R * 3) / W, dy: 0 }
  // El anillo de alrededor del trazo.
  const anillo = Math.max(2, Math.round(R * 0.6))
  const anillo2: Array<[number, number]> = []
  const zona = mascara({ ...m, tamano: m.tamano + (2 * anillo) / Math.max(W, H), desvanecer: 0 }, W, H)
  if (zona) {
    for (let y = 0; y < zona.alto; y++)
      for (let x = 0; x < zona.ancho; x++) {
        if (zona.alfa[y * zona.ancho + x] <= 0) continue
        const gx = zona.x + x
        const gy = zona.y + y
        const lx = gx - mk.x
        const ly = gy - mk.y
        const dentro = lx >= 0 && ly >= 0 && lx < mk.ancho && ly < mk.alto && mk.alfa[ly * mk.ancho + lx] > 0
        if (!dentro) anillo2.push([gx, gy])
      }
  }
  const muestras = anillo2.filter((_, i) => i % Math.max(1, Math.floor(anillo2.length / 600)) === 0)
  const extension = Math.hypot(mk.ancho, mk.alto) / 2 + anillo
  let mejor = { dx: Math.min(W - 1, extension * 2) / W, dy: 0 }
  let mejorCoste = Infinity
  const d = peq.datos
  for (const k of [1.15, 1.6, 2.2, 3]) {
    const dist = extension * k
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2
      const ox = Math.round(Math.cos(t) * dist)
      const oy = Math.round(Math.sin(t) * dist)
      // Que lo copiado caiga entero dentro de la foto.
      if (zona && (zona.x + ox < 0 || zona.y + oy < 0 || zona.x + zona.ancho + ox > W || zona.y + zona.alto + oy > H)) continue
      let coste = 0
      for (const [x, y] of muestras) {
        const i = (y * W + x) * 4
        const j = ((y + oy) * W + x + ox) * 4
        const e0 = d[i] - d[j]
        const e1 = d[i + 1] - d[j + 1]
        const e2 = d[i + 2] - d[j + 2]
        coste += e0 * e0 + e1 * e1 + e2 * e2
      }
      coste = coste / Math.max(1, muestras.length) + k * 6
      if (coste < mejorCoste) {
        mejorCoste = coste
        mejor = { dx: ox / W, dy: oy / H }
      }
    }
  }
  return mejor
}

/* ---------- Aberración cromática: medirla ---------- */

/**
 * La aberración cromática lateral hace que el rojo y el azul salgan un pelo
 * más grandes o más pequeños que el verde, cuanto más lejos del centro. Se
 * mide probando escalas para el rojo y el azul y quedándose con la que mejor
 * encaja sus bordes con los del verde. Devuelve cuánto escalar cada uno al
 * leerlo (positivo: leer más lejos del centro).
 */
export function medirAberracion(img: Imagen): { rojo: number; azul: number } {
  const peq = reducir(img, 1600)
  const { ancho: W, alto: H } = peq
  const canal = (c: number): Float32Array => {
    const v = new Float32Array(W * H)
    for (let i = 0; i < W * H; i++) v[i] = peq.datos[i * 4 + c]
    return v
  }
  const pasaAltos = (v: Float32Array): Float32Array => {
    // Lo que queda al quitarle una media de 5×5: los bordes.
    const tmp = new Float32Array(W * H)
    const sal = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      let s = 0
      for (let x = -2; x <= 2; x++) s += v[y * W + Math.min(W - 1, Math.max(0, x))]
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = s / 5
        s += v[y * W + Math.min(W - 1, x + 3)] - v[y * W + Math.max(0, x - 2)]
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let y = -2; y <= 2; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]
      for (let y = 0; y < H; y++) {
        sal[y * W + x] = v[y * W + x] - s / 5
        s += tmp[Math.min(H - 1, y + 3) * W + x] - tmp[Math.max(0, y - 2) * W + x]
      }
    }
    return sal
  }
  const r = pasaAltos(canal(0))
  const g = pasaAltos(canal(1))
  const b = pasaAltos(canal(2))
  // Los puntos que valen: bordes claros y lejos del centro, donde la aberración se nota.
  const cx = W / 2
  const cy = H / 2
  const mitadDiag = Math.hypot(W, H) / 2
  const puntos: number[] = []
  for (let y = 4; y < H - 4; y += 1)
    for (let x = 4; x < W - 4; x += 1) {
      const i = y * W + x
      if (Math.abs(g[i]) < 18) continue
      if (Math.hypot(x - cx, y - cy) / mitadDiag < 0.35) continue
      puntos.push(i)
    }
  const usados = puntos.filter((_, i) => i % Math.max(1, Math.floor(puntos.length / 80000)) === 0)
  if (usados.length < 200) return { rojo: 0, azul: 0 }
  const leer = (v: Float32Array, x: number, y: number): number => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) return 0
    const ax = x - ix
    const ay = y - iy
    const i = iy * W + ix
    return (v[i] * (1 - ax) + v[i + 1] * ax) * (1 - ay) + (v[i + W] * (1 - ax) + v[i + W + 1] * ax) * ay
  }
  const mejorEscala = (v: Float32Array): number => {
    let mejor = 0
    let mejorErr = Infinity
    for (let k = -40; k <= 40; k++) {
      const s = k * 0.0001
      let err = 0
      for (const i of usados) {
        const x = i % W
        const y = (i / W) | 0
        const e = leer(v, cx + (x + 0.5 - cx) * (1 + s) - 0.5, cy + (y + 0.5 - cy) * (1 + s) - 0.5) - g[i]
        err += e * e
      }
      if (err < mejorErr) {
        mejorErr = err
        mejor = s
      }
    }
    return mejor
  }
  return { rojo: mejorEscala(r), azul: mejorEscala(b) }
}
