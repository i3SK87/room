import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Revelado } from '@shared/revelado'
import type { Ajustes, FotoLeida, Formato, Guardado, LutInfo } from '@shared/tipos'

interface Sobre<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Desempaqueta la respuesta del proceso principal y convierte el fallo en una excepción normal. */
async function llamar<T>(canal: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(canal, ...args)) as Sobre<T>
  if (!r?.ok) throw new Error(r?.error ?? 'Error desconocido')
  return r.data as T
}

const api = {
  fotos: {
    elegir: () => llamar<string[]>('fotos:elegir'),
    leer: (ruta: string) => llamar<FotoLeida>('fotos:leer', ruta),
    recordar: (ruta: string, revelado: Revelado | null) => llamar<void>('fotos:recordar', ruta, revelado),
    mostrar: (ruta: string) => llamar<void>('fotos:mostrar', ruta),
    /** La ruta de un archivo soltado sobre la ventana. */
    rutaDe: (archivo: File) => webUtils.getPathForFile(archivo),
    /** Las que llegan con «Abrir con ROOM». Devuelve la función que deja de escuchar. */
    alAbrir: (fn: (rutas: string[]) => void) => {
      const envoltorio = (_e: IpcRendererEvent, rutas: string[]): void => fn(rutas)
      ipcRenderer.on('fotos:abrir', envoltorio)
      return () => {
        ipcRenderer.removeListener('fotos:abrir', envoltorio)
      }
    }
  },
  exportar: {
    carpeta: (actual: string | null) => llamar<string | null>('exportar:carpeta', actual),
    carpetaPorDefecto: () => llamar<string>('exportar:carpetaPorDefecto'),
    exif: (ruta: string, ancho: number, alto: number) => llamar<Uint8Array | null>('exportar:exif', ruta, ancho, alto),
    escribir: (carpeta: string, original: string, formato: Formato, datos: Uint8Array) =>
      llamar<string>('exportar:escribir', carpeta, original, formato, datos)
  },
  guardados: {
    lista: () => llamar<Guardado[]>('guardados:lista'),
    existe: (nombre: string) => llamar<boolean>('guardados:existe', nombre),
    guardar: (nombre: string, revelado: Revelado) => llamar<Guardado>('guardados:guardar', nombre, revelado),
    borrar: (id: string) => llamar<void>('guardados:borrar', id)
  },
  luts: {
    lista: () => llamar<LutInfo[]>('luts:lista'),
    importar: () => llamar<{ anadidos: LutInfo[]; fallos: string[] }>('luts:importar'),
    leer: (id: string) => llamar<string>('luts:leer', id),
    renombrar: (id: string, nombre: string) => llamar<void>('luts:renombrar', id, nombre),
    borrar: (id: string) => llamar<void>('luts:borrar', id),
    exportar: (nombre: string, texto: string) => llamar<string | null>('luts:exportar', nombre, texto)
  },
  ajustes: {
    leer: () => llamar<Ajustes>('ajustes:leer'),
    cambiar: (cambios: Partial<Ajustes>) => llamar<Ajustes>('ajustes:cambiar', cambios)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('room', api)
