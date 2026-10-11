/**
 * El decodificador de HEIC, en un proceso aparte.
 *
 * Una foto de 24 megapíxeles del iPhone 15 Pro tarda un par de segundos en
 * descomprimirse con libheif compilado a WebAssembly. Hecho en el proceso
 * principal, la ventana se quedaría sin responder mientras tanto; aquí, no.
 *
 * Recibe los bytes del archivo y devuelve la imagen principal en RGBA, ya
 * girada como la hizo el teléfono (libheif aplica la rotación del archivo).
 */
const crearLibheif = require('libheif-js/libheif-wasm/libheif-bundle.js') as () => LibHeif

interface ImagenHeif {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  display(destino: { data: Uint8ClampedArray; width: number; height: number }, listo: (d: unknown) => void): void
  free(): void
}

interface LibHeif {
  HeifDecoder: new () => { decode(datos: Uint8Array): ImagenHeif[] }
}

let libheif: LibHeif | null = null

interface Peticion {
  id: number
  datos: Uint8Array
}

process.parentPort.on('message', (e: { data: Peticion }) => {
  const { id, datos } = e.data
  try {
    libheif ??= crearLibheif()
    const imagenes = new libheif.HeifDecoder().decode(datos)
    if (!imagenes.length) throw new Error('El archivo no trae ninguna imagen')
    const img = imagenes.find((i) => i.is_primary()) ?? imagenes[0]
    const ancho = img.get_width()
    const alto = img.get_height()
    const rgba = new Uint8ClampedArray(ancho * alto * 4)
    img.display({ data: rgba, width: ancho, height: alto }, (d) => {
      for (const i of imagenes) i.free()
      if (!d) {
        process.parentPort.postMessage({ id, error: 'libheif no ha podido decodificarla' })
        return
      }
      process.parentPort.postMessage({ id, ancho, alto, rgba: new Uint8Array(rgba.buffer) })
    })
  } catch (error) {
    process.parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
