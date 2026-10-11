/**
 * Las piezas del panel: el deslizador y la sección que se pliega.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { textoValor, type DefDeslizador } from '@shared/revelado'

/**
 * Un deslizador con su nombre y su número. Doble clic —en el nombre o en el
 * propio deslizador— lo devuelve a su sitio, como en Lightroom.
 */
export function Deslizador({
  def,
  valor,
  inicio,
  onChange,
  color,
  desactivado
}: {
  def: DefDeslizador
  valor: number
  inicio: number
  onChange: (v: number) => void
  /** La muestra de color del mezclador: pinta el tirador y un punto junto al nombre. */
  color?: string
  desactivado?: boolean
}): ReactNode {
  const id = `ctl-${def.clave}-${def.etiqueta}`
  return (
    <div className={`control${desactivado ? ' apagado' : ''}`}>
      <div className="control-fila">
        <label htmlFor={id} onDoubleClick={() => !desactivado && onChange(inicio)} title="Doble clic: volver a cero">
          {color && <span className="control-muestra" style={{ background: color }} />}
          {def.etiqueta}
        </label>
        <span className="control-valor">{textoValor(def, valor)}</span>
      </div>
      <input
        id={id}
        type="range"
        className={`deslizador${color ? ' con-color' : ''}`}
        style={color ? ({ '--muestra': color } as CSSProperties) : undefined}
        min={def.min}
        max={def.max}
        step={def.paso}
        value={valor}
        disabled={desactivado}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(inicio)}
      />
    </div>
  )
}

const CLAVE_PLEGADO = 'room:secciones'

function leerAbiertas(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_PLEGADO) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

/** Una sección del panel que se pliega. Se acuerda de cómo la dejaste. */
export function Seccion({
  id,
  titulo,
  tocada,
  pista,
  abiertaDeFabrica,
  children
}: {
  id: string
  titulo: string
  tocada: boolean
  pista?: string
  abiertaDeFabrica?: boolean
  children: ReactNode
}): ReactNode {
  const [abierta, setAbierta] = useState(() => leerAbiertas()[id] ?? !!abiertaDeFabrica)
  const alternar = (): void => {
    const nueva = !abierta
    setAbierta(nueva)
    try {
      localStorage.setItem(CLAVE_PLEGADO, JSON.stringify({ ...leerAbiertas(), [id]: nueva }))
    } catch {
      // Sin dónde guardarlo, la próxima vez sale como de fábrica.
    }
  }
  return (
    <section className="seccion">
      <h2>
        <button type="button" className="seccion-cabecera" onClick={alternar} aria-expanded={abierta}>
          <ChevronDown size={14} strokeWidth={2} className={`seccion-flecha${abierta ? '' : ' plegada'}`} />
          <span className="seccion-titulo">{titulo}</span>
          {tocada && <span className="seccion-punto" title="Con cambios" />}
          {pista && <span className="seccion-pista truncate">{pista}</span>}
        </button>
      </h2>
      {abierta && <div className="seccion-cuerpo">{children}</div>}
    </section>
  )
}
