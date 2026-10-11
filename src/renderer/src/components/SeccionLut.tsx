/**
 * La sección LUT: la biblioteca, la intensidad y exportar el revelado propio
 * como LUT.
 *
 * Los `.cube` importados se copian dentro de ROOM, así que siguen ahí aunque
 * el original se borre. El clic derecho sobre el desplegable ofrece cambiarle
 * el nombre al LUT elegido o quitarlo de la biblioteca.
 */
import { useState, type ReactNode } from 'react'
import { Download, Pencil, Trash2, Upload } from 'lucide-react'
import { Confirm, Modal, useAvisos } from 'casa/ui'
import { MenuContextual, useMenu } from 'casa/menu'
import { escribirCube } from '@shared/cube'
import { INTENSIDAD_LUT, reveladoNeutro, type Revelado } from '@shared/revelado'
import { useStore } from '../lib/store'
import { motorTrabajo } from '../lib/motores'
import { Deslizador } from './Controles'

export function SeccionLut({ revelado, cambiar }: { revelado: Revelado; cambiar: (fn: (r: Revelado) => Revelado) => void }): ReactNode {
  const { luts, recargarLuts, lutActual, actual } = useStore()
  const { toast, fail } = useAvisos()
  const { menu, abrir: abrirMenu, cerrar: cerrarMenu } = useMenu<string>()
  const [borrando, setBorrando] = useState<string | null>(null)
  const [renombrando, setRenombrando] = useState<{ id: string; nombre: string } | null>(null)
  const [exportando, setExportando] = useState(false)

  const elegido = luts.find((l) => l.id === revelado.lut) ?? null

  const importar = async (): Promise<void> => {
    try {
      const { anadidos, fallos } = await window.room.luts.importar()
      await recargarLuts()
      for (const f of fallos) toast(f, 'error')
      if (anadidos.length) {
        cambiar((r) => ({ ...r, lut: anadidos[0].id }))
        toast(anadidos.length === 1 ? `«${anadidos[0].nombre}» está en tu biblioteca` : `${anadidos.length} LUT nuevos en tu biblioteca`, 'success')
      }
    } catch (e) {
      fail(e)
    }
  }

  const exportarLut = async (): Promise<void> => {
    if (!actual) return
    setExportando(true)
    try {
      // Se hornea en el motor de trabajo: la rejilla de colores no necesita la foto.
      const m = motorTrabajo()
      m.ponerLut(lutActual && lutActual !== 'falta' ? lutActual : null)
      const datos = m.hornearLut(revelado, 33)
      const nombre = actual.nombre.replace(/\.[^.]+$/, '')
      const ruta = await window.room.luts.exportar(`${nombre} (ROOM)`, escribirCube(`${nombre} · ROOM`, 33, datos))
      if (ruta) toast('LUT exportado', 'success')
    } catch (e) {
      fail(e)
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <div className="lut-fila">
        <label htmlFor="lut-elegido" className="sr-only">
          LUT aplicada
        </label>
        <select
          id="lut-elegido"
          className="select"
          value={revelado.lut ?? ''}
          onChange={(e) => cambiar((r) => ({ ...r, lut: e.target.value || null }))}
          onContextMenu={elegido ? abrirMenu(elegido.id) : undefined}
          title={elegido ? 'Clic derecho: cambiarle el nombre o quitarlo de la biblioteca' : undefined}
        >
          <option value="">Ninguna</option>
          {luts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nombre}
            </option>
          ))}
          {revelado.lut && !elegido && <option value={revelado.lut}>(ya no está en la biblioteca)</option>}
        </select>
        <button className="btn small" onClick={() => void importar()}>
          <Upload size={14} /> Importar .cube…
        </button>
      </div>
      {lutActual === 'falta' && <div className="small aviso-texto">Este LUT ya no está en tu biblioteca: la foto se ve sin él.</div>}
      {!luts.length && <div className="small subtle">Los que importes se quedan guardados en ROOM.</div>}

      <Deslizador
        def={INTENSIDAD_LUT}
        valor={revelado.intensidadLut}
        inicio={reveladoNeutro().intensidadLut}
        desactivado={!revelado.lut}
        onChange={(v) => cambiar((r) => ({ ...r, intensidadLut: v }))}
      />

      <div className="lut-exportar">
        <button className="btn" disabled={!actual || exportando} onClick={() => void exportarLut()}>
          <Download size={15} /> {exportando ? 'Exportando…' : 'Exportar mi revelado como LUT…'}
        </button>
        <span className="small subtle">
          Guarda todo el color en un .cube para usarlo en otras apps. La textura, la claridad, la neblina, el grano, el halo, el viñeteado y el
          suavizado no caben en un LUT: viajan en los ajustes guardados.
        </span>
      </div>

      {menu && (
        <MenuContextual
          x={menu.x}
          y={menu.y}
          onCerrar={cerrarMenu}
          opciones={[
            {
              etiqueta: 'Cambiar el nombre…',
              icono: <Pencil size={15} strokeWidth={1.8} />,
              onElegir: () => setRenombrando({ id: menu.de, nombre: luts.find((l) => l.id === menu.de)?.nombre ?? '' })
            },
            {
              etiqueta: 'Quitar de la biblioteca',
              icono: <Trash2 size={15} strokeWidth={1.8} />,
              peligrosa: true,
              onElegir: () => setBorrando(menu.de)
            }
          ]}
        />
      )}

      {borrando && (
        <Confirm
          title="Quitar el LUT"
          message={`«${luts.find((l) => l.id === borrando)?.nombre}» se borra de la biblioteca de ROOM. El archivo original, si lo tienes, no se toca. Las fotos que lo usaban se verán sin él.`}
          confirmLabel="Quitar"
          destructive
          onCancel={() => setBorrando(null)}
          onConfirm={async () => {
            const id = borrando
            setBorrando(null)
            try {
              await window.room.luts.borrar(id)
              await recargarLuts()
              if (revelado.lut === id) cambiar((r) => ({ ...r, lut: null }))
            } catch (e) {
              fail(e)
            }
          }}
        />
      )}

      {renombrando && (
        <Modal
          title="Cambiar el nombre"
          estrecho
          onClose={() => setRenombrando(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRenombrando(null)}>
                Cancelar
              </button>
              <button
                className="btn primary"
                disabled={!renombrando.nombre.trim()}
                onClick={async () => {
                  try {
                    await window.room.luts.renombrar(renombrando.id, renombrando.nombre)
                    await recargarLuts()
                    setRenombrando(null)
                  } catch (e) {
                    fail(e)
                  }
                }}
              >
                Guardar
              </button>
            </>
          }
        >
          <input
            className="input"
            autoFocus
            value={renombrando.nombre}
            onChange={(e) => setRenombrando({ ...renombrando, nombre: e.target.value })}
            aria-label="Nombre del LUT"
          />
        </Modal>
      )}
    </>
  )
}
