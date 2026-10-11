import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { aplicarTemaGuardado } from 'casa/tema'
import { AvisosProvider } from 'casa/ui'
import { StoreProvider } from './lib/store'
import { App } from './App'
import 'casa/paletas.css'
import 'casa/base.css'
import './styles.css'

// La primera vez, ROOM arranca en oscuro y con Ghost: un cuarto de revelado es oscuro.
try {
  if (localStorage.getItem('room:tema') === null) {
    localStorage.setItem('room:tema', 'dark')
    localStorage.setItem('room:paleta', 'ghost')
  }
} catch {
  // Sin almacén, arranca como diga la casa.
}
// Antes de montar nada: si no, el primer fotograma sale con otro tema y da un fogonazo.
aplicarTemaGuardado('room')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AvisosProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </AvisosProvider>
  </StrictMode>
)
