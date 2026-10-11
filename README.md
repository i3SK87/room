# ROOM

Cuarto de revelado para Windows, de la casa de BONK y CLAC: abrir las fotos del
iPhone (HEIC, JPEG o PNG), revelarlas con los controles de Lightroom y los de
película —grano, halo, viñeteado, suavizado— y exportarlas. Las fotos entran
tal cual; nada se aplica solo.

## Qué hay

- **Revelado en la tarjeta gráfica** (WebGL 2), en vivo mientras se mueve
  cualquier control. Mantener pulsada la foto enseña el original.
- Secciones como en Lightroom: Básicos, Presencia, Curva de tonos (por puntos,
  luz y canales), Mezclador de color, Gradación de color (tres ruedas),
  Calibración, Película y LUT.
- **LUT**: biblioteca de `.cube` (se copian a `%APPDATA%\ROOM\luts`) y exportar
  el propio revelado como `.cube` de 33³. Solo cabe el color: lo que mira
  alrededor de cada píxel (textura, claridad, neblina, grano, halo, viñeteado,
  suavizado) viaja en los ajustes guardados.
- **Ajustes guardados** con nombre, y el revelado de cada archivo se recuerda:
  al volver a abrir una foto sigue como se dejó. Ctrl+Z / Ctrl+Y.
- **Exportar** a tamaño completo en JPEG o PNG, con el EXIF del original
  (orientación normal, medidas nuevas, sin miniatura). Nunca pisa un archivo.

## Cómo está hecho

Electron + React + TypeScript, `node:sqlite` en `%APPDATA%\ROOM\room.db`, y la
casa (`../casa`) para la identidad común. El HEIC lo decodifica `libheif-js`
(WebAssembly) en un proceso aparte para no congelar la ventana; JPEG y PNG, el
propio Chromium.

El motor (`src/renderer/src/motor`) va por pasadas: base en luz lineal (P3→sRGB,
balance, exposición, calibración), desenfoques proporcionales al lado largo
(para que la vista previa se parezca a la exportada) y una pasada final con
todo lo demás.

## Comprobar

```
npm run typecheck
npm test                       # LUT, curva, EXIF, revelado (sin ventana)
npm run prueba:motor           # el motor en una ventana oculta (WebGL de verdad)
```

`MUESTRAS=<carpeta>` añade fotos de verdad a las dos pruebas. Para ver la
aplicación sin abrirla en el escritorio: compilar (`npx electron-vite build`),
empaquetar `test/arnes/entrada.ts` en `out/test/arnes.cjs` (ver el arnés) y
`MUESTRAS=… SALIDA=… npx electron test/arnes/capturar.cjs`.

## Publicar

`npm run dist` deja en `release/` el instalador, el portable, `latest.yml` y el `.blockmap`. Sin firmar. La release de GitHub (`i3SK87/room`, pública para que el actualizador la lea sin token) lleva los **cuatro**: sin `latest.yml` el actualizador no encuentra con qué comparar. Orden: typecheck, test, versión en `package.json`, commit, push, etiqueta `vX`, `npm run dist`, `gh release create vX` con los cuatro archivos.
