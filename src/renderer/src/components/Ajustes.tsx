/** Los ajustes de la aplicación: el tema y la paleta de la casa. */
import type { ReactNode } from 'react'
import { Field, Modal, Segmented, SelectorPaleta } from 'casa/ui'
import { esPaleta, type Paleta } from 'casa/paletas'
import type { Ajustes as TipoAjustes } from '@shared/tipos'
import { useStore } from '../lib/store'

export function Ajustes({ onClose }: { onClose: () => void }): ReactNode {
  const { ajustes, cambiarAjustes } = useStore()
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
      </div>
    </Modal>
  )
}
