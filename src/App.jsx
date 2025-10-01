// App.jsx (solo el fragmento relevante)
import { useMemo, useState } from "react"
import { parseBeautyParams, playBeautiful } from "./lib/beautyTone"
import NoteChip from "./components/NoteChip"

export default function App() {
  const params = useMemo(() => parseBeautyParams(), [])
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)

  const onPlay = async () => {
    if (playing || params.notes.length === 0) return
    setPlaying(true)
    try{
      await playBeautiful({
        ...params,
        onStep: (i)=>setActive(i),
        onEnd: ()=>{ setActive(-1); setPlaying(false) }
      })
    } finally {
      setPlaying(false)
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>Hex Sonata Player</h1>
        <p className="subtitle">
          Params: ?notes=...&key=C&scale=major&prog=I-V-vi-IV&bpm=96
        </p>
      </header>

      <section className="card">
        <h2>Notes</h2>
        <div className="chips">
          {params.notes.map((n,i)=>(<NoteChip key={i} label={n} active={i===active}/>))}
        </div>
        <div className="controls">
          <button className="btn" onClick={onPlay} disabled={playing || params.notes.length===0}>
            {playing ? "Playing…" : "Play"}
          </button>
          <div className="params">
            <span><strong>Key:</strong> {params.key}</span>
            <span><strong>Scale:</strong> {params.scaleName}</span>
            <span><strong>Prog:</strong> {params.prog.join("-")}</span>
            <span><strong>BPM:</strong> {params.bpm}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
