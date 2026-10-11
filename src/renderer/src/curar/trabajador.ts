/**
 * El trabajador de Eliminar: hace los parches fuera de la ventana, para que
 * rellenar algo grande no la congele.
 *
 * Se queda con las dos últimas fotos y, de cada una, con los parches ya
 * hechos: al añadir un trazo solo se calcula ese; al cambiar o borrar uno, se
 * rehace desde él en adelante (los de antes no han cambiado).
 */
import { curarMancha, pegar, type Imagen, type Parche } from '@shared/curar'
import type { Mancha } from '@shared/revelado'

interface Foto {
  original: Imagen
  /** La foto con los parches de `hechos` ya pegados. */
  trabajo: Imagen
  hechos: Array<{ clave: string; parche: Parche | null }>
}

export type Peticion =
  | { tipo: 'imagen'; clave: string; ancho: number; alto: number; datos: Uint8ClampedArray }
  | { tipo: 'curar'; id: number; clave: string; manchas: Mancha[] }

export type Respuesta = { id: number; parches: Parche[] } | { id: number; error: string; sinImagen?: boolean }

const fotos = new Map<string, Foto>()
const CABEN = 2

function copia(img: Imagen): Imagen {
  return { ancho: img.ancho, alto: img.alto, datos: new Uint8ClampedArray(img.datos) }
}

function curar(f: Foto, manchas: Mancha[]): Parche[] {
  // Hasta dónde vale lo ya hecho: mientras los trazos (y todos los de antes) sean los mismos.
  let clave = ''
  const claves = manchas.map((m) => (clave += JSON.stringify(m)))
  let iguales = 0
  while (iguales < f.hechos.length && iguales < claves.length && f.hechos[iguales].clave === claves[iguales]) iguales++
  if (iguales < f.hechos.length) {
    // Algo cambió por en medio: se vuelve a la foto tal cual y se pegan los que siguen valiendo.
    f.trabajo = copia(f.original)
    f.hechos = f.hechos.slice(0, iguales)
    for (const h of f.hechos) if (h.parche) pegar(f.trabajo, h.parche)
  }
  for (let i = iguales; i < manchas.length; i++) {
    const parche = curarMancha(f.trabajo, manchas[i])
    if (parche) pegar(f.trabajo, parche)
    f.hechos.push({ clave: claves[i], parche })
  }
  return f.hechos.map((h) => h.parche).filter((p): p is Parche => p !== null)
}

self.onmessage = (e: MessageEvent<Peticion>) => {
  const p = e.data
  if (p.tipo === 'imagen') {
    const original = { ancho: p.ancho, alto: p.alto, datos: p.datos }
    fotos.delete(p.clave)
    fotos.set(p.clave, { original, trabajo: copia(original), hechos: [] })
    while (fotos.size > CABEN) fotos.delete(fotos.keys().next().value as string)
    return
  }
  const f = fotos.get(p.clave)
  if (!f) {
    self.postMessage({ id: p.id, error: 'Sin foto', sinImagen: true } satisfies Respuesta)
    return
  }
  // La más reciente al final: es la que se queda.
  fotos.delete(p.clave)
  fotos.set(p.clave, f)
  try {
    self.postMessage({ id: p.id, parches: curar(f, p.manchas) } satisfies Respuesta)
  } catch (err) {
    self.postMessage({
      id: p.id,
      error: err instanceof Error ? err.message : String(err)
    } satisfies Respuesta)
  }
}
