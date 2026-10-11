/**
 * La curva de tonos por puntos, con un canal de luz y uno por color.
 *
 * Como en Lightroom: se pulsa en la curva para añadir un punto y se arrastra
 * para moverlo; la foto cambia mientras se arrastra. Un punto no adelanta a
 * sus vecinos y los extremos solo suben y bajan. El clic derecho sobre un
 * punto intermedio ofrece borrarlo.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Segmented } from 'casa/ui'
import { MenuContextual } from 'casa/menu'
import { curvaRecta, type Canal, type Punto, type Revelado } from '@shared/revelado'
import { anadirPunto, funcionCurva, moverPunto } from '@shared/curva'

const CANALES: Array<{ value: Canal; label: string; color: string }> = [
  { value: 'lum', label: 'Luz', color: 'var(--fg)' },
  { value: 'r', label: 'Rojo', color: '#e5484d' },
  { value: 'g', label: 'Verde', color: '#46a758' },
  { value: 'b', label: 'Azul', color: '#3e7be6' }
]

/** Lo cerca que hay que pulsar de un punto para cogerlo, en fracción de la caja. */
const ALCANCE = 0.06

export function CurvaTonos({ revelado, cambiar }: { revelado: Revelado; cambiar: (fn: (r: Revelado) => Revelado) => void }): ReactNode {
  const [canal, setCanal] = useState<Canal>('lum')
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null)
  const caja = useRef<HTMLDivElement>(null)
  const arrastre = useRef<number | null>(null)

  const puntos = revelado.curvas[canal]
  const color = CANALES.find((c) => c.value === canal)!.color

  const ruta = useMemo(() => {
    const f = funcionCurva(puntos)
    let d = ''
    for (let i = 0; i <= 200; i++) {
      const x = i / 200
      d += `${i ? 'L' : 'M'}${(x * 100).toFixed(2)} ${((1 - f(x)) * 100).toFixed(2)}`
    }
    return d
  }, [puntos])

  const poner = (p: Punto[]): void => cambiar((r) => ({ ...r, curvas: { ...r.curvas, [canal]: p } }))

  const posicion = (e: React.PointerEvent | React.MouseEvent): Punto => {
    const r = caja.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    }
  }

  const cercano = (q: Punto): number => {
    let mejor = -1
    let dist = ALCANCE
    puntos.forEach((p, i) => {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < dist) {
        dist = d
        mejor = i
      }
    })
    return mejor
  }

  const alPulsar = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const q = posicion(e)
    let i = cercano(q)
    let lista = puntos
    if (i < 0) {
      if (q.x < 0.03) i = 0
      else if (q.x > 0.97) i = puntos.length - 1
      else {
        const hecho = anadirPunto(puntos, q.x, q.y)
        if (!hecho) return
        lista = hecho.puntos
        i = hecho.indice
      }
    }
    arrastre.current = i
    poner(moverPunto(lista, i, q.x, q.y))
  }

  const alMover = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (arrastre.current === null) return
    const q = posicion(e)
    poner(moverPunto(revelado.curvas[canal], arrastre.current, q.x, q.y))
  }

  const alSoltar = (e: React.PointerEvent<HTMLDivElement>): void => {
    arrastre.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const alMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const i = cercano(posicion(e))
    if (i <= 0 || i >= puntos.length - 1) return
    setMenu({ x: e.clientX, y: e.clientY, i })
  }

  return (
    <div className="curva">
      <Segmented value={canal} options={CANALES.map(({ value, label }) => ({ value, label }))} onChange={setCanal} />
      <div
        ref={caja}
        className="curva-caja"
        role="img"
        aria-label="Curva de tonos: arrastra para añadir o mover un punto; clic derecho sobre un punto para borrarlo"
        onPointerDown={alPulsar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onContextMenu={alMenu}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="curva-rejilla" d="M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" />
          <path className="curva-diagonal" d="M0 100L100 0" />
          <path className="curva-linea" d={ruta} style={{ stroke: color }} />
        </svg>
        {puntos.map((p, i) => (
          <span
            key={i}
            className={`curva-punto${menu?.i === i ? ' marcado' : ''}`}
            style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%`, borderColor: color }}
          />
        ))}
      </div>
      <div className="curva-pie">
        <span className="small subtle">Pulsa para añadir un punto; clic derecho para borrarlo</span>
        <button className="btn ghost mini" onClick={() => poner(curvaRecta())} title="Dejar este canal recto">
          <RotateCcw size={13} /> Restablecer
        </button>
      </div>
      {menu && (
        <MenuContextual
          x={menu.x}
          y={menu.y}
          onCerrar={() => setMenu(null)}
          opciones={[
            {
              etiqueta: 'Borrar punto',
              icono: <Trash2 size={15} strokeWidth={1.8} />,
              onElegir: () => poner(puntos.filter((_, k) => k !== menu.i))
            }
          ]}
        />
      )}
    </div>
  )
}
