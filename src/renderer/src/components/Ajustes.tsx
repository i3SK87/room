/** Los ajustes de la aplicación: el tema y la paleta de la casa. */
import { useEffect, useState, type ReactNode } from 'react'
import { Checkbox, Field, Modal, Segmented, SelectorPaleta, useAvisos } from 'casa/ui'
import { esPaleta, type Paleta } from 'casa/paletas'
import type { Ajustes as TipoAjustes } from '@shared/tipos'
import { useStore } from '../lib/store'
import { ConfirmarReinicio, contarActualizacion, useActualizacion } from './Actualizacion'

export function Ajustes({ onClose }: { onClose: () => void }): ReactNode {
  const { ajustes, cambiarAjustes } = useStore()
  const { fail } = useAvisos()
  const e = useActualizacion()
  const [version, setVersion] = useState('')
  const [reiniciando, setReiniciando] = useState(false)
  useEffect(() => {
    void window.room.version().then(setVersion).catch(() => undefined)
  }, [])
  return (
    <Modal
      title="Ajustes"
      wide
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Listo
        </button>
      }
    >
      <div className="exportar">
        <Field label="Tema">
          <Segmented<TipoAjustes['tema']>
            value={ajustes.tema}
            options={[
              { value: 'system', label: 'Automático' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Oscuro' }
            ]}
            onChange={(tema) => void cambiarAjustes({ tema })}
          />
        </Field>
        <Field label="Paleta">
          <SelectorPaleta value={(esPaleta(ajustes.paleta) ? ajustes.paleta : 'grafito') as Paleta} onChange={(paleta) => void cambiarAjustes({ paleta })} />
        </Field>
        <Field label="Acerca de">
          <div className="col" style={{ gap: 12 }}>
            <p className="small muted">ROOM, versión {version} · de la misma casa que BONK y CLAC · tus fotos no salen del ordenador</p>
            <Checkbox
              checked={ajustes.buscarVersiones}
              onChange={(v) => void cambiarAjustes({ buscarVersiones: v })}
              label="Buscar versiones nuevas"
              hint="Al abrir, en GitHub. Solo se piden los archivos de la versión publicada: nada tuyo sale del ordenador."
            />
            <div className="row">
              <div className="small muted" style={{ maxWidth: 460 }}>
                {contarActualizacion(e)}
              </div>
              <div className="spacer" />
              {e.fase === 'lista' ? (
                <button className="btn primary small" onClick={() => setReiniciando(true)}>
                  Reiniciar e instalar
                </button>
              ) : e.fase === 'disponible' ? (
                <button className="btn primary small" onClick={() => void window.room.actualizacion.descargar().catch(fail)}>
                  Descargar
                </button>
              ) : (
                <button
                  className="btn small"
                  disabled={e.fase === 'buscando' || e.fase === 'descargando'}
                  onClick={() => void window.room.actualizacion.buscar().catch(fail)}
                >
                  Buscar ahora
                </button>
              )}
            </div>
          </div>
        </Field>
      </div>
      {reiniciando && <ConfirmarReinicio version={e.version} alCerrar={() => setReiniciando(false)} />}
    </Modal>
  )
}
