import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { useAvisos } from 'casa/ui'
import { recordarTema, seguirAlSistema, vestir, type Tema } from 'casa/tema'
import { useStore } from './lib/store'
import { Carrete } from './components/Carrete'
import { Visor } from './components/Visor'
import { Panel } from './components/Panel'
import { Exportar } from './components/Exportar'
import { Ajustes } from './components/Ajustes'

const FOTO = /\.(heic|heif|hif|jpe?g|png)$/i

export function App(): ReactNode {
  const { actual, abrir, deshacer, rehacer, ajustes } = useStore()
  const { fail } = useAvisos()
  const [exportando, setExportando] = useState(false)
  const [enAjustes, setEnAjustes] = useState(false)
  const [encima, setEncima] = useState(false)

  // El tema y la paleta, en cuanto llegan los ajustes, y siguiendo al sistema si es «automático».
  useEffect(() => {
    vestir(ajustes.tema, ajustes.paleta)
    recordarTema('room', ajustes.tema as Tema, ajustes.paleta)
    return seguirAlSistema(() => ({ theme: ajustes.tema, palette: ajustes.paleta }))
  }, [ajustes.tema, ajustes.paleta])

  const elegir = useCallback(async () => {
    try {
      await abrir(await window.room.fotos.elegir())
    } catch (e) {
      fail(e)
    }
  }, [abrir, fail])

  // Las que llegan de fuera: «Abrir con» o arrastradas al icono.
  useEffect(() => window.room.fotos.alAbrir((rutas) => void abrir(rutas).catch(fail)), [abrir, fail])

  const puedeExportar = !!actual && !actual.leyendo && !actual.error

  // Los atajos de siempre.
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey) return
      if (document.querySelector('.overlay')) return
      const enTexto = e.target instanceof HTMLInputElement && e.target.type === 'text'
      const k = e.key.toLowerCase()
      if (k === 'o' && !e.shiftKey) {
        e.preventDefault()
        void elegir()
      } else if (k === 'e' && e.shiftKey) {
        e.preventDefault()
        if (puedeExportar) setExportando(true)
      } else if (enTexto) {
        return
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        deshacer()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        rehacer()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [elegir, deshacer, rehacer, puedeExportar])

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setEncima(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setEncima(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setEncima(false)
        const rutas = Array.from(e.dataTransfer.files)
          .map((f) => window.room.fotos.rutaDe(f))
          .filter((r) => r && FOTO.test(r))
        if (rutas.length) void abrir(rutas).catch(fail)
      }}
    >
      <Carrete alAbrir={() => void elegir()} alAjustes={() => setEnAjustes(true)} />
      <main className="main main-room">
        <header className="topbar">
          <div className="topbar-titulo">
            <h1 className="truncate">{actual?.nombre ?? 'Revelar'}</h1>
            {actual?.resumen && <span className="small muted truncate">{actual.resumen}</span>}
          </div>
          <button className="btn primary" disabled={!puedeExportar} onClick={() => setExportando(true)} title="Exportar (Ctrl+Mayús+E)">
            <Download size={16} /> Exportar…
          </button>
        </header>
        <div className="room-cuerpo">
          <Visor alAbrir={() => void elegir()} />
          <Panel />
        </div>
      </main>
      {encima && <div className="soltar">Suelta las fotos para abrirlas</div>}
      {exportando && <Exportar onClose={() => setExportando(false)} />}
      {enAjustes && <Ajustes onClose={() => setEnAjustes(false)} />}
    </div>
  )
}
