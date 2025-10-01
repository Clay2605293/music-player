// src/lib/beautyTone.js
import * as Tone from "tone"

// === Música util ===
const KEYS = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
const MAJOR = [0,2,4,5,7,9,11]
const MINOR = [0,2,3,5,7,8,10]

const DEGREE_TO_TRIAD = {
  I:  [0,4,7],
  ii: [2,5,9],
  iii:[4,7,11],
  IV: [5,9,12],
  V:  [7,11,14],
  vi: [9,12,16],
}

// === Parseo de URL ===
export function parseBeautyParams() {
  const url = new URL(window.location.href)

  let raw = url.searchParams.get("notes") || url.searchParams.get("n") || ""
  try { raw = decodeURIComponent(raw) } catch { /* no-op */ }

  const tokens = raw
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)

  const key = (url.searchParams.get("key") || "C").toUpperCase()
  const scaleName = (url.searchParams.get("scale") || "major").toLowerCase()
  const progStr = (url.searchParams.get("prog") || "I-V-vi-IV")
  const bpm  = clampInt(url.searchParams.get("bpm"), 40, 220, 96)
  const swing = clampFloat(url.searchParams.get("swing"), 0, 0.35, 0.18)
  const len  = url.searchParams.get("len") || "8n"
  const gap  = clampFloat(url.searchParams.get("gap"), 0, 0.5, 0.05)

  return {
    notes: tokens,
    key, scaleName, prog: progStr.split("-"),
    bpm, swing, len, gap
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

// === Converters ===
function midiFromNoteLike(n){
  const m = String(n).trim().match(/^([A-Ga-g])([#b]?)(\d)$/)
  if(!m){ console.warn("Nota inválida:", n); return null }
  const L = m[1].toUpperCase(), acc = m[2], oct = +m[3]
  const base = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[L]
  const alt = acc==="#" ? 1 : (acc==="b" ? -1 : 0)
  return (oct+1)*12 + base + alt
}

function quantizeToScale(midi, tonicMidi, scale){
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
  const tri = DEGREE_TO_TRIAD[deg] || [0,4,7]
  // ubica cerca de C3–C5
  return tri.map(semi => 48 + ((tonicSemitone + semi) % 24))
}

function humanize(val, amt){ return val + (Math.random()*2-1)*amt }

// === Motor: todo en segundos, sin Transport ===
export async function playBeautiful({
  notes, key, scaleName, prog, bpm, swing, len, gap, onStep, onEnd
}){
  await Tone.start()

  // Usamos el tempo global solo para convertir "len" a segundos.
  // No arrancamos el transport; solo aprovechamos el tempo para Time().
  const transport = Tone.getTransport()
  transport.bpm.value = bpm
  transport.swing = swing
  transport.swingSubdivision = "8n"

  const scale = (scaleName === "minor") ? MINOR : MAJOR
  const tonicSemitone = KEYS[key] ?? 0
  const tonicMidi = 60 + tonicSemitone

  // FX + instrumentos
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

  // Melodía
  const melodyMidis = notes
    .map(midiFromNoteLike)
    .filter(m => m != null)
    .map(m => quantizeToScale(m, tonicMidi, scale))

  if (melodyMidis.length === 0) {
    console.warn("No valid melody notes parsed. Revisa la codificación de # (G%234 → G#4).")
  }

  // Tiempos (en segundos) relativos a Tone.now()
  const t0 = Tone.now() + 0.1
  const noteDurSec = Tone.Time(len).toSeconds()
  const gapSec = gap
  const stepSec = noteDurSec + gapSec

  // Acompañamiento: compás de 4/4 basado en corcheas ("8n")
  const barLenSec = 4 * Tone.Time("4n").toSeconds()
  const stepsPerBar = Math.max(1, Math.round(barLenSec / stepSec))
  const totalBars = Math.ceil(Math.max(1, melodyMidis.length) / stepsPerBar)
  const expProg = Array.from({ length: totalBars }, (_, i) => prog[i % prog.length])

  // Programa PAD + BAJO (en segundos)
  expProg.forEach((degree, i) => {
    const tri = chordFromDegree(degree, tonicSemitone)
    const barStart = t0 + i * barLenSec

    // Pad bloque
    pad.triggerAttackRelease(
      tri.map(n => Tone.Frequency(n, "midi")),
      barLenSec, // dura 1 compás
      barStart,
      0.35
    )

    // Bajo en negras (4 por compás)
    for (let k = 0; k < 4; k++){
      const bt = barStart + k * Tone.Time("4n").toSeconds()
      bass.triggerAttackRelease(
        Tone.Frequency(tri[0] - 12, "midi"),
        "8n",
        humanize(bt, 0.005),
        0.65 - k * 0.06
      )
    }
  })

  // Programa MELODÍA y anima chips
  for (let i = 0; i < melodyMidis.length; i++){
    const when = t0 + i * stepSec
    const m = melodyMidis[i]
    const v = 0.65 + 0.25 * Math.sin(i * 0.7)
    onStep?.(i)
    lead.triggerAttackRelease(
      Tone.Frequency(m, "midi"),
      noteDurSec,
      humanize(when, 0.006),
      v
    )
    // espera no bloqueante (solo para el avance visual)
    // no afecta la programación ya hecha
    // eslint-disable-next-line no-await-in-loop
    await new Promise(r => setTimeout(r, stepSec * 1000))
  }

  // Espera a que termine el tail del último sonido y limpia
  const totalSeconds = melodyMidis.length * stepSec + 1.5
  await new Promise(r => setTimeout(r, Math.max(0.2, totalSeconds) * 1000))

  lead.dispose(); pad.dispose(); bass.dispose(); reverb.dispose(); delay.dispose()
  onEnd?.()
}
