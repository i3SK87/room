/**
 * El panel de revelado, a la derecha: el ajuste guardado arriba y las ocho
 * secciones debajo, en el orden de Lightroom.
 */
import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Confirm, Modal, Segmented, useAvisos } from 'casa/ui'
import { MenuContextual, useMenu } from 'casa/menu'
import {
  BASICOS,
  CALIBRACION,
  CANALES,
  COLORES_MEZCLA,
  GRADACION,
  NOMBRES_MEZCLA,
  PELICULA,
  PRESENCIA,
  RUEDAS,
  curvaEsRecta,
  reveladoNeutro,
  seccionTocada,
  type ColorMezcla,
  type DefDeslizador
} from '@shared/revelado'
import { useStore } from '../lib/store'
import { Deslizador, Seccion } from './Controles'
import { CurvaTonos } from './CurvaTonos'
import { Ruedas } from './Ruedas'
import { SeccionLut } from './SeccionLut'

const NEUTRO = reveladoNeutro()

const MUESTRAS: Record<ColorMezcla, string> = {
  rojo: '#e5484d',
  naranja: '#f08a3c',
  amarillo: '#e8c547',
  verde: '#4caf50',
  aguamarina: '#2bb3a3',
  azul: '#3c78e6',
  morado: '#8a5cf0',
  magenta: '#e04ab8'
}

type Pestana = 'h' | 's' | 'l'

export function Panel(): ReactNode {
  const { actual, cambiar, sustituir, guardados, recargarGuardados, luts } = useStore()
  const { fail, toast } = useAvisos()
  const [pestana, setPestana] = useState<Pestana>('h')
  const [guardando, setGuardando] = useState<string | null>(null)
  const [sustituyendo, setSustituyendo] = useState<string | null>(null)
  const [borrando, setBorrando] = useState<string | null>(null)
  const { menu, abrir: abrirMenu, cerrar: cerrarMenu } = useMenu<string>()

  if (!actual) return <aside className="panel panel-vacio" aria-label="Ajustes de revelado" />
  const r = actual.revelado
  const apagado = actual.leyendo || !!actual.error

  const lista = (defs: DefDeslizador[]): ReactNode =>
    defs.map((d) => (
      <Deslizador key={d.clave} def={d} valor={r[d.clave]} inicio={NEUTRO[d.clave]} onChange={(v) => cambiar((x) => ({ ...x, [d.clave]: v }))} />
    ))

  const coincide = guardados.find((g) => JSON.stringify(g.revelado) === JSON.stringify(r))
  const mezclaTocada = COLORES_MEZCLA.some((c) => r.mezcla[c].h || r.mezcla[c].s || r.mezcla[c].l)
  const gradTocada = seccionTocada(r, GRADACION) || RUEDAS.some((n) => r.ruedas[n].x || r.ruedas[n].y)

  const pedirGuardar = async (nombre: string): Promise<void> => {
    if (!nombre.trim()) return
    if (await window.room.guardados.existe(nombre)) setSustituyendo(nombre)
    else await guardar(nombre)
  }

  const guardar = async (nombre: string): Promise<void> => {
    try {
      await window.room.guardados.guardar(nombre, r)
      await recargarGuardados()
      toast(`Guardado como «${nombre.trim()}»`, 'success')
      setGuardando(null)
      setSustituyendo(null)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <aside className={`panel${apagado ? ' apagado' : ''}`} aria-label="Ajustes de revelado">
      <div className="panel-guardado">
        <label htmlFor="ajuste-guardado" className="rotulo">
          Ajuste guardado
        </label>
        <div className="panel-guardado-fila">
          <select
            id="ajuste-guardado"
            className="select"
            value={coincide?.id ?? ''}
            disabled={apagado}
            onChange={(e) => {
              const g = guardados.find((x) => x.id === e.target.value)
              if (g) sustituir(g.revelado)
            }}
            onContextMenu={coincide ? abrirMenu(coincide.id) : undefined}
            title={coincide ? 'Clic derecho: borrar este ajuste' : undefined}
          >
            <option value="">{guardados.length ? 'Sin guardar' : 'Todavía no hay ninguno'}</option>
            {guardados.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={apagado} onClick={() => setGuardando(coincide?.nombre ?? '')}>
            Guardar…
          </button>
        </div>
      </div>

      <div className="panel-secciones">
        <Seccion id="basicos" titulo="Básicos" tocada={seccionTocada(r, BASICOS)} abiertaDeFabrica>
          {lista(BASICOS)}
        </Seccion>
        <Seccion id="presencia" titulo="Presencia" tocada={seccionTocada(r, PRESENCIA)}>
          {lista(PRESENCIA)}
        </Seccion>
        <Seccion id="curva" titulo="Curva de tonos" tocada={CANALES.some((c) => !curvaEsRecta(r.curvas[c]))}>
          <CurvaTonos revelado={r} cambiar={cambiar} />
        </Seccion>
        <Seccion id="mezcla" titulo="Mezclador de color" tocada={mezclaTocada}>
          <Segmented
            value={pestana}
            options={[
              { value: 'h', label: 'Tono' },
              { value: 's', label: 'Saturación' },
              { value: 'l', label: 'Luminancia' }
            ]}
            onChange={setPestana}
          />
          {COLORES_MEZCLA.map((c) => (
            <Deslizador
              key={`${c}-${pestana}`}
              def={{ clave: 'exposicion', etiqueta: NOMBRES_MEZCLA[c], min: -100, max: 100, paso: 1 }}
              valor={r.mezcla[c][pestana]}
              inicio={0}
              color={MUESTRAS[c]}
              onChange={(v) => cambiar((x) => ({ ...x, mezcla: { ...x.mezcla, [c]: { ...x.mezcla[c], [pestana]: v } } }))}
            />
          ))}
        </Seccion>
        <Seccion id="gradacion" titulo="Gradación de color" tocada={gradTocada} abiertaDeFabrica>
          <Ruedas revelado={r} cambiar={cambiar} />
          <span className="small subtle">Arrastra dentro de una rueda para teñir; doble clic la devuelve al centro</span>
          {lista(GRADACION)}
        </Seccion>
        <Seccion id="calibracion" titulo="Calibración" tocada={seccionTocada(r, CALIBRACION)}>
          {lista(CALIBRACION)}
        </Seccion>
        <Seccion id="pelicula" titulo="Película" tocada={seccionTocada(r, PELICULA)}>
          {lista(PELICULA)}
        </Seccion>
        <Seccion id="lut" titulo="LUT" tocada={!!r.lut} pista={luts.find((l) => l.id === r.lut)?.nombre}>
          <SeccionLut revelado={r} cambiar={cambiar} />
        </Seccion>
      </div>

      <div className="panel-pie">
        <span className="small subtle">Doble clic en un control lo devuelve a cero</span>
        <button className="btn ghost small" disabled={apagado} onClick={() => sustituir(reveladoNeutro())}>
          Restablecer todo
        </button>
      </div>

      {menu && (
        <MenuContextual
          x={menu.x}
          y={menu.y}
          onCerrar={cerrarMenu}
          opciones={[{ etiqueta: 'Borrar este ajuste', icono: <Trash2 size={15} strokeWidth={1.8} />, peligrosa: true, onElegir: () => setBorrando(menu.de) }]}
        />
      )}

      {guardando !== null && (
        <Modal
          title="Guardar el ajuste"
          estrecho
          onClose={() => setGuardando(null)}
          footer={
            <>
              <button className="btn" onClick={() => setGuardando(null)}>
                Cancelar
              </button>
              <button
                className="btn primary"
                disabled={!guardando.trim()}
                onClick={() => void pedirGuardar(guardando)}
              >
                Guardar
              </button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void pedirGuardar(guardando)
            }}
          >
            <input
              className="input"
              autoFocus
              placeholder="Por ejemplo, Portra de tarde"
              value={guardando}
              maxLength={60}
              onChange={(e) => setGuardando(e.target.value)}
              aria-label="Nombre del ajuste"
            />
            <p className="small subtle">Se guarda todo el revelado: los controles, la curva, las ruedas, el grano y el LUT.</p>
          </form>
        </Modal>
      )}

      {sustituyendo && (
        <Confirm
          title="Ya existe"
          message={`Ya tienes un ajuste que se llama «${sustituyendo.trim()}». ¿Lo sustituyes por este revelado?`}
          confirmLabel="Sustituir"
          onCancel={() => setSustituyendo(null)}
          onConfirm={() => void guardar(sustituyendo)}
        />
      )}

      {borrando && (
        <Confirm
          title="Borrar el ajuste"
          message={`«${guardados.find((g) => g.id === borrando)?.nombre}» se borra. Las fotos que lo usaron se quedan como están.`}
          confirmLabel="Borrar"
          destructive
          onCancel={() => setBorrando(null)}
          onConfirm={async () => {
            const id = borrando
            setBorrando(null)
            try {
              await window.room.guardados.borrar(id)
              await recargarGuardados()
            } catch (e) {
              fail(e)
            }
          }}
        />
      )}
    </aside>
  )
}
