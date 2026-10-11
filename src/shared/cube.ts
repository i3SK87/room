/**
 * Los LUT en `.cube`, el formato de Adobe que usa casi todo el mundo.
 *
 * Un `.cube` 3D es una rejilla de N×N×N colores: para cada color de entrada,
 * el de salida. Va en texto, una línea por color, con el rojo cambiando más
 * deprisa, luego el verde y luego el azul. Los 1D, que solo llevan una curva
 * por canal, no se admiten: casi no se ven y no dan el «look» de película que
 * se busca aquí.
 */

export interface Lut3D {
  titulo: string | null
  tamano: number
  /** `tamano³` colores RGB seguidos, con el rojo cambiando más deprisa. */
  datos: Float32Array
  dominioMin: [number, number, number]
  dominioMax: [number, number, number]
}

const MIN_TAMANO = 2
const MAX_TAMANO = 129

export function leerCube(texto: string): Lut3D {
  let titulo: string | null = null
  let tamano = 0
  let dominioMin: [number, number, number] = [0, 0, 0]
  let dominioMax: [number, number, number] = [1, 1, 1]
  let datos: Float32Array | null = null
  let n = 0

  const lineas = texto.split(/\r?\n/)
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim()
    if (!linea || linea.startsWith('#')) continue
    const primera = linea.charCodeAt(0)
    const esNumero = (primera >= 48 && primera <= 57) || primera === 45 || primera === 43 || primera === 46
    if (!esNumero) {
      const [clave, ...resto] = linea.split(/\s+/)
      const valor = resto.join(' ')
      switch (clave.toUpperCase()) {
        case 'TITLE':
          titulo = valor.replace(/^"|"$/g, '').trim() || null
          break
        case 'LUT_3D_SIZE':
          tamano = Number.parseInt(valor, 10)
          if (!Number.isInteger(tamano) || tamano < MIN_TAMANO || tamano > MAX_TAMANO) {
            throw new Error(`El tamaño de la rejilla (${valor}) no es válido`)
          }
          datos = new Float32Array(tamano * tamano * tamano * 3)
          break
        case 'LUT_1D_SIZE':
          throw new Error('Es un LUT 1D: solo trae una curva por canal. ROOM usa LUT 3D, los de las emulaciones de película')
        case 'DOMAIN_MIN':
          dominioMin = tripleta(resto, i)
          break
        case 'DOMAIN_MAX':
          dominioMax = tripleta(resto, i)
          break
        case 'LUT_3D_INPUT_RANGE': {
          const [a, b] = resto.map(Number)
          if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`Línea ${i + 1}: rango mal escrito`)
          dominioMin = [a, a, a]
          dominioMax = [b, b, b]
          break
        }
        default:
          // Palabras de otros programas (LUT_IN_VIDEO_RANGE…): se ignoran, como hace Resolve.
          break
      }
      continue
    }
    if (!datos) throw new Error('Faltan los datos de la cabecera: no dice LUT_3D_SIZE antes de los colores')
    if (n >= datos.length) throw new Error('Trae más colores de los que dice su tamaño')
    const [r, g, b] = tripleta(linea.split(/\s+/), i)
    datos[n++] = r
    datos[n++] = g
    datos[n++] = b
  }

  if (!datos) throw new Error('No parece un .cube: no dice LUT_3D_SIZE')
  if (n !== datos.length) {
    throw new Error(`Está incompleto: trae ${n / 3} colores y le tocan ${datos.length / 3}`)
  }
  for (let c = 0; c < 3; c++) {
    if (!(dominioMax[c] > dominioMin[c])) throw new Error('El dominio del LUT está al revés')
  }
  return { titulo, tamano, datos, dominioMin, dominioMax }
}

function tripleta(partes: string[], i: number): [number, number, number] {
  const v = partes.slice(0, 3).map(Number)
  if (v.length < 3 || v.some((x) => !Number.isFinite(x))) throw new Error(`Línea ${i + 1}: no son tres números`)
  return [v[0], v[1], v[2]]
}

/** El `.cube` en texto, listo para guardar. Los colores van de 0 a 1. */
export function escribirCube(titulo: string, tamano: number, datos: Float32Array): string {
  const lineas: string[] = [
    '# Hecho con ROOM',
    `TITLE "${titulo.replace(/"/g, "'")}"`,
    `LUT_3D_SIZE ${tamano}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
    ''
  ]
  const f = (v: number): string => Math.min(1, Math.max(0, v)).toFixed(6)
  for (let i = 0; i < datos.length; i += 3) lineas.push(`${f(datos[i])} ${f(datos[i + 1])} ${f(datos[i + 2])}`)
  return lineas.join('\n') + '\n'
}

/** La rejilla que no cambia nada: para probar, y para la entrada del horneado. */
export function rejillaIdentidad(tamano: number): Float32Array {
  const d = new Float32Array(tamano * tamano * tamano * 3)
  let n = 0
  for (let b = 0; b < tamano; b++)
    for (let g = 0; g < tamano; g++)
      for (let r = 0; r < tamano; r++) {
        d[n++] = r / (tamano - 1)
        d[n++] = g / (tamano - 1)
        d[n++] = b / (tamano - 1)
      }
  return d
}
