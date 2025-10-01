// src/lib/beautyTone.js
import * as Tone from "tone"

// Utilidades musicales
const KEYS = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
const MAJOR = [0,2,4,5,7,9,11]
const MINOR = [0,2,3,5,7,8,10]

const DEGREE_TO_TRIAD = {
  I:  [0,4,7],
  ii: [2,5,9],
  iii:[4,7,11],
  IV: [5,9,0+12],
  V:  [7,11,2+12],
  vi: [9,0+12,4+12]
}

export function parseBeautyParams() {
  const url = new URL(window.location.href)

  // Decodifica %23 → # y otros caracteres del query
  const raw = decodeURIComponent(url.searchParams.get("notes") || url.searchParams.get("n") || "")
  const tokens = raw
    .split(/[,\-\s]+/)
    .map(s => s.trim())
    .filter(Boolean)

  const key = (url.searchParams.get("key") || "C").toUpperCase()
  const scaleName = (url.searchParams.get("scale") || "major").toLowerCase()
  const progStr = (url.searchParams.get("prog") || "I-V-vi-IV")
  const bpm = clampInt(url.searchParams.get("bpm"), 40, 220, 96)
  const swing = clampFloat(url.searchParams.get("swing"), 0, 0.35, 0.18)
  const len = url.searchParams.get("len") || "8n" // duración de cada nota de la melodía

  return {
    notes: tokens,
    key, scaleName, prog: progStr.split("-"),
    bpm, swing, len
  }
}

function clampInt(v, min, max, def){
  const n = parseInt(v ?? "", 10)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def
}
function clampFloat(v, min, max, def){
  const n = parseFloat(v ?? "")
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def
}

function midiFromNoteLike(n){
  // A4 = 69. Acepta "C4", "G#3", "Bb5"
  const m = String(n).trim().match(/^([A-Ga-g])([#b]?)(\d)$/)
  if(!m) return null
  const L = m[1].toUpperCase(), acc = m[2], oct = +m[3]
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[L]
  const alt = acc==="#" ? 1 : (acc==="b" ? -1 : 0)
  return (oct+1)*12 + base + alt
}

function quantizeToScale(midi, tonicMidi, scale){
  // Mueve la nota al grado más cercano de la escala respecto a la tonalidad
  const rel = (midi - tonicMidi + 1200) % 12
  let best = 0, bestDiff = 99
  for (const deg of scale){
    const diff = Math.min((12 + rel - deg) % 12, (12 + deg - rel) % 12)
    if (diff < bestDiff){ bestDiff = diff; best = deg }
  }
  const base = midi - ((midi - tonicMidi) % 12) + best
  const altUp = base + 12, altDn = base - 12
  return [base, altUp, altDn].sort((a,b)=>Math.abs(a-midi)-Math.abs(b-midi))[0]
}

function chordFromDegree(deg, tonicSemitone){
  // Triada en rango cómodo C3–C5
  const tri = DEGREE_TO_TRIAD[deg]
  const semis = tri || [0,4,7]
  return semis.map(semi => 48 + ((tonicSemitone + semi) % 24))
}

function humanize(val, amt){ return val + (Math.random()*2-1)*amt }

export async function playBeautiful({ notes, key, scaleName, prog, bpm, swing, len, onStep, onEnd }){
  await Tone.start()
  Tone.Transport.bpm.value = bpm
  Tone.Transport.swing = swing
  Tone.Transport.swingSubdivision = "8n"

  const scale = (scaleName === "minor") ? MINOR : MAJOR
  const tonicSemitone = KEYS[key] ?? 0
  const tonicMidi = 60 + tonicSemitone // C4 + tónica

  // FX y synths
  const reverb = new Tone.Reverb({ decay: 3.5, wet: 0.25 }).toDestination()
  const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.25, wet: 0.18 }).toDestination()

  const lead = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.18, release: 0.2 }
  }).connect(delay).connect(reverb)

  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.4, decay: 0.3, sustain: 0.4, release: 0.8 }
  }).connect(reverb)

  const bass = new Tone.MonoSynth({
    oscillator: { type: "square" },
    filter: { Q: 1, rolloff: -24 },
    envelope: { attack: 0.02, decay: 0.2, sustain: 0.2, release: 0.2 }
  }).connect(reverb)

  // Melodía: parsea y cuantiza a la escala
  const melodyMidis = notes
    .map(midiFromNoteLike)
    .filter(m => m != null)
    .map(m => quantizeToScale(m, tonicMidi, scale))

  if (melodyMidis.length === 0) {
    console.warn("No valid melody notes parsed from URL. Ensure # is decoded (e.g., G%234 → G#4).")
  }

  // Progresión repetida para cubrir la melodía
  const stepsPerChord = 4 // 4 corcheas por acorde
  const totalChords = Math.ceil(Math.max(1, melodyMidis.length) / stepsPerChord)
  const expProg = Array.from({ length: totalChords }, (_, i) => prog[i % prog.length])

  const start = Tone.now() + 0.2

  // Acompañamiento (pad y bajo)
  expProg.forEach((degree, i) => {
    const tri = chordFromDegree(degree, tonicSemitone)
    const barTime = start + i * 4 * Tone.Time("8n").toSeconds()

    // Pad
    pad.triggerAttackRelease(tri.map(n => Tone.Frequency(n, "midi")), "1m", barTime, 0.35)

    // Bajo en negras
    for (let k = 0; k < 4; k++){
      const bt = barTime + k * Tone.Time("4n").toSeconds()
      bass.triggerAttackRelease(Tone.Frequency(tri[0]-12, "midi"), "8n", humanize(bt, 0.005), 0.6 - k*0.05)
    }
  })

  // Melodía principal (dispara onStep para animar chips)
  const seq = new Tone.Part((time, idx) => {
    const m = melodyMidis[idx]
    if (m == null) return
    const v = 0.65 + 0.25 * Math.sin(idx * 0.7)
    onStep?.(idx)
    lead.triggerAttackRelease(Tone.Frequency(m, "midi"), len, humanize(time, 0.006), v)
  }, melodyMidis.map((_, i) => [start + i * Tone.Time(len).toSeconds(), i]))

  seq.start(start)
  Tone.Transport.start(start)

  // Duración total correcta según len
  const totalSeconds = melodyMidis.length * Tone.Time(len).toSeconds() + 2.0
  await new Promise(r => setTimeout(r, Math.max(0.2, totalSeconds) * 1000))

  // Stop y limpieza
  seq.stop()
  Tone.Transport.stop()
  Tone.Transport.cancel(0)
  lead.dispose(); pad.dispose(); bass.dispose(); reverb.dispose(); delay.dispose()
  onEnd?.()
}
