/**
 * La barra lateral de la casa, con el carrete: las fotos abiertas, cada una
 * con su miniatura ya revelada.
 *
 * Clic derecho sobre una foto: enseñarla en su carpeta o quitarla del
 * carrete. Quitarla no borra nada: ni el archivo ni su revelado, que vuelve
 * si se abre otra vez.
 */
import type { ReactNode } from 'react'
import { FolderOpen, Plus, Settings, X } from 'lucide-react'
import { useAvisos } from 'casa/ui'
import { MenuContextual, useMenu } from 'casa/menu'
import { estaTocado } from '@shared/revelado'
import { useStore, type Foto } from '../lib/store'
import { AvisoVersion } from './Actualizacion'
import marca from '../../../../resources/icon.png'

function estado(f: Foto): string {
  if (f.leyendo) return 'Abriendo…'
  if (f.error) return 'No se pudo abrir'
  return estaTocado(f.revelado) ? 'Revelada' : 'Sin tocar'
}

export function Carrete({ alAbrir, alAjustes }: { alAbrir: () => void; alAjustes: () => void }): ReactNode {
  const { fotos, actual, seleccionar, quitar } = useStore()
  const { fail } = useAvisos()
  const { menu, abrir: abrirMenu, cerrar: cerrarMenu } = useMenu<Foto>()

  return (
    <nav className="sidebar" aria-label="Carrete">
      <div className="sidebar-brand">
        <img className="mark" src={marca} alt="" />
        <span>ROOM</span>
      </div>

      {fotos.length > 0 && (
        <div className="sidebar-section">
          Carrete · {fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}
        </div>
      )}
      <div className="carrete-lista">
        {fotos.map((f) => (
          <button
            key={f.id}
            className={`nav-item carrete-item${f.id === actual?.id ? ' active' : ''}${menu?.de.id === f.id ? ' marcada' : ''}`}
            onClick={() => seleccionar(f.id)}
            onContextMenu={abrirMenu(f)}
            title={f.nombre}
            aria-current={f.id === actual?.id ? 'true' : undefined}
          >
            <span className="carrete-mini" style={f.miniatura ? { backgroundImage: `url(${f.miniatura})` } : undefined}>
              {f.leyendo && <span className="spinner pequeno" />}
            </span>
            <span className="nav-label carrete-texto">
              <span className="carrete-nombre truncate">{f.nombre}</span>
              <span className="carrete-estado">{estado(f)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="carrete-abajo">
        <button className="nav-item carrete-abrir" onClick={alAbrir} title="Abrir fotos (Ctrl+O)">
          <Plus size={16} strokeWidth={1.8} />
          <span className="nav-label">Abrir fotos…</span>
        </button>
        <span className="carrete-pista solo-ancha">HEIC, JPEG y PNG · o arrástralas</span>
        <button className="nav-item" onClick={alAjustes} title="Ajustes">
          <Settings size={16} strokeWidth={1.8} />
          <span className="nav-label">Ajustes</span>
        </button>
        <AvisoVersion />
      </div>

      {menu && (
        <MenuContextual
          x={menu.x}
          y={menu.y}
          onCerrar={cerrarMenu}
          opciones={[
            {
              etiqueta: 'Mostrar en la carpeta',
              icono: <FolderOpen size={15} strokeWidth={1.8} />,
              onElegir: () => void window.room.fotos.mostrar(menu.de.ruta).catch(fail)
            },
            { etiqueta: 'Quitar del carrete', icono: <X size={15} strokeWidth={1.8} />, onElegir: () => quitar(menu.de.id) }
          ]}
        />
      )}
    </nav>
  )
}
