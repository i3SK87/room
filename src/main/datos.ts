/**
 * Lo que ROOM recuerda, en `%APPDATA%\ROOM\room.db`.
 *
 * Las fotos no: se quedan donde estaban y ROOM no las toca nunca. Se guarda
 * el revelado de cada archivo —para que al volver a abrirlo siga como se dejó—,
 * los ajustes guardados, la biblioteca de LUT y los ajustes de la aplicación.
 * Los LUT importados se copian a `%APPDATA%\ROOM\luts`, así que siguen
 * funcionando aunque el original se borre o se mueva.
 */
import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sanear, type Revelado } from '@shared/revelado'
import { AJUSTES_DE_FABRICA, type Ajustes, type Guardado, type LutInfo } from '@shared/tipos'

let db: DatabaseSync | null = null

export function carpetaDatos(): string {
  return app.getPath('userData')
}

export function carpetaLuts(): string {
  const c = join(carpetaDatos(), 'luts')
  mkdirSync(c, { recursive: true })
  return c
}

function base(): DatabaseSync {
  if (db) return db
  mkdirSync(carpetaDatos(), { recursive: true })
  db = new DatabaseSync(join(carpetaDatos(), 'room.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revelados (
      ruta TEXT PRIMARY KEY,
      revelado TEXT NOT NULL,
      actualizado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS guardados (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
      revelado TEXT NOT NULL,
      creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS luts (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      tamano INTEGER NOT NULL,
      creado TEXT NOT NULL
    );
  `)
  return db
}

export function cerrarDatos(): void {
  db?.close()
  db = null
}

/* ---------- Ajustes ---------- */

export function leerAjustes(): Ajustes {
  const filas = base().prepare('SELECT clave, valor FROM ajustes').all() as unknown as Array<{ clave: string; valor: string }>
  const a: Ajustes = { ...AJUSTES_DE_FABRICA }
  for (const f of filas) {
    try {
      ;(a as unknown as Record<string, unknown>)[f.clave] = JSON.parse(f.valor)
    } catch {
      // Un valor estropeado se queda en el de fábrica.
    }
  }
  return a
}

export function cambiarAjustes(cambios: Partial<Ajustes>): Ajustes {
  const st = base().prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor')
  for (const [clave, valor] of Object.entries(cambios)) {
    if (!(clave in AJUSTES_DE_FABRICA)) continue
    st.run(clave, JSON.stringify(valor))
  }
  return leerAjustes()
}

/* ---------- El revelado de cada foto ---------- */

/** Las rutas se comparan sin mayúsculas: en Windows, «IMG_4127.HEIC» y «img_4127.heic» son el mismo archivo. */
function clave(ruta: string): string {
  return ruta.toLowerCase()
}

export function leerRevelado(ruta: string): Revelado | null {
  const f = base().prepare('SELECT revelado FROM revelados WHERE ruta = ?').get(clave(ruta)) as { revelado: string } | undefined
  if (!f) return null
  try {
    return sanear(JSON.parse(f.revelado))
  } catch {
    return null
  }
}

export function guardarRevelado(ruta: string, revelado: Revelado | null): void {
  if (!revelado) {
    base().prepare('DELETE FROM revelados WHERE ruta = ?').run(clave(ruta))
    return
  }
  base()
    .prepare(
      'INSERT INTO revelados (ruta, revelado, actualizado) VALUES (?, ?, ?) ON CONFLICT(ruta) DO UPDATE SET revelado = excluded.revelado, actualizado = excluded.actualizado'
    )
    .run(clave(ruta), JSON.stringify(sanear(revelado)), new Date().toISOString())
}

/* ---------- Ajustes guardados ---------- */

export function listaGuardados(): Guardado[] {
  const filas = base().prepare('SELECT id, nombre, revelado FROM guardados ORDER BY nombre COLLATE NOCASE').all() as unknown as Array<{
    id: string
    nombre: string
    revelado: string
  }>
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, revelado: sanear(safeParse(f.revelado)) }))
}

function safeParse(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** Guarda con ese nombre; si ya hay uno que se llama igual, lo sustituye. */
export function guardarAjuste(nombre: string, revelado: Revelado): Guardado {
  const limpio = nombre.trim()
  if (!limpio) throw new Error('Ponle un nombre')
  if (limpio.length > 60) throw new Error('El nombre es demasiado largo')
  const existente = base().prepare('SELECT id FROM guardados WHERE nombre = ?').get(limpio) as { id: string } | undefined
  const id = existente?.id ?? randomUUID()
  const datos = JSON.stringify(sanear(revelado))
  if (existente) base().prepare('UPDATE guardados SET nombre = ?, revelado = ? WHERE id = ?').run(limpio, datos, id)
  else base().prepare('INSERT INTO guardados (id, nombre, revelado, creado) VALUES (?, ?, ?, ?)').run(id, limpio, datos, new Date().toISOString())
  return { id, nombre: limpio, revelado: sanear(revelado) }
}

export function existeGuardado(nombre: string): boolean {
  return !!base().prepare('SELECT 1 FROM guardados WHERE nombre = ?').get(nombre.trim())
}

export function borrarGuardado(id: string): void {
  base().prepare('DELETE FROM guardados WHERE id = ?').run(id)
}

/* ---------- La biblioteca de LUT ---------- */

export function listaLuts(): LutInfo[] {
  return base().prepare('SELECT id, nombre, tamano, creado FROM luts ORDER BY nombre COLLATE NOCASE').all() as unknown as LutInfo[]
}

export function anadirLut(nombre: string, tamano: number): LutInfo {
  const info: LutInfo = { id: randomUUID(), nombre, tamano, creado: new Date().toISOString() }
  base().prepare('INSERT INTO luts (id, nombre, tamano, creado) VALUES (?, ?, ?, ?)').run(info.id, info.nombre, info.tamano, info.creado)
  return info
}

export function renombrarLut(id: string, nombre: string): void {
  const limpio = nombre.trim()
  if (!limpio) throw new Error('Ponle un nombre')
  base().prepare('UPDATE luts SET nombre = ? WHERE id = ?').run(limpio, id)
}

export function quitarLut(id: string): void {
  base().prepare('DELETE FROM luts WHERE id = ?').run(id)
}

export function rutaLut(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Ese LUT no existe')
  return join(carpetaLuts(), `${id}.cube`)
}
