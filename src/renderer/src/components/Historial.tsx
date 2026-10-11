/**
 * El panel Historial, debajo del carrete, como en Lightroom: los pasos de la
 * foto que se mira, el más reciente arriba. Pinchar uno lleva la foto a como
 * estaba entonces; los pasos de después se quedan, más apagados, hasta que se
 * cambie algo (entonces se descartan). Ctrl+Z y Ctrl+Y se mueven por él.
 *
 * Se pliega, y se acuerda de cómo lo dejaste.
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useStore } from '../lib/store'

const CLAVE = 'room:historial'

function leerAbierto(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== 'plegado'
  } catch {
    return true
  }
}

export function Historial(): ReactNode {
  const { historial, irAPaso, actual } = useStore()
  const [abierto, setAbierto] = useState(leerAbierto)
  if (!historial || !actual || actual.leyendo || actual.error) return null

  const alternar = (): void => {
    const nuevo = !abierto
    setAbierto(nuevo)
    try {
      localStorage.setItem(CLAVE, nuevo ? 'abierto' : 'plegado')
    } catch {
      // Sin dónde guardarlo, la próxima vez sale abierto.
    }
  }

  const pasos = historial.pasos.map((nombre, i) => ({ nombre, i })).reverse()
  return (
    <section className="historial solo-ancha" aria-label="Historial">
      <button type="button" className="sidebar-section historial-cabecera" aria-expanded={abierto} onClick={alternar}>
        <ChevronDown size={13} strokeWidth={2} className={`seccion-flecha${abierto ? '' : ' plegada'}`} />
        Historial · {historial.pasos.length} {historial.pasos.length === 1 ? 'paso' : 'pasos'}
      </button>
      {abierto && (
        <ol className="historial-lista">
          {pasos.map((p) => (
            <li key={p.i}>
              <button
                type="button"
                className={`historial-paso${p.i === historial.indice ? ' actual' : ''}${p.i > historial.indice ? ' futuro' : ''}`}
                aria-current={p.i === historial.indice ? 'step' : undefined}
                title={p.i > historial.indice ? 'Deshecho: pincha para volver a él' : undefined}
                onClick={() => irAPaso(p.i)}
              >
                <span className="truncate">{p.nombre}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
