/**
 * La foto, revelada en vivo.
 *
 * El lienzo se ajusta al hueco que deja el panel, con los píxeles reales de la
 * pantalla (en una 4K al 150 % son 1,5 por cada píxel de la interfaz), y se
 * repinta en el siguiente fotograma cada vez que cambia algo del revelado.
 *
 * Sin herramienta, mantener pulsado el botón izquierdo sobre la foto enseña el
 * original; al soltar, vuelve el revelado. Con Recortar abierto se ve la foto
 * entera con el marco del recorte encima; con Eliminar, se pinta sobre ella.
 *
 * Los trazos de Eliminar los arregla un trabajador aparte; mientras, la foto
 * sigue como estaba y un aviso dice que se está rellenando.
 *
 * El zoom, como en Lightroom: un clic corto (o Z) pasa de encajar al 100 % en
 * el punto pulsado y vuelve; Ctrl + y Ctrl − van por pasos. Ampliada, se
 * arrastra para moverse; en Eliminar, con la barra espaciadora pulsada. En
 * Recortar siempre se ve entera. El 100 % es un píxel de la foto por cada
 * píxel de la pantalla, y solo se revela el trozo que se ve.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ImagePlus } from 'lucide-react'
import { EmptyState, useAvisos } from 'casa/ui'
import type { Mancha } from '@shared/revelado'
import type { Recorte } from '@shared/geometria'
import { Motor, type Fuente } from '../motor/motor'
import { fotoDecodificada, miniatura, motorVista, ponerMotorVista } from '../lib/motores'
import { aberracionDe, claveManchas, fuenteAutomatica, parchesDe } from '../lib/curar'
import { useStore } from '../lib/store'
import { CapaRecorte } from './CapaRecorte'
import { CapaEliminar } from './CapaEliminar'

const PULSACION_LARGA_MS = 250
/** Los pasos del zoom: píxeles de pantalla por píxel de la foto. */
const NIVELES = [0.25, 0.5, 1, 2, 4]
const ENTERA: Recorte = { x: 0, y: 0, w: 1, h: 1 }

export function Visor({ alAbrir }: { alAbrir: () => void }): ReactNode {
  const { actual, fotos, lutActual, ponerMiniatura, herramienta, cambiar, pincel, manchaSel, elegirMancha, regla, ponerRegla } = useStore()
  const { fail } = useAvisos()
  const hueco = useRef<HTMLDivElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const [motor, setMotor] = useState<Motor | null>(null)
  const [errorMotor, setErrorMotor] = useState<string | null>(null)
  const [cargada, setCargada] = useState<string | null>(null)
  const fuente = useRef<Fuente | null>(null)
  const [decodificando, setDecodificando] = useState(false)
  const [tam, setTam] = useState({ ancho: 0, alto: 0 })
  const [antes, setAntes] = useState(false)
  const pulsacion = useRef<number | null>(null)
  // Sube cada vez que cambia lo que entra en el revelado (parches, aberración): hay que repintar.
  const [entrada, setEntrada] = useState(0)
  const [rellenando, setRellenando] = useState(false)
  // El zoom: null es encajar; si no, píxeles de pantalla por píxel de la foto. El centro, en fracciones.
  const [zoom, setZoom] = useState<number | null>(null)
  const [centro, setCentro] = useState({ x: 0.5, y: 0.5 })
  const [espacio, setEspacio] = useState(false)
  const gesto = useRef<{ x: number; y: number; movido: boolean; centro: { x: number; y: number }; pan: boolean } | null>(null)

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
      .then(({ fuente: f }) => {
        if (!vivo) return
        motor.cargar(f)
        fuente.current = f
        setCargada(ruta)
        setEntrada((n) => n + 1)
      })
      .catch((e) => vivo && fail(e))
      .finally(() => vivo && setDecodificando(false))
    return () => {
      vivo = false
    }
  }, [motor, ruta, fail])

  // Otra foto: encajada.
  useEffect(() => {
    setZoom(null)
    setCentro({ x: 0.5, y: 0.5 })
  }, [ruta])

  const revelado = actual?.revelado
  const lista = !!motor && cargada === ruta && !!ruta && !!revelado
  const verMarco = herramienta === 'recortar'

  // Los trazos de Eliminar: el trabajador hace los parches y se pegan en la foto.
  const manchas = revelado?.manchas
  const clave = manchas ? claveManchas(manchas) : ''
  useEffect(() => {
    if (!lista || !motor || !ruta || !fuente.current || !manchas) return
    if (motor.parchesPuestos === clave) return
    if (!clave) {
      motor.ponerParches(null, '')
      setEntrada((n) => n + 1)
      return
    }
    let vivo = true
    setRellenando(true)
    parchesDe(ruta, fuente.current, manchas)
      .then((p) => {
        if (!vivo) return
        motor.ponerParches(p, clave)
        setEntrada((n) => n + 1)
      })
      .catch((e) => vivo && fail(e))
      .finally(() => vivo && setRellenando(false))
    return () => {
      vivo = false
    }
    // `manchas` va dentro de `clave`; `cargada`, porque cargar otra vez la foto quita los parches.
  }, [lista, motor, ruta, clave, cargada, fail])

  // La aberración se mide una vez por foto, cuando se pide.
  const conAberracion = !!revelado?.aberracion
  useEffect(() => {
    if (!lista || !motor || !conAberracion || !fuente.current) return
    const f = fuente.current
    // Un respiro para que la casilla se marque antes de ponerse a medir.
    const t = window.setTimeout(() => {
      try {
        motor.ponerAberracion(aberracionDe(f))
        setEntrada((n) => n + 1)
      } catch (e) {
        fail(e)
      }
    }, 30)
    return () => window.clearTimeout(t)
  }, [lista, motor, conAberracion, cargada, fail])

  const medidas = lista && revelado ? motor.medidasSalida(revelado, verMarco) : null

  // Dónde y a qué tamaño va la foto dentro del hueco.
  const margen = 32
  const dpr = devicePixelRatio
  let css = { ancho: 0, alto: 0 }
  // Píxeles de pantalla (de verdad) por píxel de la foto al encajar.
  let encajar = 1
  let ventana = ENTERA
  const ampliable = herramienta !== 'recortar'
  if (medidas && tam.ancho > 0) {
    const k = Math.min((tam.ancho - margen * 2) / medidas.ancho, (tam.alto - margen * 2) / medidas.alto, 1 / dpr)
    encajar = k * dpr
    if (ampliable && zoom !== null && zoom > encajar) {
      // Ampliada: el lienzo ocupa el hueco y enseña el trozo de la foto que cabe.
      const totalW = (medidas.ancho * zoom) / dpr
      const totalH = (medidas.alto * zoom) / dpr
      css = { ancho: Math.max(1, Math.floor(Math.min(totalW, tam.ancho))), alto: Math.max(1, Math.floor(Math.min(totalH, tam.alto))) }
      const w = css.ancho / totalW
      const h = css.alto / totalH
      ventana = { x: Math.min(1 - w, Math.max(0, centro.x - w / 2)), y: Math.min(1 - h, Math.max(0, centro.y - h / 2)), w, h }
    } else {
      css = { ancho: Math.max(1, Math.floor(medidas.ancho * k)), alto: Math.max(1, Math.floor(medidas.alto * k)) }
    }
  }
  const conZoom = ventana !== ENTERA
  const nivel = conZoom && zoom !== null ? zoom : encajar

  /** Cambiar el zoom, con el punto (en fracciones de la foto revelada) que debe quedar en el centro. */
  const ampliar = useCallback((z: number | null, c?: { x: number; y: number }) => {
    setZoom(z)
    if (c) setCentro({ x: Math.min(1, Math.max(0, c.x)), y: Math.min(1, Math.max(0, c.y)) })
  }, [])

  // El punto de la foto bajo el puntero.
  const puntoEn = (e: { clientX: number; clientY: number }, el: Element): { x: number; y: number } => {
    const r = el.getBoundingClientRect()
    return { x: ventana.x + ((e.clientX - r.left) / r.width) * ventana.w, y: ventana.y + ((e.clientY - r.top) / r.height) * ventana.h }
  }

  // Las teclas del zoom: Z, Ctrl + y Ctrl −; y la barra espaciadora para moverse en Eliminar.
  const vivo = useRef({ conZoom, nivel, encajar, ventana, ampliable, lista })
  vivo.current = { conZoom, nivel, encajar, ventana, ampliable, lista }
  useEffect(() => {
    const enFormulario = (t: EventTarget | null): boolean =>
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
    const abajo = (e: KeyboardEvent): void => {
      const v = vivo.current
      if (!v.lista || !v.ampliable || e.altKey || e.metaKey || document.querySelector('.overlay')) return
      if (enFormulario(e.target)) return
      const centroVista = { x: v.ventana.x + v.ventana.w / 2, y: v.ventana.y + v.ventana.h / 2 }
      const k = e.key
      if (!e.ctrlKey && !e.shiftKey && (k === 'z' || k === 'Z') && !e.repeat) {
        e.preventDefault()
        ampliar(v.conZoom ? null : 1, centroVista)
      } else if (e.ctrlKey && (k === '+' || k === '=')) {
        e.preventDefault()
        const sig = NIVELES.find((n) => n > v.nivel + 1e-6)
        if (sig) ampliar(sig, centroVista)
      } else if (e.ctrlKey && (k === '-' || k === '_')) {
        e.preventDefault()
        const ant = [...NIVELES].reverse().find((n) => n < v.nivel - 1e-6)
        ampliar(ant && ant > v.encajar + 1e-6 ? ant : null, centroVista)
      } else if (k === ' ' && !e.ctrlKey) {
        if (e.target instanceof HTMLButtonElement) return
        e.preventDefault()
        setEspacio(true)
      }
    }
    const arriba = (e: KeyboardEvent): void => {
      if (e.key === ' ') setEspacio(false)
    }
    const fuera = (): void => setEspacio(false)
    window.addEventListener('keydown', abajo)
    window.addEventListener('keyup', arriba)
    window.addEventListener('blur', fuera)
    return () => {
      window.removeEventListener('keydown', abajo)
      window.removeEventListener('keyup', arriba)
      window.removeEventListener('blur', fuera)
    }
  }, [ampliar])

  /** Arrastrar para moverse por la foto ampliada. */
  const desplazar = (e: React.PointerEvent): void => {
    const g = gesto.current
    if (!g || !conZoom) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    setCentro({
      x: Math.min(1 - ventana.w / 2, Math.max(ventana.w / 2, g.centro.x - (dx / css.ancho) * ventana.w)),
      y: Math.min(1 - ventana.h / 2, Math.max(ventana.h / 2, g.centro.y - (dy / css.alto) * ventana.h))
    })
  }

  // Pintar en el siguiente fotograma: varios cambios seguidos se quedan en uno.
  const lut = lutActual && lutActual !== 'falta' ? lutActual : null
  const conAntes = antes && !herramienta
  useEffect(() => {
    if (!lista || !revelado || !motor || css.ancho === 0) return
    const id = requestAnimationFrame(() => {
      try {
        motor.ponerLut(lut)
        motor.pintar(revelado, Math.round(css.ancho * dpr), Math.round(css.alto * dpr), conAntes, verMarco, ventana)
      } catch (e) {
        fail(e)
      }
    })
    return () => cancelAnimationFrame(id)
    // La ventana va por sus números: es un objeto nuevo en cada pintada.
  }, [lista, revelado, lut, conAntes, verMarco, css.ancho, css.alto, motor, fail, entrada, dpr, ventana.x, ventana.y, ventana.w, ventana.h])

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
  }, [lista, revelado, lut, idActual, ponerMiniatura, entrada])

  const soltar = (): void => {
    if (pulsacion.current !== null) window.clearTimeout(pulsacion.current)
    pulsacion.current = null
    setAntes(false)
  }

  const fuenteDe = useCallback(
    (m: Pick<Mancha, 'puntos' | 'tamano' | 'desvanecer'>) => (fuente.current ? fuenteAutomatica(fuente.current, m) : { dx: 0.05, dy: 0 }),
    []
  )

  const cargando = !!actual && (actual.leyendo || decodificando || cargada !== ruta) && !actual.error

  const porcentaje = `${Math.round(nivel * 100)} %`
  let pie = conZoom
    ? `${porcentaje} · arrastra para moverte · clic para encajar · mantén pulsada para ver el original`
    : 'Clic para ampliar al 100 % · mantén pulsada para ver el original'
  if (conAntes) pie = 'Antes: la foto sin revelar'
  else if (herramienta === 'recortar')
    pie = regla
      ? 'Traza una línea sobre algo que deba quedar recto: el horizonte, una pared'
      : 'Arrastra las esquinas o los bordes para recortar · dentro del marco, para moverlo · fuera, para enderezar'
  else if (herramienta === 'eliminar')
    pie = rellenando
      ? 'Rellenando…'
      : `${conZoom ? `${porcentaje} · espacio y arrastrar para moverte · ` : 'Z para ampliar · '}pinta sobre lo que sobre · arrastra un trazo para moverlo · clic derecho para borrarlo`

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
        className={`visor-foto${herramienta ? ' con-herramienta' : ''}${herramienta === 'recortar' ? ' recortando' : ''}${conZoom ? ' ampliada' : ''}`}
        style={{
          width: css.ancho,
          height: css.alto,
          visibility: lista && !actual?.error ? 'visible' : 'hidden'
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || herramienta) return
          e.currentTarget.setPointerCapture(e.pointerId)
          gesto.current = { x: e.clientX, y: e.clientY, movido: false, centro: { x: ventana.x + ventana.w / 2, y: ventana.y + ventana.h / 2 }, pan: false }
          if (pulsacion.current !== null) window.clearTimeout(pulsacion.current)
          pulsacion.current = window.setTimeout(() => {
            pulsacion.current = null
            if (!gesto.current?.movido) setAntes(true)
          }, PULSACION_LARGA_MS)
        }}
        onPointerMove={(e) => {
          const g = gesto.current
          if (!g || herramienta) return
          if (!g.movido && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) {
            g.movido = true
            if (pulsacion.current !== null) window.clearTimeout(pulsacion.current)
            pulsacion.current = null
          }
          if (g.movido && !antes) desplazar(e)
        }}
        onPointerUp={(e) => {
          const g = gesto.current
          gesto.current = null
          // Un clic corto: ampliar al 100 % en ese punto, o volver a encajar.
          if (g && !herramienta && !g.movido && pulsacion.current !== null) ampliar(conZoom ? null : 1, conZoom ? undefined : puntoEn(e, e.currentTarget))
          soltar()
        }}
        onPointerLeave={() => !gesto.current && soltar()}
        onPointerCancel={() => {
          gesto.current = null
          soltar()
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={lienzo} style={{ width: css.ancho, height: css.alto }} />
        {lista && actual && revelado && herramienta === 'recortar' && (
          <CapaRecorte g={revelado.geometria} ancho={actual.ancho} alto={actual.alto} cambiar={cambiar} regla={regla} ponerRegla={ponerRegla} />
        )}
        {lista && actual && revelado && herramienta === 'eliminar' && (
          <CapaEliminar
            revelado={revelado}
            ancho={actual.ancho}
            alto={actual.alto}
            css={css}
            ventana={ventana}
            cambiar={cambiar}
            pincel={pincel}
            manchaSel={manchaSel}
            elegirMancha={elegirMancha}
            fuenteDe={fuenteDe}
          />
        )}
        {herramienta === 'eliminar' && espacio && conZoom && (
          <div
            className="capa capa-mano"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              gesto.current = { x: e.clientX, y: e.clientY, movido: true, centro: { x: ventana.x + ventana.w / 2, y: ventana.y + ventana.h / 2 }, pan: true }
            }}
            onPointerMove={(e) => {
              if (gesto.current?.pan) desplazar(e)
            }}
            onPointerUp={() => {
              gesto.current = null
            }}
          />
        )}
        {conAntes && <span className="visor-antes">Antes</span>}
      </div>
      {lista && !actual?.error && <div className="visor-pie">{pie}</div>}
      {(cargando || (rellenando && herramienta !== 'eliminar')) && (
        <div className="visor-cargando">
          <div className="spinner" />
        </div>
      )}
    </div>
  )
}
