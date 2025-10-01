// === Parse params & audio helpers (no emojis) ===

const A4 = 440
const SEMI = { C:-9, 'C#':-8, Db:-8, D:-7, 'D#':-6, Eb:-6, E:-5, F:-4, 'F#':-3, Gb:-3, G:-2, 'G#':-1, Ab:-1, A:0, 'A#':1, Bb:1, B:2 }

export function noteToFreq(n) {
  // Accept forms like "C4", "F#3", "Bb5"
  const m = String(n).trim().match(/^([A-Ga-g])([#b]?)(\d)$/)
  if (!m) throw new Error(`Bad note: ${n}`)
  const L = m[1].toUpperCase()
  const acc = m[2] || ""
  const oct = parseInt(m[3], 10)
  const key = (acc === "#") ? `${L}#` : (acc === "b" ? ({'A':'G#','B':'A#','C':'B','D':'C#','E':'D#','F':'E','G':'F#'}[L] ? `${L}b` : `${L}b`) : L)
  const semitones = (SEMI[key] ?? SEMI[L]) + (oct - 4) * 12
  return A4 * Math.pow(2, semitones / 12)
}

export function parseQueryNotes() {
  const url = new URL(window.location.href)
  const raw = url.searchParams.get('notes') || url.searchParams.get('n') || ''
  // Split by comma or hyphen or space
  const tokens = raw.split(/[,\-\s]+/).map(s => s.trim()).filter(Boolean)
  const bpm = clampInt(url.searchParams.get('bpm'), 40, 240, 120)
  const wave = (url.searchParams.get('wave') || 'sine').toLowerCase()
  const dur = clampFloat(url.searchParams.get('dur'), 0.05, 2.0, 0.30) // seconds per note
  const gap = clampFloat(url.searchParams.get('gap'), 0.0, 0.5, 0.05)
  return { notes: tokens, bpm, wave, dur, gap }
}

function clampInt(v, min, max, def) {
  const n = parseInt(v ?? '', 10)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def
}
function clampFloat(v, min, max, def) {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def
}

export async function playSequence({ notes, bpm, wave, dur, gap, onStep, onEnd }) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const secPerBeat = 60 / bpm
  // We will ignore BPM for pitch, and use dur/gap for timing; BPM can mod dur if you prefer:
  const noteDur = dur || secPerBeat * 0.5

  let t = ctx.currentTime + 0.05
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    const f = noteToFreq(n)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = ['sine','square','sawtooth','triangle'].includes(wave) ? wave : 'sine'
    osc.frequency.value = f

    // ADSR tiny envelope
    const a = 0.01, d = 0.03, s = 0.18, r = 0.04
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(0.25, t + a)
    gain.gain.linearRampToValueAtTime(s, t + a + d)
    gain.gain.linearRampToValueAtTime(0.0001, t + noteDur + r)

    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + noteDur + r + 0.01)

    onStep?.(i)
    // schedule step callback visually a bit ahead
    await wait((noteDur + gap) * 1000)
    t += noteDur + gap
  }
  onEnd?.()
  // Small grace period to let last tail finish before closing
  await wait(80)
  ctx.close()
}

function wait(ms) { return new Promise(res => setTimeout(res, ms)) }
