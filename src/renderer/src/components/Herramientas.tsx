/**
 * Las herramientas de encima del panel, como las de debajo del histograma en
 * Lightroom: Recortar (R) y Eliminar (Q). Al abrir una, sus controles salen
 * aquí mismo, encima de las secciones; «Listo» la cierra.
 */
import type { ReactNode } from 'react'
import { Crop, Eraser, FlipHorizontal2, FlipVertical2, RectangleHorizontal, RotateCcw, RotateCw, Ruler } from 'lucide-react'
import { Segmented } from 'casa/ui'
import {
  ANGULO_MAX,
  NOMBRES_PROPORCION,
  PROPORCIONES,
  conAngulo,
  conGiro,
  conProporcion,
  conVolteo,
  geometriaNeutra,
  marco,
  textoProporcion,
  type Geometria,
  type Proporcion
} from '@shared/geometria'
import { MODOS_MANCHA, TAMANO_MANCHA, type Mancha, type ModoMancha, type Revelado } from '@shared/revelado'
import { fotoDecodificada } from '../lib/motores'
import { fuenteAutomatica } from '../lib/curar'
import { useStore, type Herramienta, type Pincel } from '../lib/store'

export function BarraHerramientas({ apagada }: { apagada: boolean }): ReactNode {
  const { herramienta, ponerHerramienta } = useStore()
  const boton = (h: Herramienta, nombre: string, titulo: string, icono: ReactNode): ReactNode => (
    <button
      type="button"
      className={`btn herramienta${herramienta === h ? ' activa' : ''}`}
      aria-pressed={herramienta === h}
      title={titulo}
      disabled={apagada}
      onClick={() => ponerHerramienta(herramienta === h ? null : h)}
    >
      {icono}
      {nombre}
    </button>
  )
  return (
    <div className="herramientas" role="group" aria-label="Herramientas">
      {boton('recortar', 'Recortar', 'Recortar y enderezar (R)', <Crop size={16} strokeWidth={1.8} />)}
      {boton('eliminar', 'Eliminar', 'Quitar, corregir y clonar (Q)', <Eraser size={16} strokeWidth={1.8} />)}
    </div>
  )
}

/* ---------- Recortar ---------- */

export function PanelRecortar({ revelado, ancho, alto }: { revelado: Revelado; ancho: number; alto: number }): ReactNode {
  const { cambiar, ponerHerramienta, regla, ponerRegla } = useStore()
  const g = revelado.geometria
  const { W, H } = marco(g.giro, ancho, alto)
  const poner = (fn: (g: Geometria) => Geometria): void => cambiar((r) => ({ ...r, geometria: fn(r.geometria) }))
  const sinTumbar = g.proporcion === 'libre' || g.proporcion === '1:1'

  return (
    <div className="panel-herramienta">
      <div className="control">
        <label htmlFor="recortar-proporcion" className="control-etiqueta">
          Proporción
        </label>
        <div className="panel-guardado-fila">
          <select
            id="recortar-proporcion"
            className="select"
            value={g.proporcion}
            onChange={(e) => poner((x) => conProporcion(x, e.target.value as Proporcion, false, ancho, alto))}
          >
            {PROPORCIONES.map((p) => (
              <option key={p} value={p}>
                {NOMBRES_PROPORCION[p]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn small"
            disabled={sinTumbar}
            title="Cambiar entre vertical y horizontal (X)"
            aria-label="Cambiar entre vertical y horizontal"
            onClick={() => poner((x) => conProporcion(x, x.proporcion, !x.invertida, ancho, alto))}
          >
            <RectangleHorizontal size={15} strokeWidth={1.8} />
            {textoProporcion(g, W, H)}
          </button>
        </div>
      </div>

      <div className="control">
        <div className="control-fila">
          <label htmlFor="recortar-angulo" onDoubleClick={() => poner((x) => conAngulo(x, 0, ancho, alto))} title="Doble clic: volver a cero">
            Enderezar
          </label>
          <span className="control-valor">{`${g.angulo > 0 ? '+' : ''}${g.angulo.toFixed(1).replace('.', ',')}°`}</span>
        </div>
        <input
          id="recortar-angulo"
          type="range"
          className="deslizador"
          min={-ANGULO_MAX}
          max={ANGULO_MAX}
          step={0.1}
          value={g.angulo}
          onChange={(e) => poner((x) => conAngulo(x, Number(e.target.value), ancho, alto))}
          onDoubleClick={() => poner((x) => conAngulo(x, 0, ancho, alto))}
        />
        <button type="button" className={`btn small regla${regla ? ' activa' : ''}`} aria-pressed={regla} onClick={() => ponerRegla(!regla)}>
          <Ruler size={15} strokeWidth={1.8} />
          Trazar el horizonte
        </button>
      </div>

      <div className="giros">
        <button
          type="button"
          className="btn small"
          title="Girar a la izquierda"
          aria-label="Girar a la izquierda"
          onClick={() => poner((x) => conGiro(x, -1, ancho, alto))}
        >
          <RotateCcw size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="btn small"
          title="Girar a la derecha"
          aria-label="Girar a la derecha"
          onClick={() => poner((x) => conGiro(x, 1, ancho, alto))}
        >
          <RotateCw size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`btn small${g.voltH ? ' activa' : ''}`}
          title="Voltear en horizontal"
          aria-label="Voltear en horizontal"
          aria-pressed={g.voltH}
          onClick={() => poner((x) => conVolteo(x, 'h'))}
        >
          <FlipHorizontal2 size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`btn small${g.voltV ? ' activa' : ''}`}
          title="Voltear en vertical"
          aria-label="Voltear en vertical"
          aria-pressed={g.voltV}
          onClick={() => poner((x) => conVolteo(x, 'v'))}
        >
          <FlipVertical2 size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="panel-herramienta-pie">
        <button type="button" className="btn ghost small" onClick={() => poner(() => geometriaNeutra())}>
          Restablecer
        </button>
        <button type="button" className="btn primary small" onClick={() => ponerHerramienta(null)}>
          Listo
        </button>
      </div>
    </div>
  )
}

/* ---------- Eliminar ---------- */

const NOMBRES_MODO: Record<ModoMancha, string> = {
  quitar: 'Quitar',
  corregir: 'Corregir',
  clonar: 'Clonar'
}
const PISTAS_MODO: Record<ModoMancha, string> = {
  quitar: 'Pinta encima de lo que sobre: se rellena con lo que tiene alrededor.',
  corregir:
    'Pinta sobre la mancha: se tapa con otra zona parecida y se funde con su luz y su color. Arrastra el contorno de origen para elegir otra.',
  clonar: 'Como Corregir, pero copia la otra zona tal cual, sin fundirla.'
}

// El tamaño va en escala logarítmica: hace falta finura en los pinceles pequeños.
const POSICIONES = 100
function aPosicion(t: number): number {
  return Math.round((Math.log(t / TAMANO_MANCHA.min) / Math.log(TAMANO_MANCHA.max / TAMANO_MANCHA.min)) * POSICIONES)
}
function dePosicion(p: number): number {
  return TAMANO_MANCHA.min * (TAMANO_MANCHA.max / TAMANO_MANCHA.min) ** (p / POSICIONES)
}

export function PanelEliminar({ revelado, ruta, ancho, alto }: { revelado: Revelado; ruta: string; ancho: number; alto: number }): ReactNode {
  const { cambiar, ponerHerramienta, pincel, cambiarPincel, manchaSel, elegirMancha } = useStore()
  const sel = revelado.manchas.find((m) => m.id === manchaSel) ?? null
  const valores: Pincel = sel ?? pincel
  const n = revelado.manchas.length

  const cambiarSel = (fn: (m: Mancha) => Mancha): void => {
    if (!sel) return
    cambiar((r) => ({ ...r, manchas: r.manchas.map((m) => (m.id === sel.id ? fn(m) : m)) }))
  }

  const ponerModo = async (modo: ModoMancha): Promise<void> => {
    cambiarPincel({ modo })
    if (!sel) return
    let fuente = sel.fuente
    if (modo !== 'quitar' && !fuente) fuente = fuenteAutomatica((await fotoDecodificada(ruta)).fuente, sel)
    cambiarSel((m) => ({ ...m, modo, fuente: modo === 'quitar' ? null : fuente }))
  }

  const poner = (campo: 'tamano' | 'desvanecer' | 'opacidad', v: number): void => {
    cambiarPincel({ [campo]: v })
    cambiarSel((m) => ({ ...m, [campo]: v }))
  }

  const deslizador = (
    id: string,
    etiqueta: string,
    valor: number,
    texto: string,
    min: number,
    max: number,
    onChange: (v: number) => void
  ): ReactNode => (
    <div className="control">
      <div className="control-fila">
        <label htmlFor={id}>{etiqueta}</label>
        <span className="control-valor">{texto}</span>
      </div>
      <input
        id={id}
        type="range"
        className="deslizador"
        min={min}
        max={max}
        step={1}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )

  return (
    <div className="panel-herramienta">
      <Segmented<ModoMancha>
        value={valores.modo}
        options={MODOS_MANCHA.map((m) => ({ value: m, label: NOMBRES_MODO[m] }))}
        onChange={(m) => void ponerModo(m)}
      />
      <span className="small subtle pista">{PISTAS_MODO[valores.modo]}</span>
      {deslizador(
        'eliminar-tamano',
        'Tamaño',
        aPosicion(valores.tamano),
        `${Math.round(valores.tamano * Math.max(ancho, alto))} px`,
        0,
        POSICIONES,
        (p) => poner('tamano', dePosicion(p))
      )}
      {deslizador('eliminar-desvanecer', 'Desvanecer', valores.desvanecer, String(Math.round(valores.desvanecer)), 0, 100, (v) =>
        poner('desvanecer', v)
      )}
      {deslizador('eliminar-opacidad', 'Opacidad', valores.opacidad, `${Math.round(valores.opacidad)} %`, 0, 100, (v) => poner('opacidad', v))}
      <div className="panel-herramienta-pie">
        <span className="small subtle">{n === 0 ? 'Nada eliminado todavía' : n === 1 ? '1 trazo' : `${n} trazos`}</span>
        <div className="row">
          <button
            type="button"
            className="btn ghost small"
            disabled={!n}
            onClick={() => {
              cambiar((r) => ({ ...r, manchas: [] }))
              elegirMancha(null)
            }}
          >
            Borrar todos
          </button>
          <button type="button" className="btn primary small" onClick={() => ponerHerramienta(null)}>
            Listo
          </button>
        </div>
      </div>
    </div>
  )
}
