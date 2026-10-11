/**
 * Traerse la versión nueva sin salir de ROOM, como BONK y CLAC.
 *
 * 20 segundos después de abrir se mira si en las releases de
 * `github.com/i3SK87/room` hay una más nueva; si la hay, sale un aviso bajo
 * Ajustes en la barra lateral, y **la descarga no empieza hasta que se pulsa**.
 * Bajada, se pregunta por el reinicio, y si se dice que no, se instala sola al
 * salir.
 *
 * El actualizador lee el «latest.yml» de la release, compara versiones y
 * comprueba que el sha512 de lo descargado es el que dice ese archivo. Sin
 * firma de código, esa es toda la garantía: que lo bajado es lo que se publicó.
 *
 * Es lo único que hace ROOM por internet, y se apaga en Ajustes. Apagado no
 * mira nada al abrir, pero «Buscar ahora» sigue mirando a mano. Nunca viaja
 * nada tuyo: solo se piden los archivos públicos de la release.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { EstadoActualizacion } from '@shared/tipos'

/** Abrir ya hace bastante; veinte segundos después no lo nota nadie. */
const PRIMERA = 20_000

let estado: EstadoActualizacion = { fase: 'ociosa', version: null, porcentaje: 0, comprobadaEn: null, mensaje: null }
let avisar: (nuevo: EstadoActualizacion) => void = () => {}

export function estadoActualizacion(): EstadoActualizacion {
  return estado
}

function poner(cambios: Partial<EstadoActualizacion>): void {
  estado = { ...estado, ...cambios }
  avisar(estado)
}

/** Lo que se le puede enseñar a alguien que no sabe qué es un ENOTFOUND. */
function legible(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET/.test(texto)) {
    return 'No se pudo conectar con GitHub. Puede que no haya internet ahora mismo.'
  }
  if (/404/.test(texto)) return 'La release publicada no lleva el archivo «latest.yml», que es lo que hay que comparar.'
  if (/sha512|checksum/i.test(texto)) return 'Lo descargado no cuadra con lo que decía la release. No se ha instalado nada.'
  return texto
}

/**
 * Deja el actualizador escuchando y programa la comprobación del arranque.
 * `buscarAlAbrir` es el ajuste, leído en el momento de mirar.
 */
export function iniciarActualizaciones(notificar: (e: EstadoActualizacion) => void, buscarAlAbrir: () => boolean): void {
  avisar = notificar
  // Sin empaquetar no hay nada que actualizar ni «app-update.yml» que leer.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => poner({ fase: 'buscando', mensaje: null }))
  autoUpdater.on('update-not-available', () =>
    poner({ fase: 'ociosa', version: null, porcentaje: 0, comprobadaEn: new Date().toISOString(), mensaje: null })
  )
  autoUpdater.on('update-available', (info) =>
    poner({ fase: 'disponible', version: info.version, porcentaje: 0, comprobadaEn: new Date().toISOString(), mensaje: null })
  )
  autoUpdater.on('download-progress', (p) => poner({ fase: 'descargando', porcentaje: Math.min(100, Math.round(p.percent)) }))
  autoUpdater.on('update-downloaded', (info) => poner({ fase: 'lista', version: info.version, porcentaje: 100, mensaje: null }))
  autoUpdater.on('error', (error) => {
    // Un fallo con la descarga ya hecha no retira el «lista para instalar».
    poner({ fase: estado.fase === 'lista' ? 'lista' : 'error', mensaje: legible(error) })
  })

  setTimeout(() => {
    if (!buscarAlAbrir()) return
    if (estado.fase === 'disponible' || estado.fase === 'descargando' || estado.fase === 'lista') return
    void buscarActualizacion()
  }, PRIMERA)
}

/** Mirar ahora mismo: el botón de Ajustes. No obedece al ajuste, que es solo el del arranque. */
export async function buscarActualizacion(): Promise<EstadoActualizacion> {
  if (!app.isPackaged) {
    poner({ fase: 'error', mensaje: 'Esta copia se ejecuta desde la carpeta del proyecto, no instalada: no hay nada que actualizar.' })
    return estado
  }
  // El fallo llega por el evento `error`, que ya deja el estado como toca.
  await autoUpdater.checkForUpdates().catch(() => undefined)
  return estado
}

/** Traérsela: el aviso de la barra lateral al pulsarlo. El progreso llega por los eventos. */
export function descargarActualizacion(): boolean {
  if (estado.fase !== 'disponible') return false
  poner({ fase: 'descargando', porcentaje: 0, mensaje: null })
  autoUpdater.downloadUpdate().catch(() => undefined)
  return true
}

/**
 * Cierra y vuelve a abrir ya actualizada, sin pasar otra vez por el asistente.
 * El `setImmediate` deja que la llamada del puente conteste antes de cerrar.
 */
export function instalarActualizacion(): boolean {
  if (estado.fase !== 'lista') return false
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
  return true
}
