/**
 * Recortar, encima de la foto entera: el marco con sus tercios y sus asas.
 *
 * Como en Lightroom: las esquinas y los bordes cambian el recorte, dentro se
 * mueve, y fuera del marco se arrastra para enderezar. El recorte nunca se
 * sale de la foto: si no cabe más, se queda en el borde. Con «Trazar el
 * horizonte», se traza una línea sobre algo que deba quedar recto y la foto
 * se gira para ponerla recta (o vertical, si la línea lo es casi).
 *
 * La capa que recoge el ratón se sale un poco de la foto, como en Lightroom:
 * así se puede enderezar arrastrando alrededor aunque el recorte la ocupe entera.
 */
import { useRef, useState, type ReactNode } from 'react'
import { ANGULO_MAX, conAngulo, hastaDondeQuepa, marco, razonDe, redimensionar, type Bordes, type Geometria, type Recorte } from '@shared/geometria'
import type { Revelado } from '@shared/revelado'

/** Lo cerca de un borde que hay que pulsar para cogerlo, en píxeles de pantalla. */
const ALCANCE = 10

type Arrastre =
  | { tipo: 'borde'; b: Bordes; c0: Recorte; ex: number; ey: number }
  | { tipo: 'mover'; c0: Recorte; px: number; py: number }
  | { tipo: 'girar'; g0: Geometria; cx: number; cy: number; inicio: number }
  | { tipo: 'regla'; x1: number; y1: number }

interface Props {
  g: Geometria
  ancho: number
  alto: number
  cambiar: (fn: (r: Revelado) => Revelado) => void
  regla: boolean
  ponerRegla: (v: boolean) => void
}

const ASAS: Array<[number, number, string]> = [
  [0, 0, 'esquina'],
  [50, 0, 'h'],
  [100, 0, 'esquina'],
  [0, 50, 'v'],
  [100, 50, 'v'],
  [0, 100, 'esquina'],
  [50, 100, 'h'],
  [100, 100, 'esquina']
]

export function CapaRecorte({ g, ancho, alto, cambiar, regla, ponerRegla }: Props): ReactNode {
  const capa = useRef<HTMLDivElement>(null)
  const foto = useRef<HTMLDivElement>(null)
  const arrastre = useRef<Arrastre | null>(null)
  const [linea, setLinea] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [cursor, setCursor] = useState('move')
  const { W, H } = marco(g.giro, ancho, alto)
  const c = g.recorte

  const ponerGeo = (fn: (g: Geometria) => Geometria): void => cambiar((r) => ({ ...r, geometria: fn(r.geometria) }))

  const pos = (e: React.PointerEvent): { r: DOMRect; px: number; py: number } => {
    const r = foto.current!.getBoundingClientRect()
    return { r, px: (e.clientX - r.left) / r.width, py: (e.clientY - r.top) / r.height }
  }

  /** Qué hay bajo el puntero: un borde, el marco por dentro o la foto por fuera. */
  const queHay = (r: DOMRect, px: number, py: number): { b: Bordes; dentro: boolean } => {
    const tx = ALCANCE / r.width
    const ty = ALCANCE / r.height
    const enY = py > c.y - ty && py < c.y + c.h + ty
    const enX = px > c.x - tx && px < c.x + c.w + tx
    const b = {
      l: enY && Math.abs(px - c.x) < tx,
      r: enY && Math.abs(px - c.x - c.w) < tx,
      t: enX && Math.abs(py - c.y) < ty,
      b: enX && Math.abs(py - c.y - c.h) < ty
    }
    // En un recorte muy pequeño, el borde más cercano.
    if (b.l && b.r) {
      if (Math.abs(px - c.x) < Math.abs(px - c.x - c.w)) b.r = false
      else b.l = false
    }
    if (b.t && b.b) {
      if (Math.abs(py - c.y) < Math.abs(py - c.y - c.h)) b.b = false
      else b.t = false
    }
    return { b, dentro: px > c.x && px < c.x + c.w && py > c.y && py < c.y + c.h }
  }

  const cursorDe = (b: Bordes, dentro: boolean): string => {
    if ((b.l && b.t) || (b.r && b.b)) return 'nwse-resize'
    if ((b.r && b.t) || (b.l && b.b)) return 'nesw-resize'
    if (b.l || b.r) return 'ew-resize'
    if (b.t || b.b) return 'ns-resize'
    return dentro ? 'move' : 'grab'
  }

  const alPulsar = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { r, px, py } = pos(e)
    if (regla) {
      arrastre.current = { tipo: 'regla', x1: px, y1: py }
      setLinea({ x1: px, y1: py, x2: px, y2: py })
      return
    }
    const { b, dentro } = queHay(r, px, py)
    if (b.l || b.r || b.t || b.b) {
      arrastre.current = {
        tipo: 'borde',
        b,
        c0: c,
        ex: b.l ? c.x : b.r ? c.x + c.w : px,
        ey: b.t ? c.y : b.b ? c.y + c.h : py
      }
    } else if (dentro) {
      arrastre.current = { tipo: 'mover', c0: c, px, py }
    } else {
      const cx = (c.x + c.w / 2) * r.width
      const cy = (c.y + c.h / 2) * r.height
      arrastre.current = {
        tipo: 'girar',
        g0: g,
        cx,
        cy,
        inicio: Math.atan2(e.clientY - r.top - cy, e.clientX - r.left - cx)
      }
      setCursor('grabbing')
    }
  }

  const alMover = (e: React.PointerEvent<HTMLDivElement>): void => {
    const a = arrastre.current
    const { r, px, py } = pos(e)
    if (!a) {
      if (!regla) {
        const { b, dentro } = queHay(r, px, py)
        setCursor(cursorDe(b, dentro))
      }
      return
    }
    if (a.tipo === 'regla') {
      setLinea({ x1: a.x1, y1: a.y1, x2: px, y2: py })
    } else if (a.tipo === 'borde') {
      const qx = Math.min(1, Math.max(0, px))
      const qy = Math.min(1, Math.max(0, py))
      const razon = razonDe(g.proporcion, g.invertida, W, H)
      const n = hastaDondeQuepa((t) => redimensionar(a.c0, a.b, a.ex + (qx - a.ex) * t, a.ey + (qy - a.ey) * t, razon, W, H), g.angulo, W, H)
      if (n) ponerGeo((x) => ({ ...x, recorte: n }))
    } else if (a.tipo === 'mover') {
      const dx = px - a.px
      const dy = py - a.py
      const n = hastaDondeQuepa((t) => ({ ...a.c0, x: a.c0.x + dx * t, y: a.c0.y + dy * t }), g.angulo, W, H)
      if (n) ponerGeo((x) => ({ ...x, recorte: n }))
    } else {
      const ang = Math.atan2(e.clientY - r.top - a.cy, e.clientX - r.left - a.cx)
      const grados = Math.round((a.g0.angulo + ((ang - a.inicio) * 180) / Math.PI) * 10) / 10
      ponerGeo(() => conAngulo(a.g0, grados, ancho, alto))
    }
  }

  const alSoltar = (e: React.PointerEvent<HTMLDivElement>): void => {
    const a = arrastre.current
    arrastre.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (a?.tipo === 'girar') setCursor('grab')
    if (a?.tipo !== 'regla' || !linea) return
    setLinea(null)
    const r = foto.current!.getBoundingClientRect()
    const dx = (linea.x2 - linea.x1) * r.width
    const dy = (linea.y2 - linea.y1) * r.height
    if (Math.hypot(dx, dy) < 12) return
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI
    if (ang > 90) ang -= 180
    if (ang < -90) ang += 180
    // Una línea casi vertical es una pared: se pone vertical.
    if (Math.abs(ang) > 45) ang -= ang > 0 ? 90 : -90
    const nuevo = Math.max(-ANGULO_MAX, Math.min(ANGULO_MAX, Math.round((g.angulo - ang) * 10) / 10))
    ponerGeo((x) => conAngulo(x, nuevo, ancho, alto))
    ponerRegla(false)
  }

  return (
    <div
      ref={capa}
      className="capa capa-recorte"
      style={{ cursor: regla ? 'crosshair' : cursor }}
      onPointerDown={alPulsar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={foto} className="capa-foto">
        <div
          className="recorte-marco"
          style={{
            left: `${c.x * 100}%`,
            top: `${c.y * 100}%`,
            width: `${c.w * 100}%`,
            height: `${c.h * 100}%`
          }}
        >
          <span className="recorte-linea vertical" style={{ left: '33.333%' }} />
          <span className="recorte-linea vertical" style={{ left: '66.667%' }} />
          <span className="recorte-linea horizontal" style={{ top: '33.333%' }} />
          <span className="recorte-linea horizontal" style={{ top: '66.667%' }} />
          {ASAS.map(([x, y, tipo]) => (
            <span key={`${x}-${y}`} className={`recorte-asa ${tipo}`} style={{ left: `${x}%`, top: `${y}%` }} />
          ))}
        </div>
        {linea && (
          <svg className="capa-dibujo" aria-hidden="true">
            <line x1={`${linea.x1 * 100}%`} y1={`${linea.y1 * 100}%`} x2={`${linea.x2 * 100}%`} y2={`${linea.y2 * 100}%`} />
          </svg>
        )}
      </div>
    </div>
  )
}
