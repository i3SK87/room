/**
 * Los programas de la tarjeta gráfica, en GLSL ES 3.00 (WebGL 2).
 *
 * El revelado va por pasadas:
 *
 *   0. LIMPIAR  solo si hace falta, a tamaño completo y guardado aparte:
 *               distorsión, aberración, flecos y ruido.
 *   1. BASE     la foto en luz lineal, ya recortada, enderezada y girada: de
 *               P3 a sRGB si hace falta, balance de blancos, exposición y
 *               calibración.
 *   2. Desenfoques de la base, para lo que mira alrededor de cada píxel: uno
 *      fino (textura y suavizado), uno ancho a un cuarto de tamaño (claridad y
 *      neblina) y el de las luces fuertes (el halo).
 *   3. FINAL    todo lo demás, píxel a píxel: presencia, tono, curva,
 *               mezclador, saturación, gradación, LUT, halo, viñeteado y grano.
 *
 * Los radios de los desenfoques y el tamaño del grano van en proporción al
 * lado largo de la foto, no en píxeles: así la vista previa, que se calcula
 * más pequeña, se parece a la exportada a tamaño completo.
 *
 * Con todo en cero, cada paso deja el color como estaba: la foto sale tal cual.
 */

export const VERTICE = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const COMUN = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 salida;

vec3 aLineal(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 aSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Luminancia «a ojo»: la escala en la que trabajan los deslizadores de tono.
float percep(float y) { return pow(max(y, 0.0), 1.0 / 2.2); }
float desPercep(float x) { return pow(max(x, 0.0), 2.2); }

float cbrt(float x) { return sign(x) * pow(abs(x), 1.0 / 3.0); }
vec3 aOklab(vec3 c) {
  float l = cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  float m = cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  float s = cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 deOklab(vec3 L) {
  float l = L.x + 0.3963377774 * L.y + 0.2158037573 * L.z;
  float m = L.x - 0.1055613458 * L.y - 0.0638541728 * L.z;
  float s = L.x - 0.0894841775 * L.y - 1.2914855480 * L.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}
`

/* ---------- 1. Base ---------- */

export const BASE =
  COMUN +
  /* glsl */ `
uniform sampler2D uFuente;
uniform bool uVoltear;
uniform bool uP3;
uniform bool uNeutro;
uniform vec3 uBalance;
uniform mat3 uCal;
uniform float uCalSombras;
// De la salida a la foto: recorte, enderezado, volteos y giros, en una matriz.
uniform mat3 uGeo;

// Display P3 lineal a sRGB lineal (por columnas).
const mat3 P3_A_SRGB = mat3(
  1.2249401, -0.0420569, -0.0196376,
  -0.2249404, 1.0420571, -0.0786361,
  0.0, 0.0, 1.0982735);

void main() {
  vec2 t = uVoltear ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec2 uv = (uGeo * vec3(t, 1.0)).xy;
  // Lo que cae fuera de la foto (al enderezar, en el modo Recortar) va en negro.
  if (any(lessThan(uv, vec2(-1e-4))) || any(greaterThan(uv, vec2(1.0 + 1e-4)))) {
    salida = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 c = aLineal(texture(uFuente, uv).rgb);
  if (uP3) c = P3_A_SRGB * c;
  if (!uNeutro) {
    c *= uBalance;
    c = uCal * c;
    float w = 1.0 - smoothstep(0.0, 0.2, luma(c));
    // Positivo, hacia el magenta: le quita verde a las sombras.
    c.g *= 1.0 - uCalSombras * 0.3 * w;
  }
  salida = vec4(max(c, 0.0), 1.0);
}
`

/* ---------- 0. Limpiar, a tamaño completo ---------- */

/*
 * Antes de revelar, lo que arregla la foto en sí: el objetivo y el ruido. Va
 * a tamaño completo, píxel a píxel de la foto, porque el ruido y los flecos
 * de color son cosa de un píxel o dos; la vista previa lo ve ya reducido.
 * Todo en la codificación de la foto (sRGB), que es donde se ve el ruido.
 */

/** Distorsión y aberración cromática: dónde leer cada canal. Y desflecar. */
export const LENTE =
  COMUN +
  /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTam;
uniform float uK;
uniform float uEscala;
uniform vec2 uCa;
uniform float uMorado;
uniform float uVerde;

float difAngulo(float a, float b) { return mod(a - b + 540.0, 360.0) - 180.0; }

void main() {
  vec2 q = (vUv - 0.5) * uTam / (0.5 * length(uTam));
  vec2 s = 0.5 + (vUv - 0.5) * (1.0 - uK * dot(q, q)) * uEscala;
  vec3 c = vec3(
    texture(uTex, 0.5 + (s - 0.5) * (1.0 + uCa.x)).r,
    texture(uTex, s).g,
    texture(uTex, 0.5 + (s - 0.5) * (1.0 + uCa.y)).b);
  if (uMorado > 0.0 || uVerde > 0.0) {
    // Los flecos salen en los bordes con mucho contraste: se mira cuánto cambia la luz alrededor.
    vec2 px = 2.0 / uTam;
    float mn = 1.0, mx = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      float l = luma(texture(uTex, s + vec2(cos(a), sin(a)) * px).rgb);
      mn = min(mn, l);
      mx = max(mx, l);
    }
    float borde = smoothstep(0.08, 0.3, mx - mn);
    vec3 lab = aOklab(aLineal(c));
    float C = length(lab.yz);
    float h = degrees(atan(lab.z, lab.y));
    float morado = uMorado * (1.0 - smoothstep(22.0, 45.0, abs(difAngulo(h, 318.0))));
    float verde = uVerde * (1.0 - smoothstep(22.0, 45.0, abs(difAngulo(h, 145.0))));
    float quita = clamp((morado + verde) * 1.6 * borde * smoothstep(0.015, 0.05, C), 0.0, 1.0);
    lab.yz *= 1.0 - quita;
    c = clamp(aSrgb(max(deOklab(lab), 0.0)), 0.0, 1.0);
  }
  salida = vec4(c, 1.0);
}
`

/**
 * Ruido de color, en una dirección (se pasa dos veces): se promedia el color
 * con el de los vecinos de luz parecida, y la luz de cada píxel se queda como
 * estaba. Así las manchas de colores desaparecen sin emborronar la foto.
 */
export const RUIDO_COLOR =
  COMUN +
  /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uRadio;
uniform float uSigmaLuz;
void main() {
  vec3 c0 = texture(uTex, vUv).rgb;
  float y0 = luma(c0);
  vec3 suma = vec3(0.0);
  float peso = 0.0;
  float sigma = max(uRadio / 2.2, 0.5);
  for (int i = -16; i <= 16; i++) {
    float k = float(i);
    if (abs(k) > uRadio) continue;
    vec3 c = texture(uTex, vUv + uDir * k).rgb;
    float y = luma(c);
    float dl = (y - y0) / uSigmaLuz;
    float w = exp(-k * k / (2.0 * sigma * sigma) - 0.5 * dl * dl);
    suma += (c - y) * w;
    peso += w;
  }
  salida = vec4(clamp(y0 + suma / peso, 0.0, 1.0), 1.0);
}
`

/**
 * Ruido de luz: un bilateral de 7×7 sobre la luz. Promedia con los vecinos
 * que se le parecen y deja los bordes. Detalle decide cuánto se tienen que
 * parecer; Contraste devuelve parte de la textura que se lleva.
 */
export const RUIDO_LUZ =
  COMUN +
  /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uFuerza;
uniform float uSigmaLuz;
uniform float uSigmaEsp;
uniform float uContraste;
void main() {
  vec3 c0 = texture(uTex, vUv).rgb;
  float y0 = luma(c0);
  float suma = 0.0;
  float peso = 0.0;
  for (int dy = -3; dy <= 3; dy++)
    for (int dx = -3; dx <= 3; dx++) {
      vec2 o = vec2(float(dx), float(dy));
      float y = luma(texture(uTex, vUv + o * uTexel).rgb);
      float dl = (y - y0) / uSigmaLuz;
      float w = exp(-dot(o, o) / (2.0 * uSigmaEsp * uSigmaEsp) - 0.5 * dl * dl);
      suma += y * w;
      peso += w;
    }
  float yf = mix(y0, suma / peso, uFuerza);
  yf = mix(yf, y0, uContraste * 0.5);
  salida = vec4(clamp(c0 + (yf - y0), 0.0, 1.0), 1.0);
}
`

/* ---------- 2. Reducir y desenfocar ---------- */

/** A un cuarto: cuatro lecturas bilineales cubren el cuadro de 4×4. */
export const REDUCIR =
  COMUN +
  /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 s = texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  salida = vec4(s * 0.25, 1.0);
}
`

/** Gaussiano en una dirección. Con radios grandes salta de dos en dos, de tres en tres… */
export const DESENFOCAR =
  COMUN +
  /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  if (uSigma < 0.35) { salida = texture(uTex, vUv); return; }
  float radio = ceil(uSigma * 3.0);
  float paso = max(1.0, radio / 40.0);
  float n = ceil(radio / paso);
  vec4 suma = vec4(0.0);
  float peso = 0.0;
  for (int i = -40; i <= 40; i++) {
    float k = float(i);
    if (abs(k) > n) continue;
    float x = k * paso;
    float w = exp(-x * x / (2.0 * uSigma * uSigma));
    suma += texture(uTex, vUv + uDir * x) * w;
    peso += w;
  }
  salida = suma / peso;
}
`

/** Lo que va a brillar en el halo: solo las luces fuertes. */
export const UMBRAL =
  COMUN +
  /* glsl */ `
uniform sampler2D uTex;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  salida = vec4(c * smoothstep(0.5, 1.2, luma(c)), 1.0);
}
`

/* ---------- 3. Final ---------- */

export const FINAL =
  COMUN +
  /* glsl */ `
uniform sampler2D uBase;
uniform sampler2D uPeq;
uniform sampler2D uGrande;
uniform sampler2D uHalo;
uniform sampler2D uCurvas;
uniform sampler3D uLut;

uniform bool uNeutro;
uniform bool uSoloColor;
uniform bool uTramado;

uniform float uSuave;
uniform float uTextura;
uniform float uClaridad;
uniform float uNeblina;
uniform float uContraste;
uniform float uLuces;
uniform float uSombras;
uniform float uBlancos;
uniform float uNegros;
uniform float uViveza;
uniform float uSaturacion;
uniform bool uHayCurva;

uniform float uCentros[8];
uniform float uMixH[8];
uniform float uMixS[8];
uniform float uMixL[8];

uniform vec2 uTintS;
uniform vec2 uTintM;
uniform vec2 uTintH;
uniform vec3 uLumRuedas;
uniform float uFusion;
uniform float uEquilibrio;

uniform bool uHayLut;
uniform float uLutMezcla;
uniform float uLutTam;
uniform vec3 uLutMin;
uniform vec3 uLutMax;

uniform float uHaloCant;
uniform float uVineta;
uniform float uAspecto;
// Con zoom se revela solo un trozo de la foto: dónde cae en ella (x, y, ancho, alto)
// y en qué píxel empieza, para que el viñeteado y el grano no se muevan al desplazarse.
uniform vec4 uVentana;
uniform vec2 uOrigen;
uniform float uGrano;
uniform float uGranoTam;
uniform float uGranoAsp;
uniform vec2 uSemilla;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ruido(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y) - 0.5;
}
float grano(vec2 p) {
  float n = ruido(p);
  n += uGranoAsp * 0.6 * ruido(p * 2.03 + 17.0);
  n += uGranoAsp * 0.35 * ruido(p * 4.07 + 31.0);
  return n * 2.0 / (1.0 + uGranoAsp * 0.95);
}

float tono(float x) {
  float xc = clamp(x, 0.0, 1.0);
  float d = 0.0;
  d += uContraste * (xc * xc * (3.0 - 2.0 * xc) - xc);
  d += uLuces * 0.35 * smoothstep(0.45, 1.0, xc) * 4.0 * xc * (1.0 - xc);
  d += uSombras * 0.35 * (1.0 - smoothstep(0.0, 0.55, xc)) * 4.0 * xc * (1.0 - xc);
  d += uBlancos * 0.25 * smoothstep(0.4, 1.0, x);
  d += uNegros * 0.18 * (1.0 - smoothstep(0.0, 0.5, xc));
  return x + d;
}

// Cambia la luminancia de un color sin tocarle el tono.
vec3 conLuminancia(vec3 c, float y, float yNueva) {
  if (y < 1e-5) return vec3(yNueva);
  return c * (yNueva / y);
}

float curva(float v, int canal) {
  vec4 t = texture(uCurvas, vec2(clamp(v, 0.0, 1.0) * (1023.0 / 1024.0) + 0.5 / 1024.0, 0.5));
  return canal == 0 ? t.r : canal == 1 ? t.g : canal == 2 ? t.b : t.a;
}

float difAngulo(float a, float b) {
  float d = mod(a - b + 540.0, 360.0) - 180.0;
  return d;
}

void main() {
  vec3 c = texture(uBase, vUv).rgb;
  float tramado = uTramado ? (hash(gl_FragCoord.xy + 7.0) - 0.5) / 255.0 : 0.0;
  if (uNeutro) {
    salida = vec4(clamp(aSrgb(c) + tramado, 0.0, 1.0), 1.0);
    return;
  }

  vec3 gra = vec3(0.0);
  if (!uSoloColor) {
    vec3 peq = texture(uPeq, vUv).rgb;
    gra = texture(uGrande, vUv).rgb;
    // Suavizado: mezcla con el desenfoque fino, como un objetivo que no es del todo nítido.
    c = mix(c, peq, uSuave);
    // Presencia: contraste local, fino (textura) y ancho (claridad).
    float y = luma(c);
    float x = percep(y);
    float xn = x + uTextura * (x - percep(luma(peq))) * 2.0;
    float medios = clamp(1.0 - pow(abs(2.0 * clamp(x, 0.0, 1.0) - 1.0), 2.0), 0.0, 1.0);
    xn += uClaridad * (x - percep(luma(gra))) * 1.3 * medios;
    c = conLuminancia(c, y, desPercep(max(xn, 0.0)));
    if (uNeblina > 0.0) {
      float velo = uNeblina * 0.6 * min(min(gra.r, gra.g), gra.b);
      c = max(c - velo, 0.0) / (1.0 - velo * 0.9);
    } else if (uNeblina < 0.0) {
      c = mix(c, vec3(luma(gra)) * 0.85 + 0.12, -uNeblina * 0.55);
    }
  }

  // Tono: contraste, luces, sombras, blancos y negros.
  float y = luma(c);
  c = conLuminancia(c, y, desPercep(tono(percep(y))));

  // Curva de tonos: primero la de luz y luego la de cada canal.
  if (uHayCurva) {
    vec3 e = clamp(aSrgb(c), 0.0, 1.0);
    e = vec3(curva(e.r, 0), curva(e.g, 0), curva(e.b, 0));
    e = vec3(curva(e.r, 1), curva(e.g, 2), curva(e.b, 3));
    c = aLineal(e);
  }

  // Mezclador, saturación, viveza y gradación, en OKLab.
  vec3 lab = aOklab(c);
  float C = length(lab.yz);
  float h = degrees(atan(lab.z, lab.y));
  float dh = 0.0, ds = 0.0, dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float ci = uCentros[i];
    float sig = uCentros[(i + 1) % 8];
    float ant = uCentros[(i + 7) % 8];
    float d = difAngulo(h, ci);
    float w = d >= 0.0 ? 1.0 - d / max(difAngulo(sig, ci), 1.0) : 1.0 + d / max(difAngulo(ci, ant), 1.0);
    w = clamp(w, 0.0, 1.0);
    dh += w * uMixH[i];
    ds += w * uMixS[i];
    dl += w * uMixL[i];
  }
  float crom = smoothstep(0.015, 0.09, C);
  h += dh * 30.0 * crom;
  C *= max(0.0, 1.0 + ds * crom);
  lab.x *= 1.0 + dl * 0.3 * crom;
  C *= max(0.0, 1.0 + uSaturacion);
  C *= max(0.0, 1.0 + uViveza * 1.2 * (1.0 - smoothstep(0.0, 0.2, C)));
  float hr = radians(h);
  lab.yz = C * vec2(cos(hr), sin(hr));

  float pivote = 0.5 - uEquilibrio * 0.25;
  float ancho = mix(0.08, 0.45, uFusion);
  float wH = smoothstep(pivote - ancho, pivote + ancho, lab.x);
  float wS = 1.0 - wH;
  float wM = exp(-pow((lab.x - pivote) / (ancho * 0.9 + 0.05), 2.0));
  lab.yz += uTintS * wS + uTintM * wM + uTintH * wH;
  lab.x += (uLumRuedas.x * wS + uLumRuedas.y * wM + uLumRuedas.z * wH) * 0.12;
  c = max(deOklab(lab), 0.0);

  // LUT, con su intensidad.
  if (uHayLut) {
    vec3 e = clamp(aSrgb(c), 0.0, 1.0);
    vec3 t = clamp((e - uLutMin) / (uLutMax - uLutMin), 0.0, 1.0);
    vec3 l = texture(uLut, t * ((uLutTam - 1.0) / uLutTam) + 0.5 / uLutTam).rgb;
    c = aLineal(clamp(mix(e, l, uLutMezcla), 0.0, 1.0));
  }

  if (!uSoloColor) {
    // Halo: la luz que rebota en la base de la película y vuelve roja.
    c += texture(uHalo, vUv).rgb * vec3(1.0, 0.32, 0.12) * uHaloCant * 1.8;
    // Viñeteado: 0 en el centro, 1 en las esquinas.
    vec2 g = uVentana.xy + vec2(vUv.x, 1.0 - vUv.y) * uVentana.zw;
    vec2 q = (g - 0.5) * 2.0 * vec2(uAspecto, 1.0) / length(vec2(uAspecto, 1.0));
    float v = smoothstep(0.3, 1.05, length(q));
    c *= 1.0 - uVineta * 0.9 * v * v;
  }

  vec3 e = aSrgb(c);
  if (!uSoloColor && uGrano > 0.0) {
    float n = grano((gl_FragCoord.xy + uOrigen) / uGranoTam + uSemilla);
    float le = clamp(luma(e), 0.0, 1.0);
    e += n * uGrano * 0.16 * (0.35 + 2.6 * le * (1.0 - le));
  }
  salida = vec4(clamp(e + tramado, 0.0, 1.0), 1.0);
}
`
