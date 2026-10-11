/**
 * La foto, revelada en vivo.
 *
 * El lienzo se ajusta al hueco que deja el panel, con los píxeles reales de la
 * pantalla (en una 4K al 150 % son 1,5 por cada píxel de la interfaz), y se
 * repinta en el siguiente fotograma cada vez que cambia algo del revelado.
 *
 * Mantener pulsado el botón izquierdo sobre la foto enseña el original; al
 * soltar, vuelve el revelado. Un clic corto no hace nada.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ImagePlus } from 'lucide-react'
import { EmptyState, useAvisos } from 'casa/ui'
import { Motor } from '../motor/motor'
import { fotoDecodificada, miniatura, motorVista, ponerMotorVista } from '../lib/motores'
import { useStore } from '../lib/store'

const PULSACION_LARGA_MS = 250

export function Visor({ alAbrir }: { alAbrir: () => void }): ReactNode {
  const { actual, fotos, lutActual, ponerMiniatura } = useStore()
  const { fail } = useAvisos()
  const hueco = useRef<HTMLDivElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const [motor, setMotor] = useState<Motor | null>(null)
  const [errorMotor, setErrorMotor] = useState<string | null>(null)
  const [cargada, setCargada] = useState<string | null>(null)
  const [decodificando, setDecodificando] = useState(false)
  const [tam, setTam] = useState({ ancho: 0, alto: 0 })
  const [antes, setAntes] = useState(false)
  const pulsacion = useRef<number | null>(null)

  // El motor nace con el lienzo y muere con él.
  useLayoutEffect(() => {
    if (!lienzo.current) return
    try {
      const m = new Motor(lienzo.current)
      ponerMotorVista(m)
      setMotor(m)
    } catch (e) {
      setErrorMotor(e instanceof Error ? e.message : String(e))
    }
    return () => ponerMotorVista(null)
  }, [])

  // Lo que mide el hueco.
  useEffect(() => {
    const el = hueco.current
    if (!el) return
    const obs = new ResizeObserver(([e]) => setTam({ ancho: e.contentRect.width, alto: e.contentRect.height }))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // La foto que toca, a la tarjeta gráfica.
  const ruta = actual && !actual.leyendo && !actual.error ? actual.ruta : null
  useEffect(() => {
    if (!motor || !ruta) return
    let vivo = true
    setDecodificando(true)
    fotoDecodificada(ruta)
      .then(({ fuente }) => {
        if (!vivo) return
        motor.cargar(fuente)
        setCargada(ruta)
      })
      .catch((e) => vivo && fail(e))
      .finally(() => vivo && setDecodificando(false))
    return () => {
      vivo = false
    }
  }, [motor, ruta, fail])

  const medidas = motor?.medidas
  const lista = motor && cargada === ruta && !!medidas

  // Dónde y a qué tamaño va la foto dentro del hueco.
  const margen = 32
  let css = { ancho: 0, alto: 0 }
  if (lista && medidas && tam.ancho > 0) {
    const k = Math.min((tam.ancho - margen * 2) / medidas.ancho, (tam.alto - margen * 2) / medidas.alto, 1 / devicePixelRatio)
    css = { ancho: Math.max(1, Math.floor(medidas.ancho * k)), alto: Math.max(1, Math.floor(medidas.alto * k)) }
  }

  // Pintar en el siguiente fotograma: varios cambios seguidos se quedan en uno.
  const revelado = actual?.revelado
  const lut = lutActual && lutActual !== 'falta' ? lutActual : null
  useEffect(() => {
    if (!lista || !revelado || !motor || css.ancho === 0) return
    const id = requestAnimationFrame(() => {
      try {
        motor.ponerLut(lut)
        const dpr = devicePixelRatio
        motor.pintar(revelado, Math.round(css.ancho * dpr), Math.round(css.alto * dpr), antes)
      } catch (e) {
        fail(e)
      }
    })
    return () => cancelAnimationFrame(id)
  }, [lista, revelado, lut, antes, css.ancho, css.alto, motor, fail])

  // La miniatura del carrete sigue al revelado, sin prisa.
  const idActual = actual?.id
  useEffect(() => {
    if (!lista || !revelado || !idActual) return
    const t = window.setTimeout(() => {
      const m = motorVista()
      if (!m) return
      try {
        m.ponerLut(lut)
        ponerMiniatura(idActual, miniatura(m, revelado))
      } catch {
        // La miniatura es lo de menos.
      }
    }, 700)
    return () => window.clearTimeout(t)
  }, [lista, revelado, lut, idActual, ponerMiniatura])

  const soltar = (): void => {
    if (pulsacion.current !== null) window.clearTimeout(pulsacion.current)
    pulsacion.current = null
    setAntes(false)
  }

  const cargando = !!actual && (actual.leyendo || decodificando || cargada !== ruta) && !actual.error

  return (
    <div className="visor" ref={hueco}>
      {errorMotor && <EmptyState icono={<ImagePlus size={24} strokeWidth={1.8} />} title="No se puede revelar" message={errorMotor} />}
      {!errorMotor && fotos.length === 0 && (
        <EmptyState
          icono={<ImagePlus size={24} strokeWidth={1.8} />}
          title="Abre tus fotos"
          message="HEIC, JPEG o PNG. También puedes arrastrarlas a la ventana."
          action={
            <button className="btn primary" onClick={alAbrir}>
              Abrir fotos…
            </button>
          }
        />
      )}
      {actual?.error && <EmptyState icono={<ImagePlus size={24} strokeWidth={1.8} />} title="No se ha podido abrir" message={actual.error} />}
      <div
        className="visor-foto"
        style={{ width: css.ancho, height: css.alto, visibility: lista && !actual?.error ? 'visible' : 'hidden' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (pulsacion.current !== null) window.clearTimeout(pulsacion.current)
          pulsacion.current = window.setTimeout(() => setAntes(true), PULSACION_LARGA_MS)
        }}
        onPointerUp={soltar}
        onPointerLeave={soltar}
        onPointerCancel={soltar}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={lienzo} style={{ width: css.ancho, height: css.alto }} />
        {antes && <span className="visor-antes">Antes</span>}
      </div>
      {lista && !actual?.error && (
        <div className="visor-pie">{antes ? 'Antes: la foto tal y como salió del iPhone' : 'Mantén pulsada la foto para ver el original'}</div>
      )}
      {cargando && (
        <div className="visor-cargando">
          <div className="spinner" />
        </div>
      )}
    </div>
  )
}
