/**
 * Las comprobaciones de lo que no necesita ventana: los LUT, la curva, el
 * EXIF y el saneado del revelado.
 *
 *   npm test
 *
 * Con la variable MUESTRAS apuntando a una carpeta con `iphone.heic` (un HEIC
 * con EXIF) y `con-exif.jpg`, se prueba también contra archivos de verdad.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { escribirCube, leerCube, rejillaIdentidad } from '../src/shared/cube'
import { anadirPunto, funcionCurva, moverPunto, muestrearCurva } from '../src/shared/curva'
import { crc32, exifDeJpeg, insertarExifJpeg, insertarExifPng, leerHeic, prepararExif, tipoDeImagen } from '../src/shared/exif'
import { estaTocado, reveladoNeutro, sanear, textoValor, BASICOS } from '../src/shared/revelado'

let fallos = 0
let pruebas = 0

function ok(condicion: unknown, que: string): void {
  pruebas++
  if (!condicion) {
    fallos++
    console.log(`  ✗ ${que}`)
  }
}

function lanza(fn: () => unknown, que: string, mensaje?: RegExp): void {
  pruebas++
  try {
    fn()
    fallos++
    console.log(`  ✗ ${que} (no ha lanzado)`)
  } catch (e) {
    if (mensaje && !mensaje.test(String(e))) {
      fallos++
      console.log(`  ✗ ${que}: ${String(e)}`)
    }
  }
}

function grupo(nombre: string, fn: () => void): void {
  console.log(nombre)
  fn()
}

/* ---------- .cube ---------- */

grupo('LUT .cube', () => {
  const id = rejillaIdentidad(5)
  const texto = escribirCube('Prueba "rara"', 5, id)
  const lut = leerCube(texto)
  ok(lut.tamano === 5, 'lee el tamaño')
  ok(lut.titulo === "Prueba 'rara'", 'lee el título sin romper las comillas')
  ok(lut.datos.length === 125 * 3, 'trae todos los colores')
  ok(lut.datos.every((v, i) => Math.abs(v - id[i]) < 1e-6), 'ida y vuelta sin perder nada')
  ok(lut.datos[3] === 0.25 && lut.datos[4] === 0 && lut.datos[5] === 0, 'el rojo cambia más deprisa')

  const conRango = leerCube('# hola\nTITLE "x"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\nLUT_IN_VIDEO_RANGE\n' + '0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n')
  ok(conRango.tamano === 2, 'ignora palabras de otros programas')
  const resolve = leerCube('LUT_3D_SIZE 2\nLUT_3D_INPUT_RANGE 0 2\n' + '0 0 0\n'.repeat(8))
  ok(resolve.dominioMax[0] === 2, 'entiende LUT_3D_INPUT_RANGE de Resolve')
  const crlf = leerCube('LUT_3D_SIZE 2\r\n' + '0.5 0.5 0.5\r\n'.repeat(8))
  ok(crlf.datos[0] === 0.5, 'acepta finales de línea de Windows')

  lanza(() => leerCube('LUT_1D_SIZE 1024\n0 0 0\n'), 'rechaza los 1D', /1D/)
  lanza(() => leerCube('LUT_3D_SIZE 2\n0 0 0\n'), 'rechaza uno incompleto', /incompleto/)
  lanza(() => leerCube('LUT_3D_SIZE 2\n' + '0 0 0\n'.repeat(9)), 'rechaza uno con colores de más', /más colores/)
  lanza(() => leerCube('hola que tal'), 'rechaza lo que no es un .cube', /LUT_3D_SIZE/)
  lanza(() => leerCube('LUT_3D_SIZE 2\n' + '0 x 0\n'.repeat(8)), 'rechaza números mal escritos', /tres números/)
  lanza(() => leerCube('LUT_3D_SIZE 500\n'), 'rechaza tamaños absurdos', /tamaño/)
  ok(escribirCube('t', 2, new Float32Array([2, -1, 0.5, ...new Array(21).fill(0)])).includes('1.000000 0.000000 0.500000'), 'recorta a 0..1 al escribir')
})

/* ---------- Curva ---------- */

grupo('Curva de tonos', () => {
  const recta = funcionCurva([
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ])
  ok([0, 0.1, 0.5, 0.9, 1].every((x) => Math.abs(recta(x) - x) < 1e-9), 'dos puntos en diagonal: la identidad')
  const s = [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.18 },
    { x: 0.75, y: 0.84 },
    { x: 1, y: 1 }
  ]
  const f = funcionCurva(s)
  ok(s.every((p) => Math.abs(f(p.x) - p.y) < 1e-9), 'pasa por todos los puntos')
  const t = muestrearCurva(s, 512)
  let monotona = true
  for (let i = 1; i < t.length; i++) if (t[i] < t[i - 1] - 1e-7) monotona = false
  ok(monotona, 'una curva en S que sube no baja en ningún tramo')
  const lavada = funcionCurva([
    { x: 0, y: 0.2 },
    { x: 1, y: 1 }
  ])
  ok(Math.abs(lavada(0) - 0.2) < 1e-9, 'el negro lavado se queda donde se puso')
  const pico = muestrearCurva([
    { x: 0, y: 0 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0 }
  ])
  ok(pico.every((v) => v >= 0 && v <= 1), 'no se sale de 0..1 ni con un pico')

  const movida = moverPunto(s, 1, 0.9, 0.5)
  ok(movida[1].x < movida[2].x, 'un punto no adelanta a su vecino')
  ok(moverPunto(s, 0, 0.4, 0.3)[0].x === 0, 'el extremo de la izquierda solo sube y baja')
  ok(moverPunto(s, 3, 0.2, 0.7)[3].x === 1, 'el de la derecha, igual')
  ok(moverPunto(s, 1, 0.3, 2)[1].y === 1, 'no sale de la caja por arriba')
  const anadido = anadirPunto(s, 0.5, 0.6)
  ok(anadido?.indice === 2 && anadido.puntos.length === 5, 'añadir lo coloca en su sitio')
  ok(anadirPunto(s, 0.251, 0.5) === null, 'no se añade encima de otro')
})

/* ---------- Revelado ---------- */

grupo('Revelado', () => {
  const n = reveladoNeutro()
  ok(!estaTocado(n), 'el neutro no cuenta como revelada')
  ok(estaTocado({ ...n, grano: 10 }), 'con grano, sí')
  const s = sanear({ exposicion: 99, contraste: 'mucho', curvas: { lum: [{ x: 0.5, y: 2 }] }, ruedas: { luces: { x: 3, y: 4 } }, lut: '' })
  ok(s.exposicion === 5, 'recorta la exposición a ±5')
  ok(s.contraste === 0, 'lo que no es un número, a cero')
  ok(s.curvas.lum.length === 2 && s.curvas.lum[0].x === 0, 'una curva rota vuelve a ser recta')
  ok(Math.abs(Math.hypot(s.ruedas.luces.x, s.ruedas.luces.y) - 1) < 1e-9, 'una rueda fuera del círculo vuelve al borde')
  ok(s.lut === null, 'LUT vacío es ningún LUT')
  ok(s.fusion === 50 && s.tamanoGrano === 25, 'lo que falta, como de fábrica')
  ok(JSON.stringify(sanear(JSON.parse(JSON.stringify(n)))) === JSON.stringify(n), 'el neutro sale igual de sanear')
  const curvaBuena = sanear({ curvas: { r: [{ x: 0, y: 0.1 }, { x: 0.4, y: 0.5 }, { x: 1, y: 0.9 }] } })
  ok(curvaBuena.curvas.r.length === 3 && curvaBuena.curvas.r[1].y === 0.5, 'una curva buena se respeta')
  ok(textoValor(BASICOS[0], 0.35) === '+0,35', 'la exposición con coma y signo')
  ok(textoValor(BASICOS[1], -12) === '-12', 'los demás, enteros con signo')
})

/* ---------- EXIF ---------- */

/** Un TIFF pequeño con orientación 6, un IFD de Exif con medidas y un IFD1 (miniatura). */
function tiffDePrueba(le: boolean): Uint8Array {
  const b = new Uint8Array(200)
  const dv = new DataView(b.buffer)
  b[0] = b[1] = le ? 0x49 : 0x4d
  dv.setUint16(2, 42, le)
  dv.setUint32(4, 8, le)
  // IFD0 en 8: dos entradas
  dv.setUint16(8, 2, le)
  dv.setUint16(10, 0x0112, le) // orientación
  dv.setUint16(12, 3, le)
  dv.setUint32(14, 1, le)
  dv.setUint16(18, 6, le)
  dv.setUint16(22, 0x8769, le) // puntero al Exif
  dv.setUint16(24, 4, le)
  dv.setUint32(26, 1, le)
  dv.setUint32(30, 50, le)
  dv.setUint32(34, 100, le) // siguiente IFD: la miniatura
  // Exif IFD en 50
  dv.setUint16(50, 2, le)
  dv.setUint16(52, 0xa002, le)
  dv.setUint16(54, 4, le)
  dv.setUint32(56, 1, le)
  dv.setUint32(60, 4032, le)
  dv.setUint16(64, 0xa003, le)
  dv.setUint16(66, 3, le)
  dv.setUint32(68, 1, le)
  dv.setUint16(72, 3024, le)
  dv.setUint32(74, 0, le)
  return b
}

grupo('EXIF', () => {
  for (const le of [true, false]) {
    const t = tiffDePrueba(le)
    const p = prepararExif(t, 5712, 4284)!
    const dv = new DataView(p.buffer)
    ok(dv.getUint16(18, le) === 1, `${le ? 'II' : 'MM'}: la orientación pasa a normal`)
    ok(dv.getUint32(34, le) === 0, `${le ? 'II' : 'MM'}: se quita la miniatura`)
    ok(dv.getUint32(60, le) === 5712, `${le ? 'II' : 'MM'}: el ancho nuevo (LONG)`)
    ok(dv.getUint16(72, le) === 4284, `${le ? 'II' : 'MM'}: el alto nuevo (SHORT)`)
    ok(new DataView(t.buffer).getUint16(18, le) === 6, `${le ? 'II' : 'MM'}: el original no se toca`)
  }
  ok(prepararExif(new Uint8Array([1, 2, 3]), 1, 1) === null, 'un TIFF roto da null, no una excepción')

  // Un JPEG mínimo con JFIF: el EXIF va detrás del APP0.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])
  const t = prepararExif(tiffDePrueba(true), 10, 10)!
  const con = insertarExifJpeg(jpeg, t)
  ok(con[8] === 0xff && con[9] === 0xe1, 'el APP1 va detrás del JFIF')
  const vuelta = exifDeJpeg(con)
  ok(!!vuelta && vuelta.length === t.length && vuelta.every((v, i) => v === t[i]), 'el EXIF metido se vuelve a leer igual')
  ok(tipoDeImagen(con) === 'jpeg', 'sigue siendo un JPEG')

  // PNG: firma + IHDR + IDAT + IEND, con sus CRC.
  const trozo = (tipo: string, datos: number[]): number[] => {
    const cuerpo = [...Buffer.from(tipo, 'latin1'), ...datos]
    const crc = crc32(new Uint8Array(cuerpo))
    return [0, 0, 0, datos.length, ...cuerpo, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]
  }
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...trozo('IHDR', new Array(13).fill(0)), ...trozo('IDAT', [1, 2]), ...trozo('IEND', [])])
  const pngCon = insertarExifPng(png, t)
  const s = Buffer.from(pngCon).toString('latin1')
  ok(s.indexOf('eXIf') > 0 && s.indexOf('eXIf') < s.indexOf('IDAT'), 'el eXIf va antes del IDAT')
  const o = s.indexOf('eXIf') - 4
  const largo = new DataView(pngCon.buffer).getUint32(o)
  const crcLeido = new DataView(pngCon.buffer).getUint32(o + 8 + largo)
  ok(largo === t.length && crcLeido === crc32(pngCon.subarray(o + 4, o + 8 + largo)), 'el trozo eXIf lleva su largo y su CRC bien')
  ok(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'el CRC32 es el de la norma')
})

/* ---------- Con archivos de verdad ---------- */

const muestras = process.env.MUESTRAS
if (muestras && existsSync(join(muestras, 'iphone.heic'))) {
  grupo('Archivos de verdad', () => {
    const heic = new Uint8Array(readFileSync(join(muestras, 'iphone.heic')))
    ok(tipoDeImagen(heic) === 'heic', 'reconoce el HEIC')
    const { exif } = leerHeic(heic)
    ok(!!exif && (exif[0] === 0x4d || exif[0] === 0x49), 'saca el EXIF del HEIC')
    ok(!!exif && prepararExif(exif, 100, 100) !== null, 'y se puede preparar para exportar')
    const jpg = new Uint8Array(readFileSync(join(muestras, 'con-exif.jpg')))
    const e = exifDeJpeg(jpg)
    ok(!!e && e[0] === 0x49, 'saca el EXIF del JPEG')
  })
}

console.log(`\n${pruebas - fallos} de ${pruebas} comprobaciones bien`)
if (fallos) process.exit(1)
