/**
 * Los datos de la cámara (EXIF) de la foto original, para que la exportada
 * los conserve, como hace Lightroom: fecha, cámara, objetivo, exposición y,
 * si el iPhone la guardó, la ubicación.
 *
 * El EXIF es un bloque TIFF. En un JPEG viaja en el segmento APP1; en un HEIC,
 * como un «elemento» del contenedor, que hay que buscar en sus cajas. Se copia
 * tal cual con tres retoques: la orientación pasa a «normal» (la foto exportada
 * ya va girada), las medidas pasan a ser las nuevas y se quita la miniatura,
 * que enseñaría la foto sin revelar.
 *
 * Todo trabaja sobre bytes y no sabe de archivos: lo usan el proceso principal
 * y las pruebas.
 */

/* ---------- Leer el EXIF ---------- */

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1]
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

function cuatro(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
}

function esTiff(b: Uint8Array): boolean {
  return b.length > 8 && ((b[0] === 0x4d && b[1] === 0x4d) || (b[0] === 0x49 && b[1] === 0x49))
}

export function tipoDeImagen(b: Uint8Array): 'jpeg' | 'png' | 'heic' | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length > 12 && cuatro(b, 4) === 'ftyp') {
    const marcas = cuatro(b, 8) + ' ' + Array.from({ length: Math.max(0, (u32(b, 0) - 16) / 4) }, (_, i) => cuatro(b, 16 + i * 4)).join(' ')
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(marcas)) return 'heic'
  }
  return null
}

/** El bloque TIFF del APP1 «Exif» de un JPEG, o null. */
export function exifDeJpeg(b: Uint8Array): Uint8Array | null {
  let o = 2
  while (o + 4 < b.length && b[o] === 0xff) {
    const marca = b[o + 1]
    if (marca === 0xda || marca === 0xd9) break
    const largo = u16(b, o + 2)
    if (marca === 0xe1 && cuatro(b, o + 4) === 'Exif' && b[o + 8] === 0 && b[o + 9] === 0) {
      const tiff = b.subarray(o + 10, o + 2 + largo)
      return esTiff(tiff) ? tiff : null
    }
    o += 2 + largo
  }
  return null
}

interface Caja {
  tipo: string
  inicio: number
  /** Dónde empieza lo de dentro, saltada la cabecera. */
  dentro: number
  fin: number
}

function cajas(b: Uint8Array, desde: number, hasta: number): Caja[] {
  const lista: Caja[] = []
  let o = desde
  while (o + 8 <= hasta) {
    let largo = u32(b, o)
    const tipo = cuatro(b, o + 4)
    let cabecera = 8
    if (largo === 1) {
      // Tamaño de 64 bits: los HEIC del iPhone no lo usan para el meta, pero el mdat sí puede.
      largo = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12)
      cabecera = 16
    } else if (largo === 0) {
      largo = hasta - o
    }
    if (largo < cabecera || o + largo > hasta) break
    lista.push({ tipo, inicio: o, dentro: o + cabecera, fin: o + largo })
    o += largo
  }
  return lista
}

function leerN(b: Uint8Array, o: number, n: number): number {
  if (n === 0) return 0
  if (n === 2) return u16(b, o)
  if (n === 4) return u32(b, o)
  if (n === 8) return u32(b, o) * 2 ** 32 + u32(b, o + 4)
  throw new Error(`Tamaño de campo ${n} no previsto`)
}

/** Lo que interesa del contenedor HEIC: el EXIF y si el color viene en Display P3. */
export function leerHeic(b: Uint8Array): { exif: Uint8Array | null; p3: boolean } {
  const meta = cajas(b, 0, b.length).find((c) => c.tipo === 'meta')
  if (!meta) return { exif: null, p3: false }
  // `meta` es una caja «completa»: cuatro bytes de versión y banderas antes de sus hijas.
  const hijas = cajas(b, meta.dentro + 4, meta.fin)

  let p3 = false
  const iprp = hijas.find((c) => c.tipo === 'iprp')
  const ipco = iprp && cajas(b, iprp.dentro, iprp.fin).find((c) => c.tipo === 'ipco')
  if (ipco) {
    for (const c of cajas(b, ipco.dentro, ipco.fin)) {
      if (c.tipo !== 'colr') continue
      const clase = cuatro(b, c.dentro)
      if (clase === 'nclx' && u16(b, c.dentro + 4) === 12) p3 = true
      if (clase === 'prof' || clase === 'rICC') {
        const icc = b.subarray(c.dentro + 4, c.fin)
        if (/Display P3|P3 D65|DCI-P3/.test(textoDeIcc(icc))) p3 = true
      }
    }
  }

  // El elemento de tipo «Exif»: su número sale de iinf y sus bytes, de iloc.
  let idExif = -1
  const iinf = hijas.find((c) => c.tipo === 'iinf')
  if (iinf) {
    const version = b[iinf.dentro]
    const desde = iinf.dentro + 4 + (version === 0 ? 2 : 4)
    for (const infe of cajas(b, desde, iinf.fin)) {
      if (infe.tipo !== 'infe') continue
      const v = b[infe.dentro]
      if (v < 2) continue
      const id = v === 2 ? u16(b, infe.dentro + 4) : u32(b, infe.dentro + 4)
      const o = infe.dentro + 4 + (v === 2 ? 2 : 4) + 2
      if (cuatro(b, o) === 'Exif') idExif = id
    }
  }
  const iloc = hijas.find((c) => c.tipo === 'iloc')
  if (idExif < 0 || !iloc) return { exif: null, p3 }

  const v = b[iloc.dentro]
  let o = iloc.dentro + 4
  const tamOffset = b[o] >> 4
  const tamLargo = b[o] & 15
  const tamBase = b[o + 1] >> 4
  const tamIndice = v === 1 || v === 2 ? b[o + 1] & 15 : 0
  o += 2
  const cuantos = v < 2 ? u16(b, o) : u32(b, o)
  o += v < 2 ? 2 : 4
  for (let i = 0; i < cuantos; i++) {
    const id = v < 2 ? u16(b, o) : u32(b, o)
    o += v < 2 ? 2 : 4
    let construccion = 0
    if (v === 1 || v === 2) {
      construccion = u16(b, o) & 15
      o += 2
    }
    o += 2 // data_reference_index
    const base = leerN(b, o, tamBase)
    o += tamBase
    const extensiones = u16(b, o)
    o += 2
    const trozos: Uint8Array[] = []
    for (let e = 0; e < extensiones; e++) {
      if (tamIndice) o += tamIndice
      const desp = leerN(b, o, tamOffset)
      o += tamOffset
      const largo = leerN(b, o, tamLargo)
      o += tamLargo
      trozos.push(b.subarray(base + desp, base + desp + largo))
    }
    if (id !== idExif) continue
    // Solo se entiende el caso normal: los bytes, en el archivo.
    if (construccion !== 0 || trozos.length === 0) return { exif: null, p3 }
    const datos = trozos.length === 1 ? trozos[0] : unir(trozos)
    // Los cuatro primeros bytes dicen cuánto saltar hasta la cabecera TIFF.
    const salto = u32(datos, 0)
    const tiff = datos.subarray(4 + salto)
    return { exif: esTiff(tiff) ? tiff : null, p3 }
  }
  return { exif: null, p3 }
}

function unir(trozos: Uint8Array[]): Uint8Array {
  const total = trozos.reduce((s, t) => s + t.length, 0)
  const r = new Uint8Array(total)
  let o = 0
  for (const t of trozos) {
    r.set(t, o)
    o += t.length
  }
  return r
}

/** Lo legible de un perfil ICC, para reconocerlo por su nombre. */
function textoDeIcc(icc: Uint8Array): string {
  let s = ''
  for (let i = 0; i < Math.min(icc.length, 4096); i++) {
    const c = icc[i]
    if (c >= 32 && c < 127) s += String.fromCharCode(c)
  }
  return s
}

/* ---------- Preparar el EXIF para la foto exportada ---------- */

const ORIENTACION = 0x0112
const PUNTERO_EXIF = 0x8769
const ANCHO_EXIF = 0xa002
const ALTO_EXIF = 0xa003

/**
 * Copia del bloque TIFF con la orientación en «normal», las medidas nuevas y
 * sin la miniatura. Si algo no cuadra, devuelve null y la foto sale sin EXIF:
 * mejor sin datos que con datos rotos.
 */
export function prepararExif(tiff: Uint8Array, ancho: number, alto: number): Uint8Array | null {
  try {
    const b = new Uint8Array(tiff)
    const dv = new DataView(b.buffer)
    const le = b[0] === 0x49
    if (dv.getUint16(2, le) !== 42) return null
    const ifd0 = dv.getUint32(4, le)
    const recorrer = (inicio: number, alEntrar: (tag: number, tipo: number, o: number) => void): number => {
      const n = dv.getUint16(inicio, le)
      for (let i = 0; i < n; i++) {
        const o = inicio + 2 + i * 12
        alEntrar(dv.getUint16(o, le), dv.getUint16(o + 2, le), o)
      }
      return inicio + 2 + n * 12
    }
    let exifIfd = 0
    const finIfd0 = recorrer(ifd0, (tag, tipo, o) => {
      if (tag === ORIENTACION && tipo === 3) dv.setUint16(o + 8, 1, le)
      if (tag === PUNTERO_EXIF) exifIfd = dv.getUint32(o + 8, le)
    })
    // El enlace al IFD siguiente, que es el de la miniatura: se corta.
    dv.setUint32(finIfd0, 0, le)
    if (exifIfd > 0 && exifIfd < b.length - 2) {
      recorrer(exifIfd, (tag, tipo, o) => {
        if (tag !== ANCHO_EXIF && tag !== ALTO_EXIF) return
        const valor = tag === ANCHO_EXIF ? ancho : alto
        if (tipo === 3) dv.setUint16(o + 8, Math.min(65535, valor), le)
        else if (tipo === 4) dv.setUint32(o + 8, valor, le)
      })
    }
    return b
  } catch {
    return null
  }
}

/* ---------- Meterlo en la foto exportada ---------- */

/** El JPEG con el EXIF dentro, en un APP1 detrás del APP0 (JFIF) si lo hay. */
export function insertarExifJpeg(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const largo = 2 + 6 + tiff.length
  if (largo > 0xffff || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
  let donde = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) donde = 4 + u16(jpeg, 4)
  const app1 = new Uint8Array(2 + largo)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1[2] = largo >> 8
  app1[3] = largo & 0xff
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4)
  app1.set(tiff, 10)
  return unir([jpeg.subarray(0, donde), app1, jpeg.subarray(donde)])
}

let tablaCrc: Uint32Array | null = null

export function crc32(datos: Uint8Array): number {
  if (!tablaCrc) {
    tablaCrc = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      tablaCrc[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < datos.length; i++) c = tablaCrc[(c ^ datos[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** El PNG con un trozo eXIf delante del primer IDAT, que es donde lo pide la norma. */
export function insertarExifPng(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  let o = 8
  while (o + 8 <= png.length) {
    const largo = u32(png, o)
    if (cuatro(png, o + 4) === 'IDAT') break
    o += 12 + largo
  }
  if (o + 8 > png.length) return png
  const trozo = new Uint8Array(12 + tiff.length)
  const dv = new DataView(trozo.buffer)
  dv.setUint32(0, tiff.length)
  trozo.set([0x65, 0x58, 0x49, 0x66], 4)
  trozo.set(tiff, 8)
  dv.setUint32(8 + tiff.length, crc32(trozo.subarray(4, 8 + tiff.length)))
  return unir([png.subarray(0, o), trozo, png.subarray(o)])
}
