/**
 * Exportar: la foto revelada a tamaño completo, en JPEG o PNG, con los datos
 * de cámara del original.
 *
 * Se revela en el motor de trabajo, que no se ve, así que la pantalla sigue
 * como estaba mientras tanto. Nunca se pisa un archivo: si ya hay uno con ese
 * nombre, la nueva sale como «IMG_4127 (2).jpg».
 */
import { useEffect, useState, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { Field, Modal, Segmented, useAvisos, mensajeDeError } from 'casa/ui'
import { insertarExifJpeg, insertarExifPng } from '@shared/exif'
import type { Formato } from '@shared/tipos'
import { useStore, lutPorId, type Foto } from '../lib/store'
import { fotoDecodificada, motorTrabajo } from '../lib/motores'

type Alcance = 'esta' | 'todas'

async function codificar(pixeles: Uint8Array, ancho: number, alto: number, formato: Formato, calidad: number): Promise<Uint8Array> {
  const lienzo = new OffscreenCanvas(ancho, alto)
  lienzo.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixeles.buffer as ArrayBuffer), ancho, alto), 0, 0)
  const blob = await lienzo.convertToBlob(formato === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: calidad / 100 })
  return new Uint8Array(await blob.arrayBuffer())
}

async function exportarUna(f: Foto, carpeta: string, formato: Formato, calidad: number): Promise<string> {
  const m = motorTrabajo()
  const { fuente } = await fotoDecodificada(f.ruta)
  m.cargar(fuente)
  try {
    m.ponerLut(f.revelado.lut ? await lutPorId(f.revelado.lut) : null)
    const { ancho, alto, pixeles } = m.exportar(f.revelado)
    let datos = await codificar(pixeles, ancho, alto, formato, calidad)
    const exif = await window.room.exportar.exif(f.ruta, ancho, alto)
    if (exif) datos = formato === 'png' ? insertarExifPng(datos, exif) : insertarExifJpeg(datos, exif)
    return await window.room.exportar.escribir(carpeta, f.nombre, formato, datos)
  } finally {
    m.descargar()
  }
}

export function Exportar({ onClose }: { onClose: () => void }): ReactNode {
  const { fotos, actual, ajustes, cambiarAjustes } = useStore()
  const { fail } = useAvisos()
  const [carpeta, setCarpeta] = useState<string | null>(ajustes.carpetaExportar)
  const [alcance, setAlcance] = useState<Alcance>('esta')
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<{ rutas: string[]; fallos: string[] } | null>(null)

  useEffect(() => {
    if (!carpeta) void window.room.exportar.carpetaPorDefecto().then(setCarpeta)
  }, [carpeta])

  const listas = fotos.filter((f) => !f.leyendo && !f.error)
  const aExportar = alcance === 'esta' ? (actual && !actual.leyendo && !actual.error ? [actual] : []) : listas
  const ocupado = progreso !== null && resultado === null

  const empezar = async (): Promise<void> => {
    if (!carpeta || !aExportar.length) return
    setProgreso({ hechas: 0, total: aExportar.length })
    const rutas: string[] = []
    const fallos: string[] = []
    for (const f of aExportar) {
      try {
        rutas.push(await exportarUna(f, carpeta, ajustes.formato, ajustes.calidad))
      } catch (e) {
        fallos.push(`${f.nombre}: ${mensajeDeError(e)}`)
      }
      setProgreso((p) => (p ? { ...p, hechas: p.hechas + 1 } : p))
      // Que la ventana respire entre foto y foto.
      await new Promise((r) => setTimeout(r, 0))
    }
    setResultado({ rutas, fallos })
  }

  if (resultado) {
    const n = resultado.rutas.length
    return (
      <Modal
        title={n ? (n === 1 ? 'Foto exportada' : `${n} fotos exportadas`) : 'No se ha exportado nada'}
        onClose={onClose}
        footer={
          <>
            {n > 0 && (
              <button className="btn" onClick={() => void window.room.fotos.mostrar(resultado.rutas[0]).catch(fail)}>
                <FolderOpen size={15} /> Mostrar en la carpeta
              </button>
            )}
            <button className="btn primary" onClick={onClose}>
              Cerrar
            </button>
          </>
        }
      >
        {n > 0 && <p className="small">{n === 1 ? resultado.rutas[0] : `En ${carpeta}`}</p>}
        {resultado.fallos.map((f) => (
          <p key={f} className="small aviso-texto">
            {f}
          </p>
        ))}
      </Modal>
    )
  }

  return (
    <Modal
      title="Exportar"
      onClose={() => !ocupado && onClose()}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={ocupado}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => void empezar()} disabled={ocupado || !carpeta || !aExportar.length}>
            {ocupado && progreso ? `Exportando ${Math.min(progreso.hechas + 1, progreso.total)} de ${progreso.total}…` : 'Exportar'}
          </button>
        </>
      }
    >
      <div className="exportar">
        {listas.length > 1 && (
          <Field label="Qué">
            <Segmented
              value={alcance}
              options={[
                { value: 'esta', label: 'Esta foto' },
                { value: 'todas', label: `Todo el carrete (${listas.length})` }
              ]}
              onChange={setAlcance}
            />
          </Field>
        )}
        <Field label="Formato">
          <Segmented
            value={ajustes.formato}
            options={[
              { value: 'jpeg', label: 'JPEG' },
              { value: 'png', label: 'PNG' }
            ]}
            onChange={(v) => void cambiarAjustes({ formato: v })}
          />
        </Field>
        {ajustes.formato === 'jpeg' && (
          <Field label={`Calidad · ${ajustes.calidad}`} htmlFor="exportar-calidad">
            <input
              id="exportar-calidad"
              type="range"
              className="deslizador"
              min={60}
              max={100}
              step={1}
              value={ajustes.calidad}
              onChange={(e) => void cambiarAjustes({ calidad: Number(e.target.value) })}
            />
          </Field>
        )}
        <Field label="Carpeta" hint="Se exporta a tamaño completo, con los datos de cámara del original. Nunca se sustituye un archivo que ya exista.">
          <div className="exportar-carpeta">
            <span className="truncate mono small" title={carpeta ?? ''}>
              {carpeta ?? '…'}
            </span>
            <button
              className="btn small"
              disabled={ocupado}
              onClick={async () => {
                const c = await window.room.exportar.carpeta(carpeta)
                if (c) {
                  setCarpeta(c)
                  void cambiarAjustes({ carpetaExportar: c })
                }
              }}
            >
              Cambiar…
            </button>
          </div>
        </Field>
      </div>
    </Modal>
  )
}
