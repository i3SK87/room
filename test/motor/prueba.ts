/**
 * Las comprobaciones del motor de revelado, dentro de una ventana de Electron
 * que no se ve (la arranca `principal.cjs`). Devuelve un informe en texto.
 */
import { Motor } from '../../src/renderer/src/motor/motor'
import { BASICOS, CALIBRACION, GRADACION, PELICULA, PRESENCIA, reveladoNeutro, type Revelado } from '../../src/shared/revelado'
import { leerCube } from '../../src/shared/cube'
import { conAngulo } from '../../src/shared/geometria'

const lineas: string[] = []
let fallos = 0
let pruebas = 0

function ok(condicion: unknown, que: string, detalle = ''): void {
  pruebas++
  if (!condicion) fallos++
  lineas.push(`${condicion ? '  ✓' : '  ✗'} ${que}${detalle ? ` (${detalle})` : ''}`)
}

/** Una imagen de prueba: degradados de color, una escala de grises y un foco muy brillante. */
function imagenDePrueba(ancho: number, alto: number): Uint8Array {
  const d = new Uint8Array(ancho * alto * 4)
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4
      if (y < alto / 2) {
        d[i] = Math.round((x / (ancho - 1)) * 255)
        d[i + 1] = Math.round((y / (alto / 2 - 1)) * 255)
        d[i + 2] = Math.round(((x + y) % 64) * 4)
      } else {
        const g = Math.round((x / (ancho - 1)) * 255)
        d[i] = d[i + 1] = d[i + 2] = g
      }
      // Un foco casi blanco hacia la derecha, para el halo.
      const dx = x - ancho * 0.8
      const dy = y - alto * 0.25
      if (dx * dx + dy * dy < (alto * 0.06) ** 2) d[i] = d[i + 1] = d[i + 2] = 255
      d[i + 3] = 255
    }
  return d
}

function difMedia(a: Uint8Array, b: Uint8Array): number {
  let s = 0
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
  return s / ((a.length / 4) * 3)
}

function difMax(a: Uint8Array, b: Uint8Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

function pixel(px: Uint8Array, ancho: number, x: number, y: number): [number, number, number] {
  const i = (y * ancho + x) * 4
  return [px[i], px[i + 1], px[i + 2]]
}

function con(cambios: Partial<Revelado>): Revelado {
  return { ...reveladoNeutro(), ...cambios }
}

export function ejecutar(): string {
  const lienzo = document.createElement('canvas')
  const m = new Motor(lienzo)
  const A = 256
  const H = 128
  const img = imagenDePrueba(A, H)
  m.cargar({ rgba: img, ancho: A, alto: H, p3: false })

  lineas.push('Identidad')
  const neutro = m.leer(reveladoNeutro(), A, H)
  ok(
    difMax(neutro, img) <= 2,
    'con todo a cero, la foto sale como entra',
    `máx ${difMax(neutro, img)}/255, media ${difMedia(neutro, img).toFixed(3)}`
  )

  lineas.push('Cada control hace algo y no rompe la imagen')
  const pruebaControl = (nombre: string, r: Revelado): void => {
    const px = m.leer(r, A, H)
    const d = difMedia(px, neutro)
    let negros = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) negros++
    ok(d > 0.5 && negros < (px.length / 4) * 0.9, nombre, `cambio medio ${d.toFixed(2)}`)
  }
  for (const d of [...BASICOS, ...PRESENCIA, ...GRADACION, ...CALIBRACION, ...PELICULA]) {
    if (d.clave === 'tamanoGrano' || d.clave === 'asperezaGrano' || d.clave === 'fusion' || d.clave === 'equilibrio') continue
    if (d.clave === 'lumSombras' || d.clave === 'lumMedios' || d.clave === 'lumLuces') {
      pruebaControl(`${d.etiqueta} +100`, con({ [d.clave]: 100 }))
      continue
    }
    pruebaControl(`${d.etiqueta} ${d.min < 0 ? '-100' : '+100'}`, con({ [d.clave]: d.min < 0 ? (d.clave === 'exposicion' ? -1 : -100) : 100 }))
    if (d.min < 0) pruebaControl(`${d.etiqueta} +`, con({ [d.clave]: d.clave === 'exposicion' ? 1 : 100 }))
  }
  const n0 = reveladoNeutro()
  pruebaControl(
    'curva: negros lavados',
    con({
      curvas: {
        ...n0.curvas,
        lum: [
          { x: 0, y: 0.25 },
          { x: 1, y: 1 }
        ]
      }
    })
  )
  pruebaControl(
    'curva: canal rojo',
    con({
      curvas: {
        ...n0.curvas,
        r: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.7 },
          { x: 1, y: 1 }
        ]
      }
    })
  )
  pruebaControl('mezclador: verdes a oliva', con({ mezcla: { ...n0.mezcla, verde: { h: -60, s: -40, l: -20 } } }))
  pruebaControl('mezclador: azules', con({ mezcla: { ...n0.mezcla, azul: { h: 40, s: 50, l: 30 } } }))
  pruebaControl('rueda de sombras', con({ ruedas: { ...n0.ruedas, sombras: { x: 0.7, y: 0.3 } } }))
  pruebaControl('rueda de medios', con({ ruedas: { ...n0.ruedas, medios: { x: -0.5, y: 0.5 } } }))
  pruebaControl('rueda de luces', con({ ruedas: { ...n0.ruedas, luces: { x: 0, y: -0.8 } } }))

  lineas.push('Los números de cada cosa')
  const gris = 128
  const expo = m.leer(con({ exposicion: 1 }), A, H)
  const xGris = Math.round((gris / 255) * (A - 1))
  const esperado = Math.round(255 * (1.055 * Math.pow(Math.pow((gris / 255 + 0.055) / 1.055, 2.4) * 2, 1 / 2.4) - 0.055))
  const [eg] = pixel(expo, A, xGris, H - 10)
  ok(Math.abs(eg - esperado) <= 3, '+1 de exposición dobla la luz', `gris ${gris} → ${eg}, esperado ${esperado}`)
  const calido = m.leer(con({ temperatura: 60 }), A, H)
  const [cr, , cb] = pixel(calido, A, xGris, H - 10)
  ok(cr > cb + 10, 'la temperatura calienta los grises', `R ${cr} B ${cb}`)
  const [pr, pg, pb] = pixel(m.leer(con({ calRojoH: 80, calVerdeS: -60, calAzulH: -50 }), A, H), A, xGris, H - 10)
  ok(Math.abs(pr - pg) <= 2 && Math.abs(pg - pb) <= 2, 'la calibración no tiñe los grises', `${pr} ${pg} ${pb}`)
  const [vr, vg, vb] = pixel(m.leer(con({ saturacion: 100, viveza: 100 }), A, H), A, xGris, H - 10)
  ok(Math.abs(vr - vg) <= 2 && Math.abs(vg - vb) <= 2, 'la saturación no tiñe los grises', `${vr} ${vg} ${vb}`)

  const vin = m.leer(con({ vineteado: 100 }), A, H)
  ok(
    pixel(vin, A, 2, H - 4)[0] < pixel(neutro, A, 2, H - 4)[0] || pixel(vin, A, A - 3, H - 3)[0] < pixel(neutro, A, A - 3, H - 3)[0] - 20,
    'el viñeteado oscurece las esquinas'
  )
  ok(Math.abs(pixel(vin, A, A / 2, H / 2 + 8)[0] - pixel(neutro, A, A / 2, H / 2 + 8)[0]) <= 3, 'y deja el centro')

  const haloPx = m.leer(con({ halo: 100 }), A, H)
  const cerca = pixel(haloPx, A, Math.round(A * 0.8) - 14, Math.round(H * 0.25))
  const cercaN = pixel(neutro, A, Math.round(A * 0.8) - 14, Math.round(H * 0.25))
  ok(cerca[0] - cercaN[0] > cerca[2] - cercaN[2], 'el halo enrojece alrededor de la luz', `ΔR ${cerca[0] - cercaN[0]} ΔB ${cerca[2] - cercaN[2]}`)

  const varianza = (px: Uint8Array): number => {
    // En la franja gris, la diferencia entre vecinos: el grano la sube.
    let s = 0
    let n = 0
    for (let x = 1; x < A; x++) {
      const a = pixel(px, A, x, H - 30)[0]
      const b = pixel(px, A, x - 1, H - 30)[0]
      s += (a - b) ** 2
      n++
    }
    return s / n
  }
  ok(
    varianza(m.leer(con({ grano: 60 }), A, H)) > varianza(neutro) * 4,
    'el grano añade grano',
    `${varianza(neutro).toFixed(1)} → ${varianza(m.leer(con({ grano: 60 }), A, H)).toFixed(1)}`
  )
  // A tamaño de foto de verdad: en 256 px, hasta el grano gordo cabe en un píxel.
  const vGrande = (px: Uint8Array): number => {
    let s = 0
    for (let x = 1; x < 3000; x++) s += (px[(1500 * 3000 + x) * 4] - px[(1500 * 3000 + x - 1) * 4]) ** 2
    return s / 2999
  }
  const gfino = vGrande(m.leer(con({ grano: 60, tamanoGrano: 0 }), 3000, 2000))
  const ggordo = vGrande(m.leer(con({ grano: 60, tamanoGrano: 100 }), 3000, 2000))
  ok(gfino > ggordo, 'el grano gordo cambia menos de un píxel al de al lado', `fino ${gfino.toFixed(1)}, gordo ${ggordo.toFixed(1)}`)

  lineas.push('LUT')
  const identidad = m.hornearLut(reveladoNeutro(), 17)
  let err = 0
  for (let b = 0, i = 0; b < 17; b++)
    for (let g = 0; g < 17; g++)
      for (let r = 0; r < 17; r++, i += 3) {
        err = Math.max(err, Math.abs(identidad[i] - r / 16), Math.abs(identidad[i + 1] - g / 16), Math.abs(identidad[i + 2] - b / 16))
      }
  ok(err < 0.004, 'el LUT de un revelado neutro es la identidad', `error máx ${err.toFixed(5)}`)

  // El LUT exportado tiene que reproducir el color del revelado.
  const look = con({
    contraste: 30,
    sombras: 25,
    temperatura: 35,
    tinte: -10,
    saturacion: -15,
    curvas: {
      ...n0.curvas,
      lum: [
        { x: 0, y: 0.12 },
        { x: 0.5, y: 0.52 },
        { x: 1, y: 0.94 }
      ]
    },
    mezcla: { ...n0.mezcla, verde: { h: -40, s: -30, l: 0 } },
    ruedas: { ...n0.ruedas, sombras: { x: 0.4, y: 0.5 }, luces: { x: -0.2, y: -0.4 } },
    calRojoH: 30
  })
  const horneado = m.hornearLut(look, 33)
  const lut = leerCube(
    'LUT_3D_SIZE 33\n' + Array.from({ length: 33 ** 3 }, (_, i) => `${horneado[i * 3]} ${horneado[i * 3 + 1]} ${horneado[i * 3 + 2]}`).join('\n')
  )
  m.ponerLut(lut)
  const conLut = m.leer(con({ lut: 'x' }), A, H)
  const directo = m.leer(look, A, H)
  ok(
    difMedia(conLut, directo) < 1.2 && difMax(conLut, directo) <= 12,
    'el LUT exportado reproduce el revelado',
    `media ${difMedia(conLut, directo).toFixed(2)}/255, máx ${difMax(conLut, directo)}`
  )
  const mitad = m.leer(con({ lut: 'x', intensidadLut: 50 }), A, H)
  const dm = difMedia(mitad, neutro)
  const dc = difMedia(conLut, neutro)
  ok(dm > dc * 0.3 && dm < dc * 0.75, 'al 50 % se queda a medio camino', `${dm.toFixed(2)} frente a ${dc.toFixed(2)}`)
  const inverso = leerCube('LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n')
  m.ponerLut(inverso)
  const neg = m.leer(con({ lut: 'x' }), A, H)
  ok(Math.abs(pixel(neg, A, 10, H - 10)[0] - (255 - pixel(neutro, A, 10, H - 10)[0])) <= 3, 'un LUT que invierte, invierte')
  m.ponerLut(null)

  lineas.push('Geometría')
  const g0 = reveladoNeutro().geometria
  const conGeo = (g: Partial<typeof g0>): Revelado => con({ geometria: { ...g0, ...g } })
  const igualA = (px: Uint8Array, ancho: number, x: number, y: number, sx: number, sy: number): boolean => {
    const a = pixel(px, ancho, x, y)
    const b = pixel(img, A, sx, sy)
    return a.every((v, i) => Math.abs(v - b[i]) <= 3)
  }
  const girada = conGeo({ giro: 1, recorte: { x: 0, y: 0, w: 1, h: 1 } })
  const mg = m.medidasSalida(girada)!
  ok(mg.ancho === H && mg.alto === A, 'girar 90° cambia ancho por alto', `${mg.ancho}×${mg.alto}`)
  const pGirada = m.leer(girada, H, A)
  ok(igualA(pGirada, H, 5, 9, 9, H - 1 - 5) && igualA(pGirada, H, 100, 200, 200, H - 1 - 100), 'y cada píxel va a su sitio')
  const pv = m.leer(conGeo({ voltH: true }), A, H)
  ok(igualA(pv, A, 10, 20, A - 1 - 10, 20) && igualA(pv, A, 200, 100, A - 1 - 200, 100), 'voltear en horizontal es un espejo')
  const recortada = conGeo({ recorte: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 } })
  const mr = m.medidasSalida(recortada)!
  ok(mr.ancho === A / 2 && mr.alto === H / 4, 'el recorte mide lo que recorta', `${mr.ancho}×${mr.alto}`)
  const pRec = m.leer(recortada, mr.ancho, mr.alto)
  ok(igualA(pRec, mr.ancho, 0, 0, A / 4, H / 2) && igualA(pRec, mr.ancho, 50, 20, A / 4 + 50, H / 2 + 20), 'y enseña lo de dentro')
  ok(m.medidasSalida(recortada, true)!.ancho === A, 'en el modo Recortar se ve la foto entera')
  // Enderezada no asoma nada negro: una foto sin negros sigue sin ellos.
  const clara = new Uint8Array(A * H * 4).map((_, i) => (i % 4 === 3 ? 255 : 90 + ((i * 7) % 120)))
  m.cargar({ rgba: clara, ancho: A, alto: H, p3: false })
  const enderezada = con({ geometria: conAngulo(g0, 12, A, H) })
  const me = m.medidasSalida(enderezada)!
  const pe = m.leer(enderezada, me.ancho, me.alto)
  let negrosE = 0
  for (let i = 0; i < pe.length; i += 4) if (pe[i] < 20 && pe[i + 1] < 20 && pe[i + 2] < 20) negrosE++
  ok(negrosE === 0 && me.ancho < A, 'enderezar 12° no deja esquinas vacías', `${me.ancho}×${me.alto}, ${negrosE} píxeles negros`)
  const pm = m.leer(con({ geometria: { ...conAngulo(g0, 12, A, H), recorte: { x: 0, y: 0, w: 1, h: 1 } } }), A, H)
  ok(
    pixel(pm, A, 0, 0).every((v) => v === 0),
    'en el modo Recortar, lo que queda fuera de la foto se ve negro'
  )
  const pequena = m.exportar(con({}), 100)
  ok(pequena.ancho === 100 && pequena.alto === 50, 'exportar con el lado largo en 100 px', `${pequena.ancho}×${pequena.alto}`)
  ok(m.exportar(con({}), 5000).ancho === A, 'y nunca se amplía')
  m.cargar({ rgba: img, ancho: A, alto: H, p3: false })

  lineas.push('Eliminar: los parches')
  const rojo = new Uint8ClampedArray(20 * 10 * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0))
  m.ponerParches([{ x: 30, y: 40, ancho: 20, alto: 10, datos: rojo }], 'a')
  const conParche = m.leer(reveladoNeutro(), A, H)
  ok(pixel(conParche, A, 35, 45).join() === '255,0,0' && igualA(conParche, A, 100, 100, 100, 100), 'el parche se pega donde va y lo demás no cambia')
  const parcheGirado = m.leer(conGeo({ giro: 2 }), A, H)
  ok(pixel(parcheGirado, A, A - 1 - 35, H - 1 - 45).join() === '255,0,0', 'y gira con la foto')
  m.ponerParches(null, '')
  ok(igualA(m.leer(reveladoNeutro(), A, H), A, 35, 45, 35, 45), 'sin parches, la foto vuelve a estar como era')

  lineas.push('Limpiar: ruido y objetivo')
  // Gris con ruido de luz y de color, como una foto de noche.
  let semilla = 11
  const azar = (): number => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  const ruidosa = new Uint8Array(A * H * 4)
  for (let i = 0; i < A * H; i++) {
    const l = azar() * 14
    ruidosa[i * 4] = 120 + l + azar() * 12
    ruidosa[i * 4 + 1] = 120 + l + azar() * 12
    ruidosa[i * 4 + 2] = 120 + l + azar() * 12
    ruidosa[i * 4 + 3] = 255
  }
  m.cargar({ rgba: ruidosa, ancho: A, alto: H, p3: false })
  const ruidoDe = (px: Uint8Array): { luz: number; color: number; media: number } => {
    let sl = 0
    let sc = 0
    let media = 0
    const n = A * H
    for (let i = 0; i < n; i++) media += (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3
    media /= n
    for (let i = 0; i < n; i++) {
      const l = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3
      sl += (l - media) ** 2
      sc += (px[i * 4] - l) ** 2 + (px[i * 4 + 2] - l) ** 2
    }
    return { luz: Math.sqrt(sl / n), color: Math.sqrt(sc / n / 2), media }
  }
  const sin = ruidoDe(m.leer(reveladoNeutro(), A, H))
  const luzR = ruidoDe(m.leer(con({ ruidoL: 70 }), A, H))
  const colorR = ruidoDe(m.leer(con({ ruidoC: 70 }), A, H))
  ok(
    luzR.luz < sin.luz * 0.6 && Math.abs(luzR.media - sin.media) < 1.5,
    'Luminancia quita ruido de luz sin cambiar la luz',
    `${sin.luz.toFixed(1)} → ${luzR.luz.toFixed(1)}`
  )
  ok(
    colorR.color < sin.color * 0.5 && colorR.luz > sin.luz * 0.85,
    'Color quita las manchas de color y deja la luz',
    `color ${sin.color.toFixed(1)} → ${colorR.color.toFixed(1)}, luz ${colorR.luz.toFixed(1)}`
  )
  const conDetalle = ruidoDe(m.leer(con({ ruidoL: 70, ruidoLContraste: 100 }), A, H))
  ok(conDetalle.luz > luzR.luz, 'Contraste devuelve parte de la textura', `${luzR.luz.toFixed(1)} → ${conDetalle.luz.toFixed(1)}`)
  m.cargar({ rgba: img, ancho: A, alto: H, p3: false })
  const distorsionada = m.leer(con({ distorsion: 60 }), A, H)
  ok(
    igualA(distorsionada, A, A / 2, H / 4, A / 2, H / 4) && difMedia(distorsionada, neutro) > 1,
    'la distorsión deja el centro y mueve lo de alrededor',
    `cambio medio ${difMedia(distorsionada, neutro).toFixed(2)}`
  )
  m.ponerAberracion({ rojo: 0.01, azul: -0.01 })
  ok(difMax(m.leer(con({}), A, H), neutro) <= 2, 'la aberración medida no hace nada si no se pide')
  ok(difMedia(m.leer(con({ aberracion: true }), A, H), neutro) > 0.3, 'y la corrige si se pide')
  m.ponerAberracion({ rojo: 0, azul: 0 })
  // Un borde con flecos morados: el desflecado los apaga.
  const flecos = new Uint8Array(A * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < A; x++) {
      const i = (y * A + x) * 4
      const c = x < A / 2 - 2 ? [245, 245, 245] : x < A / 2 + 2 ? [150, 40, 210] : [20, 20, 20]
      flecos.set([...c, 255], i)
    }
  m.cargar({ rgba: flecos, ancho: A, alto: H, p3: false })
  const [fr, fg, fb] = pixel(m.leer(con({ desflecarMorado: 100 }), A, H), A, A / 2, H / 2)
  ok(Math.max(fr, fg, fb) - Math.min(fr, fg, fb) < 60, 'Desflecar morado apaga el fleco', `de 150,40,210 a ${fr},${fg},${fb}`)
  const [dr, dg, db] = pixel(m.leer(con({ desflecarVerde: 100 }), A, H), A, A / 2, H / 2)
  ok(Math.abs(dr - 150) < 6 && Math.abs(dg - 40) < 6 && Math.abs(db - 210) < 6, 'y el verde lo deja', `${dr},${dg},${db}`)
  m.cargar({ rgba: img, ancho: A, alto: H, p3: false })

  lineas.push('Tamaño completo')
  for (const [w, h] of [
    [4032, 3024],
    [5712, 4284]
  ]) {
    const grande = new Uint8Array(w * h * 4)
    for (let i = 0; i < grande.length; i += 4) {
      grande[i] = (i >> 4) & 255
      grande[i + 1] = (i >> 10) & 255
      grande[i + 2] = 128
      grande[i + 3] = 255
    }
    const t0 = performance.now()
    m.cargar({ rgba: grande, ancho: w, alto: h, p3: true })
    const t1 = performance.now()
    const todo = con({
      grano: 40,
      halo: 30,
      claridad: 30,
      textura: 20,
      suavizado: 10,
      vineteado: 30,
      neblina: 10,
      contraste: 20
    })
    const sal = m.exportar(todo)
    const t2 = performance.now()
    ok(
      sal.ancho === w && sal.alto === h && sal.pixeles.length === w * h * 4,
      `exporta ${w}×${h} (${((w * h) / 1e6).toFixed(1)} MP)`,
      `subir ${(t1 - t0).toFixed(0)} ms, revelar y leer ${(t2 - t1).toFixed(0)} ms`
    )
    const t3 = performance.now()
    m.pintar(todo, 2700, 1950, false)
    m.leer(reveladoNeutro(), 2, 2, 'sync:')
    ok(true, 'vista previa de 2700×1950 con todo puesto', `${(performance.now() - t3).toFixed(0)} ms`)
    const t4 = performance.now()
    const limpiar = { ...todo, ruidoL: 40, ruidoC: 50, distorsion: 20, desflecarMorado: 30 }
    m.pintar(limpiar, 2700, 1950, false)
    m.leer(reveladoNeutro(), 2, 2, 'sync:')
    const t5 = performance.now()
    m.pintar({ ...limpiar, contraste: 30 }, 2700, 1950, false)
    m.leer(reveladoNeutro(), 2, 2, 'sync:')
    ok(
      true,
      'limpiar a tamaño completo (ruido y objetivo)',
      `${(t5 - t4).toFixed(0)} ms la primera vez, ${(performance.now() - t5).toFixed(0)} ms al mover otro control`
    )
  }

  lineas.push(`\n${pruebas - fallos} de ${pruebas} comprobaciones bien`)
  return lineas.join('\n')
}

;(window as unknown as { ejecutar: () => string }).ejecutar = ejecutar

/** Lo que hace Exportar después del motor: codificar, meter el EXIF y que se pueda abrir. */
export async function exportacion(): Promise<string> {
  const { insertarExifJpeg, insertarExifPng, exifDeJpeg, prepararExif } = await import('../../src/shared/exif')
  const out: string[] = ['Exportación']
  let mal = 0
  const comprobar = (c: unknown, que: string, detalle = ''): void => {
    if (!c) mal++
    out.push(`${c ? '  ✓' : '  ✗'} ${que}${detalle ? ` (${detalle})` : ''}`)
  }
  const m = new Motor(document.createElement('canvas'))
  const w = 4032
  const h = 3024
  m.cargar({ rgba: imagenDePrueba(w, h), ancho: w, alto: h, p3: false })
  const { pixeles } = m.exportar(con({ grano: 30, vineteado: 20 }))
  // Un EXIF mínimo, con orientación 6, como el de un iPhone en vertical.
  const tiff = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0])
  const listo = prepararExif(tiff, w, h)!
  for (const formato of ['jpeg', 'png'] as const) {
    const t0 = performance.now()
    const lienzo = new OffscreenCanvas(w, h)
    lienzo.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixeles.buffer as ArrayBuffer), w, h), 0, 0)
    const blob = await lienzo.convertToBlob(formato === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 })
    let datos = new Uint8Array(await blob.arrayBuffer())
    datos = formato === 'png' ? insertarExifPng(datos, listo) : insertarExifJpeg(datos, listo)
    const t1 = performance.now()
    const bmp = await createImageBitmap(new Blob([datos as BlobPart]))
    comprobar(
      bmp.width === w && bmp.height === h,
      `${formato.toUpperCase()} de ${w}×${h} se abre`,
      `${(datos.length / 1e6).toFixed(1)} MB en ${(t1 - t0).toFixed(0)} ms`
    )
    if (formato === 'jpeg') {
      const e = exifDeJpeg(datos)
      comprobar(!!e && e[19] === 1, 'lleva su EXIF, con la orientación en normal')
    }
  }
  out.push(`\n${mal ? 'HAY FALLOS' : 'todo bien'}`)
  return out.join('\n')
}
;(window as unknown as { exportacion: () => Promise<string> }).exportacion = exportacion
