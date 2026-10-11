/**
 * Exportar: la foto revelada —recortada y con lo eliminado ya quitado— a
 * tamaño completo o con el lado largo que se diga, en JPEG o PNG, con los
 * datos de cámara del original. Nunca se amplía.
 *
 * Se revela en el motor de trabajo, que no se ve, así que la pantalla sigue
 * como estaba mientras tanto. Nunca se pisa un archivo: si ya hay uno con ese
 * nombre, la nueva sale como «IMG_4127 (2).jpg».
 */
import { useEffect, useState, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { Field, Modal, Segmented, useAvisos, mensajeDeError } from 'casa/ui'
import { insertarExifJpeg, insertarExifPng } from '@shared/exif'
import { medidasSalida } from '@shared/geometria'
import type { Ajustes, Formato } from '@shared/tipos'
import { useStore, lutPorId, type Foto } from '../lib/store'
import { fotoDecodificada, motorTrabajo } from '../lib/motores'
import { aberracionDe, claveManchas, parchesDe } from '../lib/curar'

type Alcance = 'esta' | 'todas'

async function codificar(pixeles: Uint8Array, ancho: number, alto: number, formato: Formato, calidad: number): Promise<Uint8Array> {
  const lienzo = new OffscreenCanvas(ancho, alto)
  lienzo.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixeles.buffer as ArrayBuffer), ancho, alto), 0, 0)
  const blob = await lienzo.convertToBlob(formato === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: calidad / 100 })
  return new Uint8Array(await blob.arrayBuffer())
}

/** Lo que medirá la foto exportada. */
function medidasDe(f: Foto, ajustes: Ajustes): { ancho: number; alto: number } {
  const m = medidasSalida(f.revelado.geometria, f.ancho, f.alto)
  const k = ajustes.tamano === 'lado' ? Math.min(1, ajustes.lado / Math.max(m.ancho, m.alto)) : 1
  return { ancho: Math.max(1, Math.round(m.ancho * k)), alto: Math.max(1, Math.round(m.alto * k)) }
}

async function exportarUna(f: Foto, carpeta: string, formato: Formato, calidad: number, lado: number | null): Promise<string> {
  const m = motorTrabajo()
  const { fuente } = await fotoDecodificada(f.ruta)
  // Si otra petición la deja atrás (la vista pidiendo a la vez), se vuelve a pedir: estos trazos son los que valen.
  let parches = await parchesDe(f.ruta, fuente, f.revelado.manchas)
  while (parches === null) parches = await parchesDe(f.ruta, fuente, f.revelado.manchas)
  m.cargar(fuente)
  try {
    m.ponerParches(parches, claveManchas(f.revelado.manchas))
    if (f.revelado.aberracion) m.ponerAberracion(aberracionDe(fuente))
    m.ponerLut(f.revelado.lut ? await lutPorId(f.revelado.lut) : null)
    const { ancho, alto, pixeles } = m.exportar(f.revelado, lado)
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

  const [lado, setLado] = useState(String(ajustes.lado))
  const guardarLado = (): void => {
    const n = Math.round(Number(lado))
    if (Number.isFinite(n) && n >= 200 && n <= 12000) void cambiarAjustes({ lado: n })
    else setLado(String(ajustes.lado))
  }

  const listas = fotos.filter((f) => !f.leyendo && !f.error)
  const aExportar = alcance === 'esta' ? (actual && !actual.leyendo && !actual.error ? [actual] : []) : listas
  const ocupado = progreso !== null && resultado === null
  const ajustesVivos = {
    ...ajustes,
    lado: Number(lado) >= 200 ? Math.round(Number(lado)) : ajustes.lado
  }
  let tamanoTexto = ''
  if (alcance === 'esta' && aExportar[0]) {
    const f = aExportar[0]
    const m = medidasDe(f, ajustesVivos)
    const entera = medidasSalida(f.revelado.geometria, f.ancho, f.alto)
    tamanoTexto = `Saldrá a ${m.ancho} × ${m.alto} px`
    if (ajustes.tamano === 'lado' && m.ancho === entera.ancho && m.alto === entera.alto && ajustesVivos.lado > Math.max(entera.ancho, entera.alto))
      tamanoTexto += ': la foto ya es más pequeña, y nunca se amplía'
  } else if (ajustes.tamano === 'lado') tamanoTexto = `Cada foto, con su lado largo en ${ajustesVivos.lado} px como mucho; nunca se amplía`
  else tamanoTexto = 'Cada foto, a su tamaño, con su recorte'

  const empezar = async (): Promise<void> => {
    if (!carpeta || !aExportar.length) return
    guardarLado()
    setProgreso({ hechas: 0, total: aExportar.length })
    const rutas: string[] = []
    const fallos: string[] = []
    for (const f of aExportar) {
      try {
        rutas.push(await exportarUna(f, carpeta, ajustes.formato, ajustes.calidad, ajustes.tamano === 'lado' ? ajustesVivos.lado : null))
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
        <Field label="Tamaño" hint={tamanoTexto}>
          <div className="col" style={{ gap: 8 }}>
            <Segmented
              value={ajustes.tamano}
              options={[
                { value: 'completo', label: 'Tamaño completo' },
                { value: 'lado', label: 'Lado largo' }
              ]}
              onChange={(v) => void cambiarAjustes({ tamano: v })}
            />
            {ajustes.tamano === 'lado' && (
              <div className="row exportar-lado">
                <label htmlFor="exportar-lado" className="small muted">
                  Lado largo
                </label>
                <input
                  id="exportar-lado"
                  className="input"
                  type="number"
                  min={200}
                  max={12000}
                  step={1}
                  value={lado}
                  onChange={(e) => setLado(e.target.value)}
                  onBlur={() => guardarLado()}
                  onKeyDown={(e) => e.key === 'Enter' && guardarLado()}
                />
                <span className="small muted">px</span>
              </div>
            )}
          </div>
        </Field>
        <Field
          label="Carpeta"
          hint="Con el recorte y lo eliminado ya aplicados, y los datos de cámara del original. Nunca se sustituye un archivo que ya exista."
        >
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
