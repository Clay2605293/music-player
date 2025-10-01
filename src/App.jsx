import { useMemo, useState } from 'react'
import { parseQueryNotes, playSequence } from './lib/audio'
import NoteChip from './components/NoteChip'

export default function App() {
  const { notes, bpm, wave, dur, gap } = useMemo(() => parseQueryNotes(), [])
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)

  const onPlay = async () => {
    if (playing || notes.length === 0) return
    setPlaying(true)
    try {
      await playSequence({
        notes,
        bpm,
        wave,
        dur,
        gap,
        onStep: (i) => setActive(i),
        onEnd: () => { setActive(-1); setPlaying(false) }
      })
    } catch (e) {
      console.error(e)
      setActive(-1)
      setPlaying(false)
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>HEX Music Player</h1>
        <p className="subtitle">
          URL params → <code>?notes=C4,D4,E4&bpm=120&wave=sine</code>
        </p>
      </header>

      <section className="card">
        <h2>Notes</h2>
        {notes.length === 0 ? (
          <p className="muted">Add <code>?notes=C4,D4,E4</code> to the URL</p>
        ) : (
          <div className="chips">
            {notes.map((n, i) => (
              <NoteChip key={i} label={n} active={i === active} />
            ))}
          </div>
        )}

        <div className="controls">
          <button className="btn" onClick={onPlay} disabled={playing || notes.length === 0}>
            {playing ? 'Playing…' : 'Play'}
          </button>
          <div className="params">
            <span><strong>BPM:</strong> {bpm}</span>
            <span><strong>Wave:</strong> {wave}</span>
            <span><strong>Dur:</strong> {dur.toFixed(2)}s</span>
            <span><strong>Gap:</strong> {gap.toFixed(2)}s</span>
          </div>
        </div>
      </section>

      <footer className="foot">
        <small>Built with Web Audio API. Share the link and it will play the same melody.</small>
      </footer>
    </div>
  )
}
