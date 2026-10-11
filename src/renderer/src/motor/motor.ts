/**
 * El motor de revelado: la foto en la tarjeta gráfica y las pasadas que la
 * convierten en lo que dice el revelado.
 *
 * La misma cadena sirve para tres cosas:
 *   - pintar la vista previa en el lienzo, al tamaño de la pantalla;
 *   - exportar a tamaño completo, leyendo los píxeles de vuelta;
 *   - hornear un LUT: pasar una rejilla de colores por la parte de color de
 *     la cadena (sin grano, halo, viñeteado ni nada que mire alrededor).
 */
import { CANALES, curvaEsRecta, type Revelado } from '@shared/revelado'
import { rejillaIdentidad, type Lut3D } from '@shared/cube'
import { BASE, DESENFOCAR, FINAL, REDUCIR, UMBRAL, VERTICE } from './shaders'
import {
  ANCHO_CURVAS,
  CENTROS_MEZCLA,
  PROPORCION,
  balance,
  matrizCalibracion,
  mezcla,
  tablaCurvas,
  tinteDeRueda
} from './uniformes'

export interface Fuente {
  /** JPEG y PNG, decodificados por el navegador. */
  bitmap?: ImageBitmap
  /** HEIC, ya decodificado: RGBA de 8 bits, la fila de arriba primero. */
  rgba?: Uint8Array
  ancho: number
  alto: number
  p3: boolean
}

interface Objetivo {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  ancho: number
  alto: number
  formato: number
}

interface Programa {
  prog: WebGLProgram
  sitios: Map<string, WebGLUniformLocation | null>
}

type Modo = { neutro: boolean; soloColor: boolean; voltear: boolean; p3: boolean; tramado: boolean }

export class Motor {
  readonly gl: WebGL2RenderingContext
  readonly maxTextura: number
  private progs: Record<'base' | 'reducir' | 'desenfocar' | 'umbral' | 'final', Programa>
  private vao: WebGLVertexArrayObject
  private fuente: WebGLTexture | null = null
  private fuenteInfo: { ancho: number; alto: number; p3: boolean } | null = null
  private curvas: WebGLTexture
  private claveCurvas = ''
  private lut: WebGLTexture
  private lutInfo: Lut3D | null = null
  private negro: WebGLTexture
  private objetivos = new Map<string, Objetivo>()
  private perdido = false

  constructor(readonly lienzo: HTMLCanvasElement) {
    const gl = lienzo.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('Este equipo no tiene WebGL 2: ROOM necesita la tarjeta gráfica para revelar')
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('La tarjeta gráfica no sabe pintar en coma flotante (EXT_color_buffer_float)')
    }
    this.gl = gl
    this.maxTextura = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    lienzo.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.perdido = true
    })

    this.progs = {
      base: this.compilar(BASE),
      reducir: this.compilar(REDUCIR),
      desenfocar: this.compilar(DESENFOCAR),
      umbral: this.compilar(UMBRAL),
      final: this.compilar(FINAL)
    }

    // Un triángulo que cubre toda la pantalla.
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    for (const p of Object.values(this.progs)) {
      const loc = gl.getAttribLocation(p.prog, 'aPos')
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      }
    }

    this.curvas = this.texturaVacia(gl.TEXTURE_2D)
    this.subirCurvas(null)
    this.lut = this.texturaVacia(gl.TEXTURE_3D)
    this.subirLut(null)
    this.negro = this.texturaVacia(gl.TEXTURE_2D)
    gl.bindTexture(gl.TEXTURE_2D, this.negro)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4))
  }

  get contextoPerdido(): boolean {
    return this.perdido || this.gl.isContextLost()
  }

  /* ---------- Programas y texturas ---------- */

  private compilar(fragmento: string): Programa {
    const gl = this.gl
    const sombreador = (tipo: number, fuente: string): WebGLShader => {
      const s = gl.createShader(tipo)!
      gl.shaderSource(s, fuente)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(`El revelador no compila: ${gl.getShaderInfoLog(s)}`)
      }
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sombreador(gl.VERTEX_SHADER, VERTICE))
    gl.attachShader(prog, sombreador(gl.FRAGMENT_SHADER, fragmento))
    gl.bindAttribLocation(prog, 0, 'aPos')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`El revelador no enlaza: ${gl.getProgramInfoLog(prog)}`)
    }
    return { prog, sitios: new Map() }
  }

  private texturaVacia(tipo: number): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(tipo, t)
    gl.texParameteri(tipo, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(tipo, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(tipo, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(tipo, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (tipo === gl.TEXTURE_3D) gl.texParameteri(tipo, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    return t
  }

  private objetivo(nombre: string, ancho: number, alto: number, formato: number): Objetivo {
    const gl = this.gl
    const clave = nombre
    const hay = this.objetivos.get(clave)
    if (hay && hay.ancho === ancho && hay.alto === alto && hay.formato === formato) return hay
    if (hay) {
      gl.deleteTexture(hay.tex)
      gl.deleteFramebuffer(hay.fbo)
    }
    const tex = this.texturaVacia(gl.TEXTURE_2D)
    const tipo = formato === gl.RGBA8 ? gl.UNSIGNED_BYTE : formato === gl.RGBA16F ? gl.HALF_FLOAT : gl.FLOAT
    if (formato === gl.RGBA32F) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, formato, ancho, alto, 0, gl.RGBA, tipo, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`No hay memoria en la tarjeta gráfica para una imagen de ${ancho}×${alto}`)
    }
    const o = { tex, fbo, ancho, alto, formato }
    this.objetivos.set(clave, o)
    return o
  }

  /** Suelta las imágenes intermedias de un tamaño que ya no se usa (las de exportar, que son enormes). */
  soltar(prefijo: string): void {
    for (const [clave, o] of this.objetivos) {
      if (!clave.startsWith(prefijo)) continue
      this.gl.deleteTexture(o.tex)
      this.gl.deleteFramebuffer(o.fbo)
      this.objetivos.delete(clave)
    }
  }

  private subirCurvas(tabla: Float32Array | null): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.curvas)
    let datos = tabla
    if (!datos) {
      datos = new Float32Array(ANCHO_CURVAS * 4)
      for (let i = 0; i < ANCHO_CURVAS; i++) datos.fill(i / (ANCHO_CURVAS - 1), i * 4, i * 4 + 4)
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, ANCHO_CURVAS, 1, 0, gl.RGBA, gl.FLOAT, datos)
  }

  private subirLut(lut: Lut3D | null): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_3D, this.lut)
    const tam = lut?.tamano ?? 2
    const datos = lut?.datos ?? rejillaIdentidad(2)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, tam, tam, tam, 0, gl.RGB, gl.FLOAT, datos)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  }

  /** El LUT que se aplica, o ninguno. */
  ponerLut(lut: Lut3D | null): void {
    if (lut === this.lutInfo) return
    this.lutInfo = lut
    this.subirLut(lut)
  }

  /* ---------- La foto ---------- */

  get hayFoto(): boolean {
    return !!this.fuente
  }

  get medidas(): { ancho: number; alto: number } | null {
    return this.fuenteInfo ? { ancho: this.fuenteInfo.ancho, alto: this.fuenteInfo.alto } : null
  }

  cargar(f: Fuente): void {
    const gl = this.gl
    if (f.ancho > this.maxTextura || f.alto > this.maxTextura) {
      throw new Error(`La foto mide ${f.ancho}×${f.alto} y la tarjeta gráfica llega a ${this.maxTextura} por lado`)
    }
    if (this.fuente) gl.deleteTexture(this.fuente)
    const t = this.texturaVacia(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    if (f.bitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, f.bitmap)
    } else if (f.rgba) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, f.ancho, f.alto, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.rgba)
    }
    // Las mipmaps son lo que hace que la vista previa reducida no salga con dientes de sierra.
    gl.generateMipmap(gl.TEXTURE_2D)
    this.fuente = t
    this.fuenteInfo = { ancho: f.ancho, alto: f.alto, p3: f.p3 }
  }

  descargar(): void {
    if (this.fuente) this.gl.deleteTexture(this.fuente)
    this.fuente = null
    this.fuenteInfo = null
  }

  /* ---------- Las pasadas ---------- */

  private usar(p: Programa): (nombre: string) => WebGLUniformLocation | null {
    this.gl.useProgram(p.prog)
    return (nombre: string) => {
      if (!p.sitios.has(nombre)) p.sitios.set(nombre, this.gl.getUniformLocation(p.prog, nombre))
      return p.sitios.get(nombre)!
    }
  }

  private dibujar(destino: Objetivo | null, ancho: number, alto: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, destino?.fbo ?? null)
    gl.viewport(0, 0, ancho, alto)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private textura(unidad: number, tex: WebGLTexture, tipo: number = this.gl.TEXTURE_2D): number {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unidad)
    gl.bindTexture(tipo, tex)
    return unidad
  }

  private desenfocar(entrada: Objetivo, prefijo: string, nombre: string, sigma: number): Objetivo {
    const gl = this.gl
    const tmp = this.objetivo(`${prefijo}${nombre}-h`, entrada.ancho, entrada.alto, gl.RGBA16F)
    const sal = this.objetivo(`${prefijo}${nombre}`, entrada.ancho, entrada.alto, gl.RGBA16F)
    const u = this.usar(this.progs.desenfocar)
    gl.uniform1f(u('uSigma'), sigma)
    gl.uniform1i(u('uTex'), this.textura(0, entrada.tex))
    gl.uniform2f(u('uDir'), 1 / entrada.ancho, 0)
    this.dibujar(tmp, tmp.ancho, tmp.alto)
    gl.uniform1i(u('uTex'), this.textura(0, tmp.tex))
    gl.uniform2f(u('uDir'), 0, 1 / entrada.alto)
    this.dibujar(sal, sal.ancho, sal.alto)
    return sal
  }

  /**
   * La cadena entera, de la textura de entrada al destino (`null` es el lienzo).
   * `prefijo` separa las imágenes intermedias de la vista previa, las de
   * exportar y las del horneado, para que no se pisen.
   */
  private revelar(r: Revelado, entrada: WebGLTexture, ancho: number, alto: number, destino: Objetivo | null, modo: Modo, prefijo: string): void {
    const gl = this.gl
    if (this.contextoPerdido) throw new Error('La tarjeta gráfica se ha reiniciado: vuelve a abrir la foto')
    const largo = Math.max(ancho, alto)

    // 1. Base
    const base = this.objetivo(`${prefijo}base`, ancho, alto, modo.soloColor ? gl.RGBA32F : gl.RGBA16F)
    let u = this.usar(this.progs.base)
    gl.uniform1i(u('uFuente'), this.textura(0, entrada))
    gl.uniform1i(u('uVoltear'), modo.voltear ? 1 : 0)
    gl.uniform1i(u('uP3'), modo.p3 ? 1 : 0)
    gl.uniform1i(u('uNeutro'), modo.neutro ? 1 : 0)
    gl.uniform3fv(u('uBalance'), balance(r.temperatura, r.tinte, r.exposicion))
    gl.uniformMatrix3fv(u('uCal'), false, matrizCalibracion(r))
    gl.uniform1f(u('uCalSombras'), r.calSombras / 100)
    this.dibujar(base, ancho, alto)

    // 2. Desenfoques: solo los que hacen falta.
    let peq: Objetivo | null = null
    let grande: Objetivo | null = null
    let halo: Objetivo | null = null
    if (!modo.neutro && !modo.soloColor) {
      if (r.suavizado || r.textura) peq = this.desenfocar(base, prefijo, 'peq', Math.max(1, PROPORCION.fino * largo))
      if (r.claridad || r.neblina || r.halo) {
        const cuarto = this.objetivo(`${prefijo}cuarto`, Math.max(1, Math.ceil(ancho / 4)), Math.max(1, Math.ceil(alto / 4)), gl.RGBA16F)
        u = this.usar(this.progs.reducir)
        gl.uniform1i(u('uTex'), this.textura(0, base.tex))
        gl.uniform2f(u('uTexel'), 1 / ancho, 1 / alto)
        this.dibujar(cuarto, cuarto.ancho, cuarto.alto)
        if (r.claridad || r.neblina) grande = this.desenfocar(cuarto, prefijo, 'grande', (PROPORCION.ancho * largo) / 4)
        if (r.halo) {
          const brillo = this.objetivo(`${prefijo}brillo`, cuarto.ancho, cuarto.alto, gl.RGBA16F)
          u = this.usar(this.progs.umbral)
          gl.uniform1i(u('uTex'), this.textura(0, cuarto.tex))
          this.dibujar(brillo, brillo.ancho, brillo.alto)
          halo = this.desenfocar(brillo, prefijo, 'halo', (PROPORCION.halo * largo) / 4)
        }
      }
    }

    // 3. Final
    u = this.usar(this.progs.final)
    const tabla = tablaCurvas(r)
    const clave = tabla ? JSON.stringify(r.curvas) : ''
    if (clave !== this.claveCurvas) {
      this.subirCurvas(tabla)
      this.claveCurvas = clave
    }
    gl.uniform1i(u('uBase'), this.textura(0, base.tex))
    gl.uniform1i(u('uPeq'), this.textura(1, peq?.tex ?? base.tex))
    gl.uniform1i(u('uGrande'), this.textura(2, grande?.tex ?? base.tex))
    gl.uniform1i(u('uHalo'), this.textura(3, halo?.tex ?? this.negro))
    gl.uniform1i(u('uCurvas'), this.textura(4, this.curvas))
    gl.uniform1i(u('uLut'), this.textura(5, this.lut, gl.TEXTURE_3D))

    gl.uniform1i(u('uNeutro'), modo.neutro ? 1 : 0)
    gl.uniform1i(u('uSoloColor'), modo.soloColor ? 1 : 0)
    gl.uniform1i(u('uTramado'), modo.tramado ? 1 : 0)

    gl.uniform1f(u('uSuave'), (r.suavizado / 100) * 0.85)
    gl.uniform1f(u('uTextura'), r.textura / 100)
    gl.uniform1f(u('uClaridad'), r.claridad / 100)
    gl.uniform1f(u('uNeblina'), r.neblina / 100)
    gl.uniform1f(u('uContraste'), r.contraste / 100)
    gl.uniform1f(u('uLuces'), r.luces / 100)
    gl.uniform1f(u('uSombras'), r.sombras / 100)
    gl.uniform1f(u('uBlancos'), r.blancos / 100)
    gl.uniform1f(u('uNegros'), r.negros / 100)
    gl.uniform1f(u('uViveza'), r.viveza / 100)
    gl.uniform1f(u('uSaturacion'), r.saturacion / 100)
    gl.uniform1i(u('uHayCurva'), CANALES.some((c) => !curvaEsRecta(r.curvas[c])) ? 1 : 0)

    const mz = mezcla(r)
    gl.uniform1fv(u('uCentros'), CENTROS_MEZCLA)
    gl.uniform1fv(u('uMixH'), mz.h)
    gl.uniform1fv(u('uMixS'), mz.s)
    gl.uniform1fv(u('uMixL'), mz.l)

    gl.uniform2fv(u('uTintS'), tinteDeRueda(r.ruedas.sombras))
    gl.uniform2fv(u('uTintM'), tinteDeRueda(r.ruedas.medios))
    gl.uniform2fv(u('uTintH'), tinteDeRueda(r.ruedas.luces))
    gl.uniform3f(u('uLumRuedas'), r.lumSombras / 100, r.lumMedios / 100, r.lumLuces / 100)
    gl.uniform1f(u('uFusion'), r.fusion / 100)
    gl.uniform1f(u('uEquilibrio'), r.equilibrio / 100)

    const lut = r.lut ? this.lutInfo : null
    gl.uniform1i(u('uHayLut'), lut ? 1 : 0)
    gl.uniform1f(u('uLutMezcla'), r.intensidadLut / 100)
    gl.uniform1f(u('uLutTam'), lut?.tamano ?? 2)
    gl.uniform3fv(u('uLutMin'), lut?.dominioMin ?? [0, 0, 0])
    gl.uniform3fv(u('uLutMax'), lut?.dominioMax ?? [1, 1, 1])

    gl.uniform1f(u('uHaloCant'), r.halo / 100)
    gl.uniform1f(u('uVineta'), r.vineteado / 100)
    gl.uniform1f(u('uAspecto'), ancho / alto)
    gl.uniform1f(u('uGrano'), r.grano / 100)
    const tam = PROPORCION.granoMin + (PROPORCION.granoMax - PROPORCION.granoMin) * (r.tamanoGrano / 100)
    gl.uniform1f(u('uGranoTam'), Math.max(0.6, tam * largo))
    gl.uniform1f(u('uGranoAsp'), r.asperezaGrano / 100)
    gl.uniform2f(u('uSemilla'), 17.31, 43.77)

    this.dibujar(destino, ancho, alto)
  }

  /* ---------- Lo que se le pide desde fuera ---------- */

  /** La vista previa: el lienzo pasa a medir `ancho × alto` y se pinta. */
  pintar(r: Revelado, ancho: number, alto: number, neutro: boolean): void {
    if (!this.fuente || !this.fuenteInfo) return
    if (this.lienzo.width !== ancho) this.lienzo.width = ancho
    if (this.lienzo.height !== alto) this.lienzo.height = alto
    this.revelar(r, this.fuente, ancho, alto, null, { neutro, soloColor: false, voltear: true, p3: this.fuenteInfo.p3, tramado: true }, 'vista:')
  }

  /** Revela a `ancho × alto` y devuelve los píxeles RGBA, con la fila de arriba primero. */
  leer(r: Revelado, ancho: number, alto: number, prefijo = 'exportar:'): Uint8Array {
    if (!this.fuente || !this.fuenteInfo) throw new Error('No hay foto cargada')
    const gl = this.gl
    const sal = this.objetivo(`${prefijo}salida`, ancho, alto, gl.RGBA8)
    try {
      this.revelar(r, this.fuente, ancho, alto, sal, { neutro: false, soloColor: false, voltear: true, p3: this.fuenteInfo.p3, tramado: true }, prefijo)
      const px = new Uint8Array(ancho * alto * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, sal.fbo)
      gl.readPixels(0, 0, ancho, alto, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return voltearFilas(px, ancho, alto)
    } finally {
      this.soltar(prefijo)
    }
  }

  /** La foto revelada a tamaño completo. */
  exportar(r: Revelado): { ancho: number; alto: number; pixeles: Uint8Array } {
    const m = this.medidas
    if (!m) throw new Error('No hay foto cargada')
    return { ...m, pixeles: this.leer(r, m.ancho, m.alto) }
  }

  /**
   * El color del revelado como LUT de `tamano`³: la rejilla de colores pasa
   * por la base y el final en modo «solo color» y se lee en coma flotante.
   */
  hornearLut(r: Revelado, tamano = 33): Float32Array {
    const gl = this.gl
    const ancho = tamano * tamano
    const alto = tamano
    // La rejilla puesta en una imagen: x = rojo + verde·N, y = azul.
    const rejilla = rejillaIdentidad(tamano)
    const rgba = new Float32Array(ancho * alto * 4)
    for (let i = 0; i < tamano ** 3; i++) {
      rgba[i * 4] = rejilla[i * 3]
      rgba[i * 4 + 1] = rejilla[i * 3 + 1]
      rgba[i * 4 + 2] = rejilla[i * 3 + 2]
      rgba[i * 4 + 3] = 1
    }
    const entrada = this.texturaVacia(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ancho, alto, 0, gl.RGBA, gl.FLOAT, rgba)
    const prefijo = 'lut:'
    try {
      const sal = this.objetivo(`${prefijo}salida`, ancho, alto, gl.RGBA32F)
      this.revelar(r, entrada, ancho, alto, sal, { neutro: false, soloColor: true, voltear: false, p3: false, tramado: false }, prefijo)
      const px = new Float32Array(ancho * alto * 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, sal.fbo)
      gl.readPixels(0, 0, ancho, alto, gl.RGBA, gl.FLOAT, px)
      const datos = new Float32Array(tamano ** 3 * 3)
      for (let i = 0; i < tamano ** 3; i++) {
        datos[i * 3] = px[i * 4]
        datos[i * 3 + 1] = px[i * 4 + 1]
        datos[i * 3 + 2] = px[i * 4 + 2]
      }
      return datos
    } finally {
      gl.deleteTexture(entrada)
      this.soltar(prefijo)
    }
  }
}

function voltearFilas(px: Uint8Array, ancho: number, alto: number): Uint8Array {
  const fila = ancho * 4
  const r = new Uint8Array(px.length)
  for (let y = 0; y < alto; y++) r.set(px.subarray(y * fila, (y + 1) * fila), (alto - 1 - y) * fila)
  return r
}
