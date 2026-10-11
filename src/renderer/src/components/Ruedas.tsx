/**
 * Las tres ruedas de la gradación de color: sombras, medios y luces.
 *
 * Se arrastra dentro de una rueda y la foto se tiñe mientras se mueve; si el
 * puntero se sale sin soltar, el punto lo sigue pegado al borde. Doble clic la
 * devuelve al centro. El ángulo es el tono y la distancia al centro, cuánto.
 */
import type { ReactNode } from 'react'
import { RUEDAS, type NombreRueda, type PosRueda, type Revelado } from '@shared/revelado'
import { tonoDeRueda } from '../motor/uniformes'

const NOMBRES: Record<NombreRueda, string> = { sombras: 'Sombras', medios: 'Medios', luces: 'Luces' }

export function Ruedas({ revelado, cambiar }: { revelado: Revelado; cambiar: (fn: (r: Revelado) => Revelado) => void }): ReactNode {
  const poner = (n: NombreRueda, p: PosRueda): void => cambiar((r) => ({ ...r, ruedas: { ...r.ruedas, [n]: p } }))

  const mover = (n: NombreRueda, e: React.PointerEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    let x = ((e.clientX - r.left) / r.width) * 2 - 1
    let y = ((e.clientY - r.top) / r.height) * 2 - 1
    const m = Math.hypot(x, y)
    if (m > 1) {
      x /= m
      y /= m
    }
    poner(n, { x, y })
  }

  return (
    <div className="ruedas">
      {RUEDAS.map((n) => {
        const p = revelado.ruedas[n]
        const d = Math.hypot(p.x, p.y)
        const color = d < 0.02 ? 'var(--fg-subtle)' : `hsl(${tonoDeRueda(p).toFixed(0)} 70% 55%)`
        return (
          <div key={n} className="rueda">
            <button
              type="button"
              className="rueda-disco"
              aria-label={`Rueda de ${NOMBRES[n].toLowerCase()}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                mover(n, e)
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) mover(n, e)
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
              }}
              onDoubleClick={() => poner(n, { x: 0, y: 0 })}
            >
              <span className="rueda-punto" style={{ left: `${50 + p.x * 50}%`, top: `${50 + p.y * 50}%`, background: color }} />
            </button>
            <span className="small muted">{NOMBRES[n]}</span>
          </div>
        )
      })}
    </div>
  )
}
