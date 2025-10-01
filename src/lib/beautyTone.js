// src/lib/beautyTone.js
import * as Tone from "tone"

// ===== Utilidades =====
const KEYS = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
const MAJOR = [0,2,4,5,7,9,11]
const MINOR = [0,2,3,5,7,8,10]

const DEGREE_TO_TRIAD = {
  I:[0,4,7], ii:[2,5,9], iii:[4,7,11], IV:[5,9,12], V:[7,11,14], vi:[9,12,16],
}

const PROGRESSIONS = [
  ["I","V","vi","IV"],
  ["vi","IV","I","V"],
  ["I","vi","IV","V"],
  ["I","IV","I","V"],
  ["ii","V","I","vi"],
]

export function parseBeautyParams() {
  const url = new URL(window.location.href)

  // notes
  let raw = url.searchParams.get("notes") || url.searchParams.get("n") || ""
  try { raw = decodeURIComponent(raw) } catch {}
  const tokens = raw.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean)

  // base params
  const key = (url.searchParams.get("key") || "C").toUpperCase()
  const scaleName = (url.searchParams.get("scale") || "major").toLowerCase()
  const progStr = (url.searchParams.get("prog") || "").trim()
  const bpm  = clampInt(url.searchParams.get("bpm"), 40, 220, 96)
  const swing = clampFloat(url.searchParams.get("swing"), 0, 0.35, 0.16)
  const len  = url.searchParams.get("len") || "8n"
  const gap  = clampFloat(url.searchParams.get("gap"), 0, 0.5, 0.05)

  // Defaults deseados
  const styleParam = (url.searchParams.get("style") || "hybrid").toLowerCase() // literal|hybrid|quant
  const followParam = url.searchParams.get("follow")
  const follow = followParam ? (followParam.toLowerCase() === "on") : true // ON por defecto
  const style = styleParam                                                 // HYBRID por defecto

  const seedStr = url.searchParams.get("seed") || url.searchParams.get("iv") || raw || "seed"

  // si el user no forzó prog=, la tomamos del seed
  const prog = progStr ? progStr.split("-") : pickProgressionFromSeed(seedStr)

  return { notes: tokens, key, scaleName, prog, bpm, swing, len, gap, style, follow, seedStr }
}

function clampInt(v, min, max, def){ const n = parseInt(v??"",10); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):def }
function clampFloat(v, min, max, def){ const n = parseFloat(v??""); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):def }

// PRNG determinista (xorshift32) para timbres/variaciones
function hash32(s){
  let h = 2166136261 >>> 0
  for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h || 1
}
function rngFromSeed(seedStr){
  let x = hash32(seedStr)
  return () => { x ^= x<<13; x^=x>>>17; x^=x<<5; return (x>>>0)/4294967296 }
}
function pickProgressionFromSeed(seedStr){
  const r = rngFromSeed(seedStr)()
  return PROGRESSIONS[Math.floor(r*PROGRESSIONS.length)]
}

// ===== Conversión de notas =====
function midiFromNoteLike(n){
  const m = String(n).trim().match(/^([A-Ga-g])([#b]?)(\d)$/)
  if(!m){ console.warn("Nota inválida:", n); return null }
  const L = m[1].toUpperCase(), acc = m[2], oct = +m[3]
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[L]
  const alt = acc==="#"?1: acc==="b"?-1:0
  return (oct+1)*12 + base + alt
}

function quantizeToScale(midi, tonicMidi, scale){
  const rel = (midi - tonicMidi + 1200) % 12
  let best = 0, bestDiff = 99
  for (const deg of scale){
    const diff = Math.min((12+rel-deg)%12,(12+deg-rel)%12)
    if (diff < bestDiff){ bestDiff = diff; best = deg }
  }
  const base = midi - ((midi - tonicMidi) % 12) + best
  const altUp = base + 12, altDn = base - 12
  return [base, altUp, altDn].sort((a,b)=>Math.abs(a-midi)-Math.abs(b-midi))[0]
}

function chordFromDegree(deg, tonicSemitone){ // C3–C5
  const tri = DEGREE_TO_TRIAD[deg] || [0,4,7]
  return tri.map(semi => 48 + ((tonicSemitone + semi) % 24))
}

function humanize(val, amt){ return val + (Math.random()*2-1)*amt }

// Helpers de estilo
function mapMelodyMidis({notes, key, scaleName, style}){
  const tonicSemitone = KEYS[key] ?? 0
  const tonicMidi = 60 + tonicSemitone
  const scale = (scaleName === "minor") ? MINOR : MAJOR

  const raw = notes.map(midiFromNoteLike).filter(m=>m!=null)
  if (style === "literal") return raw
  if (style === "quant")  return raw.map(m => quantizeToScale(m, tonicMidi, scale))

  // hybrid: corrige solo si difiere <= 1 semitono
  return raw.map(m => {
    const q = quantizeToScale(m, tonicMidi, scale)
    return (Math.abs(q - m) <= 1) ? q : m
  })
}

// Chord-follow: arma un acorde por compás a partir de la melodía del compás
function chordFromBarNotes(barMidis, key, scaleName){
  if (barMidis.length === 0) return null
  // raíz = pitch class más frecuente del compás
  const pcs = new Array(12).fill(0)
  for (const m of barMidis){ pcs[(m%12+12)%12]++ }
  let rootPc = 0, max = -1
  for (let i=0;i<12;i++) if (pcs[i]>max){ max=pcs[i]; rootPc=i }
  // triada mayor/menor en la escala elegida
  const isMinor = (scaleName === "minor")
  const intervals = isMinor ? [0,3,7] : [0,4,7]
  const rootMidi = 48 + rootPc // alrededor de C3
  return intervals.map(semi => rootMidi + semi)
}

// ===== Motor con Transport (sin loops con setTimeout) =====
export async function playBeautiful({
  notes, key, scaleName, prog, bpm, swing, len, gap, style, follow, seedStr, onStep, onEnd
}){
  await Tone.start()

  const transport = Tone.getTransport()
  transport.bpm.value = bpm
  transport.swing = swing
  transport.swingSubdivision = "8n"

  // PRNG para timbres y variaciones
  const rnd = rngFromSeed(seedStr)
  const pick = arr => arr[Math.floor(rnd()*arr.length)]

  // Timbres variables por seed
  const leadType = pick(["triangle","sawtooth","square"])
  const padType  = pick(["sine","triangle"])
  const bassType = pick(["square","sawtooth"])

  // FX
  const reverb = new Tone.Reverb({ decay: 2.8 + rnd()*2.0, wet: 0.22 + rnd()*0.1 }).toDestination()
  const delay  = new Tone.FeedbackDelay({ delayTime: pick(["8n","16n"]), feedback: 0.18 + rnd()*0.16, wet: 0.14 + rnd()*0.1 }).toDestination()

  const lead = new Tone.Synth({
    oscillator: { type: leadType },
    envelope: { attack: 0.01, decay: 0.14, sustain: 0.18, release: 0.22 }
  }).connect(delay).connect(reverb)

  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: padType },
    envelope: { attack: 0.35, decay: 0.3, sustain: 0.45, release: 0.9 }
  }).connect(reverb)

  const bass = new Tone.MonoSynth({
    oscillator: { type: bassType },
    filter: { Q: 1, rolloff: -24 },
    envelope: { attack: 0.02, decay: 0.22, sustain: 0.22, release: 0.22 }
  }).connect(reverb)

  // Melodía mapeada según estilo (HYBRID por defecto)
  const melodyMidis = mapMelodyMidis({notes, key, scaleName, style})
  if (melodyMidis.length === 0) {
    console.warn("No valid melody notes parsed.")
  }

  const tonicSemitone = KEYS[key] ?? 0
  const noteDurSec = Tone.Time(len).toSeconds()
  const stepSec = noteDurSec + gap

  // === Acompañamiento por compás (programado en Transport) ===
  const barLenSec = 4 * Tone.Time("4n").toSeconds()
  const stepsPerBar = Math.max(1, Math.round(barLenSec / stepSec))
  const totalBars = Math.ceil(Math.max(1, melodyMidis.length) / stepsPerBar)

  const barIds = []
  for (let bar = 0; bar < totalBars; bar++){
    const barTime = bar * barLenSec + 0.1 // desplazamos un pelín el arranque
    const i0 = bar * stepsPerBar
    const i1 = Math.min(melodyMidis.length, i0 + stepsPerBar)
    const barNotes = melodyMidis.slice(i0, i1)

    const id = transport.schedule((time) => {
      const degree = prog[bar % prog.length]
      const chord = follow
        ? (chordFromBarNotes(barNotes, key, scaleName) || chordFromDegree("I", tonicSemitone))
        :  chordFromDegree(degree, tonicSemitone)

      // pad (1 compás)
      pad.triggerAttackRelease(
        chord.map(n => Tone.Frequency(n,"midi")),
        barLenSec,
        time,
        0.34
      )

      // bajo en negras, patrón leve
      const pattern = [0,2,3,1]
      for (let k = 0; k < 4; k++){
        const idx = pattern[k % pattern.length]
        const note = chord[Math.min(idx, chord.length-1)] - 12
        const bt = time + k * Tone.Time("4n").toSeconds()
        bass.triggerAttackRelease(Tone.Frequency(note, "midi"), "8n", humanize(bt, 0.004), 0.6 - k*0.05)
      }
    }, `+${barTime.toFixed(3)}`)
    barIds.push(id)
  }

  // === Melodía principal (con animación) usando scheduleRepeat ===
  let stepIdx = 0
  const seqId = transport.scheduleRepeat((time) => {
    if (stepIdx >= melodyMidis.length) {
      transport.clear(seqId)
      // parar tras un pequeño tail
      const stopId = transport.schedule((t2) => {
        barIds.forEach(id => transport.clear(id))
        transport.stop()
        transport.cancel(0)
        lead.dispose(); pad.dispose(); bass.dispose(); reverb.dispose(); delay.dispose()
        onEnd?.()
      }, "+0.8")
      return
    }
    const m = melodyMidis[stepIdx]
    const v = 0.62 + 0.28 * Math.sin(stepIdx * 0.7)
    onStep?.(stepIdx)
    lead.triggerAttackRelease(Tone.Frequency(m, "midi"), noteDurSec, humanize(time, 0.006), v)
    stepIdx++
  }, stepSec, "+0.1") // empieza a +0.1s

  // Arranque
  transport.start()
}

// ===== Modo de generación (por si lo usas en App.jsx) =====
export function parseGenMode() {
  const url = new URL(window.location.href)
  const g = (url.searchParams.get("gen") || "").toLowerCase()
  // si no viene nada, por default = "seed" (tu App decide si llamar a otro motor)
  return g || "seed"
}
