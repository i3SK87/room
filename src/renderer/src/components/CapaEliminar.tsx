/**
 * Eliminar, encima de la foto: se pinta un trazo sobre lo que sobra.
 *
 * Al soltar, el trazo se queda y el trabajador lo arregla. Cada trazo se ve
 * por su contorno; el elegido, más marcado y, en Corregir y Clonar, con el
 * contorno de la zona de la que copia, en el color de acento, que se puede
 * arrastrar para elegir otra. Arrastrar el propio trazo lo mueve. Clic
 * derecho sobre uno: borrarlo.
 *
 * Los trazos se guardan en coordenadas de la foto tal cual, así que aquí todo
 * se pasa de la pantalla a la foto y de vuelta: recorte, enderezado, giros y
 * la corrección del objetivo.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { MenuContextual } from 'casa/menu'
import { aplicar, desdistorsionar, distorsionar, invertir, marco, matrizSalida, type Recorte } from '@shared/geometria'
import type { Mancha, Punto, Revelado } from '@shared/revelado'
import type { Pincel } from '../lib/store'

interface Props {
  revelado: Revelado
  ancho: number
  alto: number
  /** Lo que mide la foto en pantalla. */
  css: { ancho: number; alto: number }
  /** El trozo de la foto revelada que se ve (con zoom). */
  ventana: Recorte
  cambiar: (fn: (r: Revelado) => Revelado) => void
  pincel: Pincel
  manchaSel: string | null
  elegirMancha: (id: string | null) => void
  /** De dónde copiar un trazo nuevo de Corregir o Clonar. */
  fuenteDe: (m: Pick<Mancha, 'puntos' | 'tamano' | 'desvanecer'>) => { dx: number; dy: number }
}

type Arrastre =
  | { tipo: 'nuevo'; puntos: Punto[] }
  | { tipo: 'mover'; id: string; desde: Punto; dx: number; dy: number; movido: boolean }
  | { tipo: 'fuente'; id: string; desde: Punto; dx: number; dy: number }

let contador = 0
function idNuevo(): string {
  contador = (contador + 1) % 1e6
  return `${Date.now().toString(36)}${contador.toString(36)}`
}

export function CapaEliminar({ revelado, ancho, alto, css, ventana, cambiar, pincel, manchaSel, elegirMancha, fuenteDe }: Props): ReactNode {
  const capa = useRef<HTMLDivElement>(null)
  // El arrastre va en una referencia: los movimientos llegan más deprisa de lo que React repinta,
  // y con el estado se perderían puntos. El estado solo sirve para repintar.
  const arrastreRef = useRef<Arrastre | null>(null)
  const [arrastre, setArrastreVista] = useState<Arrastre | null>(null)
  const setArrastre = (a: Arrastre | null): void => {
    arrastreRef.current = a
    setArrastreVista(a)
  }
  const [puntero, setPuntero] = useState<{ x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const g = revelado.geometria
  const { W } = marco(g.giro, ancho, alto)
  const largo = Math.max(ancho, alto)
  // Píxeles de pantalla por píxel de la foto.
  const escala = css.ancho / (ventana.w * g.recorte.w * W)

  const { aFoto, aPantalla } = useMemo(() => {
    const m = matrizSalida(g, ancho, alto)
    const inv = invertir(m)
    const d = revelado.distorsion
    return {
      aFoto: (sx: number, sy: number): Punto => {
        const [u, v] = aplicar(m, ventana.x + (sx / css.ancho) * ventana.w, ventana.y + (sy / css.alto) * ventana.h)
        const [x, y] = distorsionar(u, v, d, ancho, alto)
        return { x, y }
      },
      aPantalla: (p: Punto): [number, number] => {
        const [u, v] = desdistorsionar(p.x, p.y, d, ancho, alto)
        const [x, y] = aplicar(inv, u, v)
        return [((x - ventana.x) / ventana.w) * css.ancho, ((y - ventana.y) / ventana.h) * css.alto]
      }
    }
  }, [g, ancho, alto, revelado.distorsion, css.ancho, css.alto, ventana.x, ventana.y, ventana.w, ventana.h])

  const radio = (m: Pick<Mancha, 'tamano'>): number => ((m.tamano * largo) / 2) * escala

  // Cómo se ve cada trazo ahora mismo, con lo que se esté arrastrando.
  const vistas = revelado.manchas.map((m) => {
    let puntos = m.puntos
    let fuente = m.fuente
    if (arrastre?.tipo === 'mover' && arrastre.id === m.id) puntos = puntos.map((p) => ({ x: p.x + arrastre.dx, y: p.y + arrastre.dy }))
    if (arrastre?.tipo === 'fuente' && arrastre.id === m.id && fuente) fuente = { dx: fuente.dx + arrastre.dx, dy: fuente.dy + arrastre.dy }
    return { m, puntos, fuente }
  })

  const ruta = (puntos: Punto[], dx = 0, dy = 0): string => {
    const ps = puntos.map((p) => aPantalla({ x: p.x + dx, y: p.y + dy }))
    return ps.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + (ps.length === 1 ? ' l0.01 0' : '')
  }

  const centro = (puntos: Punto[], dx = 0, dy = 0): [number, number] => {
    let x = 0
    let y = 0
    for (const p of puntos) {
      const [a, b] = aPantalla({ x: p.x + dx, y: p.y + dy })
      x += a
      y += b
    }
    return [x / puntos.length, y / puntos.length]
  }

  /** Si el punto de pantalla cae dentro del trazo (o de su zona de origen). */
  const toca = (puntos: Punto[], r: number, sx: number, sy: number, dx = 0, dy = 0): boolean => {
    const ps = puntos.map((p) => aPantalla({ x: p.x + dx, y: p.y + dy }))
    if (ps.length === 1) return Math.hypot(sx - ps[0][0], sy - ps[0][1]) <= r
    for (let i = 1; i < ps.length; i++) {
      const [ax, ay] = ps[i - 1]
      const [bx, by] = ps[i]
      const vx = bx - ax
      const vy = by - ay
      const l2 = vx * vx + vy * vy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((sx - ax) * vx + (sy - ay) * vy) / l2)) : 0
      if (Math.hypot(sx - (ax + t * vx), sy - (ay + t * vy)) <= r) return true
    }
    return false
  }

  const enPantalla = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = capa.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const trazoEn = (sx: number, sy: number): Mancha | null => {
    for (let i = revelado.manchas.length - 1; i >= 0; i--) {
      const m = revelado.manchas[i]
      if (toca(m.puntos, radio(m), sx, sy)) return m
    }
    return null
  }

  const alPulsar = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const [sx, sy] = enPantalla(e)
    const p = aFoto(sx, sy)
    const sel = revelado.manchas.find((m) => m.id === manchaSel)
    if (sel?.fuente && toca(sel.puntos, radio(sel), sx, sy, sel.fuente.dx, sel.fuente.dy)) {
      setArrastre({ tipo: 'fuente', id: sel.id, desde: p, dx: 0, dy: 0 })
      return
    }
    const hit = trazoEn(sx, sy)
    if (hit) {
      elegirMancha(hit.id)
      setArrastre({ tipo: 'mover', id: hit.id, desde: p, dx: 0, dy: 0, movido: false })
      return
    }
    elegirMancha(null)
    setArrastre({ tipo: 'nuevo', puntos: [p] })
  }

  const alMover = (e: React.PointerEvent<HTMLDivElement>): void => {
    const [sx, sy] = enPantalla(e)
    setPuntero({ x: sx, y: sy })
    const arrastre = arrastreRef.current
    if (!arrastre) return
    const p = aFoto(sx, sy)
    if (arrastre.tipo === 'nuevo') {
      const u = arrastre.puntos[arrastre.puntos.length - 1]
      const [ux, uy] = aPantalla(u)
      // Un punto cada cuarto de radio: suficiente para que el trazo sea suave.
      if (Math.hypot(sx - ux, sy - uy) < Math.max(2, radio(pincel) * 0.25)) return
      setArrastre({ ...arrastre, puntos: [...arrastre.puntos, p] })
    } else {
      const dx = p.x - arrastre.desde.x
      const dy = p.y - arrastre.desde.y
      setArrastre(
        arrastre.tipo === 'mover'
          ? {
              ...arrastre,
              dx,
              dy,
              movido: arrastre.movido || Math.hypot(dx, dy) * largo * escala > 3
            }
          : { ...arrastre, dx, dy }
      )
    }
  }

  const alSoltar = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const a = arrastreRef.current
    setArrastre(null)
    if (!a) return
    if (a.tipo === 'nuevo') {
      const base = { puntos: a.puntos, tamano: pincel.tamano, desvanecer: pincel.desvanecer }
      const m: Mancha = {
        id: idNuevo(),
        modo: pincel.modo,
        ...base,
        opacidad: pincel.opacidad,
        fuente: pincel.modo === 'quitar' ? null : fuenteDe(base)
      }
      cambiar((r) => ({ ...r, manchas: [...r.manchas, m] }))
      elegirMancha(m.id)
    } else if (a.tipo === 'mover') {
      if (!a.movido) return
      cambiar((r) => ({
        ...r,
        manchas: r.manchas.map((m) => (m.id === a.id ? { ...m, puntos: m.puntos.map((p) => ({ x: p.x + a.dx, y: p.y + a.dy })) } : m))
      }))
    } else if (a.dx || a.dy) {
      cambiar((r) => ({
        ...r,
        manchas: r.manchas.map((m) => (m.id === a.id && m.fuente ? { ...m, fuente: { dx: m.fuente.dx + a.dx, dy: m.fuente.dy + a.dy } } : m))
      }))
    }
  }

  const alMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const [sx, sy] = enPantalla(e)
    const hit = trazoEn(sx, sy)
    if (!hit) return
    elegirMancha(hit.id)
    setMenu({ x: e.clientX, y: e.clientY, id: hit.id })
  }

  const rPincel = radio(pincel)

  // El menú va fuera de la capa: aunque se pinte aparte, sus clics subirían por React hasta ella.
  return (
    <>
      <div
        ref={capa}
        className="capa capa-eliminar"
        onPointerDown={alPulsar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onPointerLeave={() => setPuntero(null)}
        onContextMenu={alMenu}
      >
        <svg className="capa-dibujo" width={css.ancho} height={css.alto} aria-hidden="true">
          <defs>
            {vistas.map(({ m, puntos, fuente }) => {
              const r = radio(m)
              return (
                <g key={m.id}>
                  <mask id={`contorno-${m.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width={css.ancho} height={css.alto}>
                    <path d={ruta(puntos)} className="mascara-fuera" strokeWidth={r * 2 + 3} />
                    <path d={ruta(puntos)} className="mascara-dentro" strokeWidth={r * 2} />
                  </mask>
                  {fuente && (
                    <mask id={`fuente-${m.id}`} maskUnits="userSpaceOnUse" x="0" y="0" width={css.ancho} height={css.alto}>
                      <path d={ruta(puntos, fuente.dx, fuente.dy)} className="mascara-fuera" strokeWidth={r * 2 + 3} />
                      <path d={ruta(puntos, fuente.dx, fuente.dy)} className="mascara-dentro" strokeWidth={r * 2} />
                    </mask>
                  )}
                </g>
              )
            })}
          </defs>
          {vistas.map(({ m, puntos, fuente }) => {
            const sel = m.id === manchaSel
            const [cx, cy] = centro(puntos)
            return (
              <g key={m.id} className={sel ? 'trazo elegido' : 'trazo'}>
                {sel && fuente && (
                  <>
                    <line
                      className="trazo-union"
                      x1={centro(puntos, fuente.dx, fuente.dy)[0]}
                      y1={centro(puntos, fuente.dx, fuente.dy)[1]}
                      x2={cx}
                      y2={cy}
                    />
                    <rect className="trazo-fuente" x="0" y="0" width={css.ancho} height={css.alto} mask={`url(#fuente-${m.id})`} />
                  </>
                )}
                <rect className="trazo-contorno" x="0" y="0" width={css.ancho} height={css.alto} mask={`url(#contorno-${m.id})`} />
              </g>
            )
          })}
          {arrastre?.tipo === 'nuevo' && <path className="trazo-pintando" d={ruta(arrastre.puntos)} strokeWidth={rPincel * 2} />}
          {puntero && !arrastre && <circle className="pincel" cx={puntero.x} cy={puntero.y} r={rPincel} />}
        </svg>
      </div>
      {menu && (
        <MenuContextual
          x={menu.x}
          y={menu.y}
          onCerrar={() => setMenu(null)}
          opciones={[
            {
              etiqueta: 'Borrar este trazo',
              icono: <Trash2 size={15} strokeWidth={1.8} />,
              onElegir: () => {
                const id = menu.id
                cambiar((r) => ({ ...r, manchas: r.manchas.filter((m) => m.id !== id) }))
                elegirMancha(null)
              }
            }
          ]}
        />
      )}
    </>
  )
}
