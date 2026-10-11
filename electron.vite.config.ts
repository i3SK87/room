import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // El decodificador de HEIC va en su propio proceso: es su propio archivo.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          heic: resolve(__dirname, 'src/main/heic.ts')
        },
        external: ['node:sqlite']
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      minify: 'esbuild',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      },
      /*
       * La casa llega como enlace a `../casa`. Siguiendo el enlace, sus archivos
       * buscarían React en `Projects/casa/node_modules`, que no existe: se les
       * deja creer que viven dentro de `node_modules/casa`, y así encuentran el
       * React de esta aplicación, que tiene que ser uno solo.
       */
      preserveSymlinks: true,
      dedupe: ['react', 'react-dom', 'lucide-react']
    },
    optimizeDeps: { exclude: ['casa'] },
    server: {
      fs: { allow: [resolve(__dirname), resolve(__dirname, '../casa')] }
    },
    plugins: [react()]
  }
})
