/**
 * El estado de ROOM: el carrete, la foto que se mira, su revelado con su
 * historial, y lo que viene de la base de datos (ajustes guardados, LUT,
 * ajustes de la aplicación).
 *
 * El revelado cambia a cada movimiento de un deslizador, pero el historial y
 * el disco no: un cambio se «asienta» cuando se deja de tocar un momento. Así
 * Ctrl+Z deshace el gesto entero y no cada píxel del arrastre.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAvisos } from 'casa/ui'
import { estaTocado, reveladoNeutro, type ModoMancha, type Revelado } from '@shared/revelado'
import { leerCube, type Lut3D } from '@shared/cube'
import type { Ajustes, Guardado, LutInfo } from '@shared/tipos'
import { AJUSTES_DE_FABRICA } from '@shared/tipos'
import { fotoDecodificada, miniatura, motorTrabajo, olvidarFoto } from './motores'

export interface Foto {
  id: string
  ruta: string
  nombre: string
  resumen: string | null
  /** Lo que mide la foto tal cual (0 mientras se lee). */
  ancho: number
  alto: number
  miniatura: string | null
  revelado: Revelado
  /** Mientras se lee por primera vez. */
  leyendo: boolean
  error: string | null
}

interface Historial {
  atras: Revelado[]
  adelante: Revelado[]
  /** Lo último asentado: contra esto se compara para saber si hay algo nuevo. */
  asentado: Revelado
}

export type Herramienta = 'recortar' | 'eliminar'

/** Cómo pinta el pincel de Eliminar los trazos nuevos. */
export interface Pincel {
  modo: ModoMancha
  tamano: number
  desvanecer: number
  opacidad: number
}

interface Estado {
  /** La herramienta abierta encima de la foto, si hay alguna. */
  herramienta: Herramienta | null
  ponerHerramienta: (h: Herramienta | null) => void
  /** El trazo de Eliminar elegido: los controles del pincel lo cambian a él. */
  manchaSel: string | null
  elegirMancha: (id: string | null) => void
  pincel: Pincel
  cambiarPincel: (cambios: Partial<Pincel>) => void
  /** Recortar: trazar una línea sobre el horizonte para enderezar. */
  regla: boolean
  ponerRegla: (v: boolean) => void

  fotos: Foto[]
  actual: Foto | null
  seleccionar: (id: string) => void
  abrir: (rutas: string[]) => Promise<void>
  quitar: (id: string) => void
  /** Cambia el revelado de la foto que se mira. */
  cambiar: (fn: (r: Revelado) => Revelado) => void
  /** Como `cambiar`, pero se asienta ya: aplicar un ajuste guardado, restablecer… */
  sustituir: (r: Revelado) => void
  deshacer: () => void
  rehacer: () => void
  ponerMiniatura: (id: string, url: string) => void

  guardados: Guardado[]
  recargarGuardados: () => Promise<void>
  luts: LutInfo[]
  recargarLuts: () => Promise<void>
  /** El LUT del revelado actual, ya leído; `'falta'` si se borró de la biblioteca. */
  lutActual: Lut3D | 'falta' | null
  ajustes: Ajustes
  cambiarAjustes: (cambios: Partial<Ajustes>) => Promise<void>
}

const Contexto = createContext<Estado | null>(null)

const ASENTAR_MS = 450
const MAX_HISTORIAL = 100

const iguales = (a: Revelado, b: Revelado): boolean => JSON.stringify(a) === JSON.stringify(b)

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const { fail, toast } = useAvisos()
  const [fotos, setFotos] = useState<Foto[]>([])
  const [actualId, setActualId] = useState<string | null>(null)
  const [guardados, setGuardados] = useState<Guardado[]>([])
  const [luts, setLuts] = useState<LutInfo[]>([])
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_DE_FABRICA)
  const [lutActual, setLutActual] = useState<Lut3D | 'falta' | null>(null)
  const [herramienta, setHerramienta] = useState<Herramienta | null>(null)
  const [manchaSel, setManchaSel] = useState<string | null>(null)
  const [pincel, setPincel] = useState<Pincel>({
    modo: 'quitar',
    tamano: 0.02,
    desvanecer: 50,
    opacidad: 100
  })
  const [regla, setRegla] = useState(false)
  const ponerHerramienta = useCallback((h: Herramienta | null) => {
    setHerramienta(h)
    setManchaSel(null)
    setRegla(false)
  }, [])
  const cambiarPincel = useCallback((cambios: Partial<Pincel>) => setPincel((p) => ({ ...p, ...cambios })), [])

  // Lo que necesitan las funciones sin volver a crearse en cada cambio.
  const fotosRef = useRef(fotos)
  fotosRef.current = fotos
  const actualRef = useRef(actualId)
  actualRef.current = actualId
  const historiales = useRef(new Map<string, Historial>())
  const temporizador = useRef<number | null>(null)
  const lutsLeidos = useRef(new Map<string, Lut3D>())

  const actual = useMemo(() => fotos.find((f) => f.id === actualId) ?? null, [fotos, actualId])

  /* ---------- Cargar lo de la base de datos ---------- */

  const recargarGuardados = useCallback(async () => setGuardados(await window.room.guardados.lista()), [])
  const recargarLuts = useCallback(async () => setLuts(await window.room.luts.lista()), [])

  useEffect(() => {
    void window.room.ajustes.leer().then(setAjustes).catch(fail)
    void recargarGuardados().catch(fail)
    void recargarLuts().catch(fail)
  }, [fail, recargarGuardados, recargarLuts])

  const cambiarAjustes = useCallback(
    async (cambios: Partial<Ajustes>) => {
      setAjustes((a) => ({ ...a, ...cambios }))
      try {
        setAjustes(await window.room.ajustes.cambiar(cambios))
      } catch (e) {
        fail(e)
      }
    },
    [fail]
  )

  /* ---------- El LUT del revelado actual ---------- */

  const idLut = actual?.revelado.lut ?? null
  useEffect(() => {
    if (!idLut) {
      setLutActual(null)
      return
    }
    const hay = lutsLeidos.current.get(idLut)
    if (hay) {
      setLutActual(hay)
      return
    }
    let vivo = true
    window.room.luts
      .leer(idLut)
      .then((texto) => {
        const lut = leerCube(texto)
        lutsLeidos.current.set(idLut, lut)
        if (vivo) setLutActual(lut)
      })
      .catch(() => vivo && setLutActual('falta'))
    return () => {
      vivo = false
    }
  }, [idLut])

  /* ---------- Asentar: historial y disco ---------- */

  const recordar = useCallback((f: Foto) => {
    void window.room.fotos.recordar(f.ruta, estaTocado(f.revelado) ? f.revelado : null).catch(() => undefined)
  }, [])

  /** Mete en el historial lo que haya cambiado desde la última vez. */
  const asentar = useCallback(() => {
    if (temporizador.current !== null) {
      window.clearTimeout(temporizador.current)
      temporizador.current = null
    }
    for (const f of fotosRef.current) {
      const h = historiales.current.get(f.id)
      if (!h || iguales(h.asentado, f.revelado)) continue
      h.atras.push(h.asentado)
      if (h.atras.length > MAX_HISTORIAL) h.atras.shift()
      h.adelante = []
      h.asentado = f.revelado
      recordar(f)
    }
  }, [recordar])

  const programarAsentar = useCallback(() => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(asentar, ASENTAR_MS)
  }, [asentar])

  const ponerRevelado = useCallback((id: string, r: Revelado) => {
    setFotos((lista) => {
      const nueva = lista.map((f) => (f.id === id ? { ...f, revelado: r } : f))
      fotosRef.current = nueva
      return nueva
    })
  }, [])

  const cambiar = useCallback(
    (fn: (r: Revelado) => Revelado) => {
      const id = actualRef.current
      const f = fotosRef.current.find((x) => x.id === id)
      if (!f || f.leyendo) return
      ponerRevelado(f.id, fn(f.revelado))
      programarAsentar()
    },
    [ponerRevelado, programarAsentar]
  )

  const sustituir = useCallback(
    (r: Revelado) => {
      const id = actualRef.current
      if (!id) return
      ponerRevelado(id, r)
      asentar()
    },
    [ponerRevelado, asentar]
  )

  const moverHistorial = useCallback(
    (hacia: 'atras' | 'adelante') => {
      asentar()
      const id = actualRef.current
      const f = fotosRef.current.find((x) => x.id === id)
      const h = id ? historiales.current.get(id) : undefined
      if (!f || !h) return
      const pila = hacia === 'atras' ? h.atras : h.adelante
      const otra = hacia === 'atras' ? h.adelante : h.atras
      const r = pila.pop()
      if (!r) return
      otra.push(h.asentado)
      h.asentado = r
      ponerRevelado(f.id, r)
      recordar({ ...f, revelado: r })
    },
    [asentar, ponerRevelado, recordar]
  )

  const deshacer = useCallback(() => moverHistorial('atras'), [moverHistorial])
  const rehacer = useCallback(() => moverHistorial('adelante'), [moverHistorial])

  // Antes de cerrar, lo que quede por asentar va al disco.
  useEffect(() => {
    const alSalir = (): void => asentar()
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [asentar])

  /* ---------- El carrete ---------- */

  const ponerMiniatura = useCallback((id: string, url: string) => {
    setFotos((lista) => lista.map((f) => (f.id === id ? { ...f, miniatura: url } : f)))
  }, [])

  const seleccionar = useCallback(
    (id: string) => {
      asentar()
      setActualId(id)
      setManchaSel(null)
    },
    [asentar]
  )

  /** Lee una foto nueva del carrete: sus datos, su revelado de la última vez y su miniatura. */
  const preparar = useCallback(
    async (id: string, ruta: string) => {
      try {
        const { info, fuente } = await fotoDecodificada(ruta)
        const revelado = info.revelado ?? reveladoNeutro()
        historiales.current.set(id, { atras: [], adelante: [], asentado: revelado })
        let mini: string | null = null
        try {
          const m = motorTrabajo()
          m.cargar(fuente)
          if (revelado.lut) {
            const texto = await window.room.luts.leer(revelado.lut).catch(() => null)
            const lut = texto ? leerCube(texto) : null
            if (lut) lutsLeidos.current.set(revelado.lut, lut)
            m.ponerLut(lut)
          } else {
            m.ponerLut(null)
          }
          mini = miniatura(m, revelado)
          m.descargar()
        } catch {
          // Sin miniatura se vive: la foto se sigue pudiendo revelar.
        }
        setFotos((lista) =>
          lista.map((f) =>
            f.id === id
              ? {
                  ...f,
                  nombre: info.nombre,
                  resumen: info.resumen,
                  ancho: fuente.ancho,
                  alto: fuente.alto,
                  revelado,
                  miniatura: mini,
                  leyendo: false
                }
              : f
          )
        )
      } catch (e) {
        const mensaje = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
        setFotos((lista) => lista.map((f) => (f.id === id ? { ...f, leyendo: false, error: mensaje } : f)))
        toast(mensaje, 'error')
      }
    },
    [toast]
  )

  const abrir = useCallback(
    async (rutas: string[]) => {
      if (!rutas.length) return
      const yaEstan = new Set(fotosRef.current.map((f) => f.id))
      const nuevas: Foto[] = []
      for (const ruta of rutas) {
        const id = ruta.toLowerCase()
        if (yaEstan.has(id) || nuevas.some((n) => n.id === id)) continue
        const nombre = ruta.split(/[\\/]/).pop() ?? ruta
        nuevas.push({
          id,
          ruta,
          nombre,
          resumen: null,
          ancho: 0,
          alto: 0,
          miniatura: null,
          revelado: reveladoNeutro(),
          leyendo: true,
          error: null
        })
      }
      const primera = nuevas[0]?.id ?? rutas[0].toLowerCase()
      if (nuevas.length) {
        setFotos((lista) => {
          const nueva = [...lista, ...nuevas]
          fotosRef.current = nueva
          return nueva
        })
      }
      seleccionar(primera)
      // De una en una: decodificar varias a la vez solo se pelea por el mismo procesador.
      for (const n of nuevas) await preparar(n.id, n.ruta)
    },
    [preparar, seleccionar]
  )

  const quitar = useCallback(
    (id: string) => {
      asentar()
      const lista = fotosRef.current
      const i = lista.findIndex((f) => f.id === id)
      if (i < 0) return
      olvidarFoto(lista[i].ruta)
      historiales.current.delete(id)
      const nueva = lista.filter((f) => f.id !== id)
      setFotos(nueva)
      fotosRef.current = nueva
      if (actualRef.current === id) setActualId(nueva[Math.min(i, nueva.length - 1)]?.id ?? null)
    },
    [asentar]
  )

  const valor = useMemo<Estado>(
    () => ({
      herramienta,
      ponerHerramienta,
      manchaSel,
      elegirMancha: setManchaSel,
      pincel,
      cambiarPincel,
      regla,
      ponerRegla: setRegla,
      fotos,
      actual,
      seleccionar,
      abrir,
      quitar,
      cambiar,
      sustituir,
      deshacer,
      rehacer,
      ponerMiniatura,
      guardados,
      recargarGuardados,
      luts,
      recargarLuts,
      lutActual,
      ajustes,
      cambiarAjustes
    }),
    [
      herramienta,
      ponerHerramienta,
      manchaSel,
      pincel,
      cambiarPincel,
      regla,
      fotos,
      actual,
      seleccionar,
      abrir,
      quitar,
      cambiar,
      sustituir,
      deshacer,
      rehacer,
      ponerMiniatura,
      guardados,
      recargarGuardados,
      luts,
      recargarLuts,
      lutActual,
      ajustes,
      cambiarAjustes
    ]
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useStore(): Estado {
  const e = useContext(Contexto)
  if (!e) throw new Error('useStore necesita un StoreProvider por encima')
  return e
}

/** Para leer un LUT ya cargado al exportar otra foto que use uno distinto. */
export async function lutPorId(id: string): Promise<Lut3D | null> {
  try {
    return leerCube(await window.room.luts.leer(id))
  } catch {
    return null
  }
}
