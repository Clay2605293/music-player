import { useMemo, useState } from "react"
import { parseBeautyParams, playBeautiful, parseGenMode } from "./lib/beautyTone"
import { playSeedAvalanche } from "./lib/seedAvalanche"
import NoteChip from "./components/NoteChip"
import "./index.css"

export default function App() {
  const params = useMemo(() => parseBeautyParams(), [])
  const mode = useMemo(() => parseGenMode(), [])
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)

  const onPlay = async () => {
    if (playing) return
    setPlaying(true)
    try {
      if (mode === "seed") {
        await playSeedAvalanche({
          ...params,
          onStep: (i)=>setActive(i),
          onEnd: ()=>{ setActive(-1); setPlaying(false) }
        })
      } else {
        await playBeautiful({
          ...params,
          onStep: (i)=>setActive(i),
          onEnd: ()=>{ setActive(-1); setPlaying(false) }
        })
      }
    } catch {
      setActive(-1)
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
        {params.notes.length === 0 ? (
          <p className="muted">Agrega <code>?notes=C4,D4,E4</code> al URL</p>
        ) : (
          <>
            <div className="chips">
              {params.notes.map((n,i)=>(<NoteChip key={i} label={n} active={i===active}/>))}
            </div>
            <small className="muted">Parsed notes: <strong>{params.notes.length}</strong></small>
          </>
        )}

        <div className="controls">
          <button className="btn" onClick={onPlay} disabled={playing || params.notes.length===0}>
            {playing ? "Playing…" : "Play"}
          </button>
          <div className="params">
            <span><strong>Mode:</strong> {mode}</span>
            <span><strong>Key:</strong> {params.key}</span>
            <span><strong>Scale:</strong> {params.scaleName}</span>
            <span><strong>Prog:</strong> {params.prog.join("-")}</span>
            <span><strong>BPM:</strong> {params.bpm}</span>
            <span><strong>Len:</strong> {params.len}</span>
          </div>
        </div>
      </section>
    </div>
  )
}
