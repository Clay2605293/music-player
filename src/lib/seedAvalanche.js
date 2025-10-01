// src/lib/seedAvalanche.js
import * as Tone from "tone"

// ---------- helpers musicales ----------
const KEYS = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
const MAJOR = [0,2,4,5,7,9,11]
const MINOR = [0,2,3,5,7,8,10]
const PROGRESSIONS = [
  ["I","V","vi","IV"],
  ["vi","IV","I","V"],
  ["I","vi","IV","V"],
  ["ii","V","I","vi"],
  ["I","IV","V","IV"],
]
const DEGREE_TO_TRIAD = { I:[0,4,7], ii:[2,5,9], iii:[4,7,11], IV:[5,9,12], V:[7,11,14], vi:[9,12,16] }

const chordFromDegree = (deg, tonic) =>
  (DEGREE_TO_TRIAD[deg]||[0,4,7]).map(s => 48 + ((tonic + s) % 24)) // ~C3–C5

const human = (x,a)=> x + (Math.random()*2-1)*a
const PITCH_CLASS = m => ((m % 12) + 12) % 12

// ---------- hashing & PRNG (avalancha fuerte) ----------
async function sha256Bytes(str){
  const data = new TextEncoder().encode(str)
  const buf = await crypto.subtle.digest("SHA-256", data)
  return new Uint8Array(buf) // 32 bytes
}
function xoshiroFromBytes(bytes, off=0){
  let s0 = readU32(bytes, off+0)|1, s1=readU32(bytes, off+4)|1, s2=readU32(bytes, off+8)|1, s3=readU32(bytes, off+12)|1
  const rotl = (x,k)=>((x<<k)|(x>>>(32-k)))>>>0
  return () => {
    const res = rotl((s1*5)>>>0,7)*9>>>0
    const t = (s1<<9)>>>0
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3,11)
    return (res>>>0)/4294967296
  }
}
function readU32(b,o){ return (b[o] | (b[o+1]<<8) | (b[o+2]<<16) | (b[o+3]<<24))>>>0 }

// ---------- mapeo seed -> parámetros musicales ----------
function pick(arr, rnd){ return arr[Math.floor(rnd()*arr.length)] }
function pickKey(rnd){ return Object.keys(KEYS)[Math.floor(rnd()*7)] }
function pickScale(rnd){ return rnd()<0.35 ? "minor" : "major" }
function scalePitches(key, scaleName){
  const tonic = KEYS[key]||0
  const sc = (scaleName==="minor")?MINOR:MAJOR
  return sc.map(s=> (tonic+s)%12 )
}

// motivo + variación + saltos + silencios
function generateMelody({steps, rnd, key, scaleName}){
  const pcs = scalePitches(key, scaleName)
  const octaves = [4,4,5,3,5,4,5]
  const melody = []
  const motif = Array.from({length:4}, ()=> pcs[Math.floor(rnd()*pcs.length)] + 12*pick(octaves, rnd))
  const invert = rnd()<0.5, retro = rnd()<0.35
  const motif2 = motif.map(m=> invert ? (motif[0]-(m-motif[0])) : m)
  const motifUse = retro ? motif2.slice().reverse() : motif2
  let idx = 0
  for (let i=0;i<steps;i++){
    if (i%4===0 && i) {
      const delta = (rnd()<0.6)? (rnd()<0.5?+2:-2) : 0
      for (let k=0;k<motifUse.length;k++) motifUse[k]+=delta
    }
    let note = motifUse[idx % motifUse.length]
    if (rnd()<0.15){ note += (rnd()<0.5?+12:-12) }
    while (note < 48) note += 12
    while (note > 84) note -= 12
    const rest = rnd()<0.07
    melody.push(rest ? null : note)
    idx++
  }
  return melody
}

// ---------- armonía guiada por melodía (MEJORA 1) ----------
function buildDiatonicTriads(key, scaleName){
  const tonic = KEYS[key] || 0
  const degrees = [
    {name:"I",  pcs:[0,4,7]},
    {name:"ii", pcs:[2,5,9]},
    {name:"iii",pcs:[4,7,11]},
    {name:"IV", pcs:[5,9,0]},
    {name:"V",  pcs:[7,11,2]},
    {name:"vi", pcs:[9,0,4]},
  ]
  return degrees.map(d => ({
    name: d.name,
    pcs: d.pcs.map(semi => ((tonic + semi) % 12 + 12) % 12),
    midi: d.pcs.map(semi => 48 + ((tonic + semi) % 24))
  }))
}

function scoreTriadForBar(triadPcs, barPcs, strongPc){
  let score = 0
  for (let pc=0; pc<12; pc++){
    if (barPcs[pc] > 0 && triadPcs.includes(pc)){
      score += barPcs[pc]
    }
  }
  if (strongPc != null && triadPcs.includes(strongPc)) score += 1.5
  return score
}

function chooseChordForBar({barMidis, key, scaleName, prefer}){
  const triads = buildDiatonicTriads(key, scaleName)
  if (barMidis.length === 0) return triads[0] // I

  const pcs = new Array(12).fill(0)
  let strongPc = null
  for (const m of barMidis){
    const pc = PITCH_CLASS(m)
    pcs[pc]++
    if (strongPc == null) strongPc = pc
  }

  let best = triads[0], bestScore = -1e9
  for (const t of triads){
    let s = scoreTriadForBar(t.pcs, pcs, strongPc)
    if (prefer && t.name === prefer) s += 0.25
    s += (t.name==="V") ? 0.05 : 0 // leve sesgo a V
    if (s > bestScore){ bestScore = s; best = t }
  }
  return best
}

// ---------- incluir nota fuerte en el acorde (MEJORA 2) ----------
function adjustChordToStrongNote({triad, strongMidi, key, scaleName}){
  if (strongMidi == null) return triad
  const strongPc = PITCH_CLASS(strongMidi)
  if (triad.pcs.includes(strongPc)) return triad
  const triads = buildDiatonicTriads(key, scaleName)
  const cand = triads.filter(t => t.pcs.includes(strongPc))
  return cand[0] || triad
}

// ---------- interfaz: usa seed (iv|seed|notes) y genera todo ----------
export async function playSeedAvalanche({
  notes, bpm, len, gap, swing, onStep, onEnd, seedStr, key:forcedKey, scaleName:forcedScale, prog:forcedProg
}){
  await Tone.start()

  // Limpieza por si había algo corriendo antes
  const t = Tone.getTransport()
  t.stop()
  t.cancel(0)

  t.bpm.value = bpm
  t.swing = swing
  t.swingSubdivision = "8n"

  // seed desde iv|seed|notes
  const rawSeed = seedStr || (Array.isArray(notes) ? notes.join(",") : String(notes||""))
  const digest = await sha256Bytes(rawSeed)
  const rnd = xoshiroFromBytes(digest, 0)

  // parámetros derivados del seed (permiten override)
  const key = forcedKey || pickKey(rnd)
  const scaleName = forcedScale || pickScale(rnd)
  const prog = forcedProg || pick(PROGRESSIONS, rnd)

  // ===== Instrumentos =====
  // Piano (Sampler Salamander) como lead por defecto
  const piano = new Tone.Sampler({
    urls: {
      "A1": "A1.mp3", "C2": "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
      "A2": "A2.mp3", "C3": "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
      "A3": "A3.mp3", "C4": "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
      "A4": "A4.mp3", "C5": "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
      "A5": "A5.mp3"
    },
    release: 1.2,
    baseUrl: "https://tonejs.github.io/audio/salamander/"
  })
  const pad  = new Tone.PolySynth(Tone.Synth, {
    oscillator:{ type:"sine" },
    envelope:{ attack:0.45, decay:0.3, sustain:0.5, release:1.0 }
  })
  const bass = new Tone.MonoSynth({
    oscillator:{ type:"triangle" },
    filter:{ Q:1, rolloff:-24 },
    envelope:{ attack:0.01, decay:0.18, sustain:0.22, release:0.22 }
  })

  // FX suaves (evitar “electro”)
  const reverb = new Tone.Reverb({ decay: 2.2, wet: 0.18 })
  const delay  = new Tone.FeedbackDelay({ delayTime: "16n", feedback: 0.14, wet: 0.10 })

  piano.connect(reverb).toDestination()
  pad.connect(reverb).toDestination()
  bass.connect(reverb).toDestination()
  delay.toDestination()

  try { await piano.loaded } catch (e) { console.warn("Piano not fully loaded", e) }

  // genera melodía
  const steps = Math.max(16, Math.min(256, (notes && notes.length) || 64))
  const melody = generateMelody({steps, rnd, key, scaleName})

  // tiempos base
  const tonicSemitone = KEYS[key]||0
  const barSec = 4 * Tone.Time("4n").toSeconds()
  const noteDur = Tone.Time(len).toSeconds()
  const stepSec = noteDur + gap
  const stepsPerBar = Math.max(1, Math.round(barSec/stepSec))
  const totalBars = Math.ceil(melody.length/stepsPerBar)

  // ===== Patrones de acompañamiento variados (MEJORA 3) =====
  const PATTERNS = {
    block: (time, chord) => {
      pad.triggerAttackRelease(chord.map(n=>Tone.Frequency(n,"midi")), barSec, time, 0.28)
      const bassLine = [0,2,3,1]
      for (let k=0;k<4;k++){
        const bt = time + k*Tone.Time("4n").toSeconds()
        const idx = bassLine[k % bassLine.length]
        const note = chord[Math.min(idx, chord.length-1)] - 12
        bass.triggerAttackRelease(Tone.Frequency(note, "midi"), "8n", human(bt,0.003), 0.55 - k*0.05)
      }
    },
    alberti: (time, chord) => {
      const order = [0,2,1,2] // bajo-alto-medio-alto
      for (let s=0; s<8; s++){
        const idx = order[s%4]
        const nt = chord[Math.min(idx, chord.length-1)]
        const tt = time + s * Tone.Time("8n").toSeconds()
        pad.triggerAttackRelease(Tone.Frequency(nt,"midi"), "8n", tt, 0.22)
      }
      for (let k=0;k<4;k++){
        const bt = time + k*Tone.Time("4n").toSeconds()
        bass.triggerAttackRelease(Tone.Frequency(chord[0]-12, "midi"), "8n", human(bt,0.003), 0.52 - k*0.05)
      }
    },
    broken: (time, chord) => {
      for (let s=0; s<8; s++){
        const nt = chord[s % chord.length]
        const tt = time + s * Tone.Time("8n").toSeconds()
        pad.triggerAttackRelease(Tone.Frequency(nt,"midi"), "8n", tt, 0.2)
      }
      pad.triggerAttackRelease(chord.map(n=>Tone.Frequency(n,"midi")), barSec, time, 0.18)
      const bassSeq = [0,2,0,2] // raíz-quinta
      for (let k=0;k<4;k++){
        const bt = time + k*Tone.Time("4n").toSeconds()
        const idx = bassSeq[k%4]
        const note = chord[Math.min(idx, chord.length-1)] - 12
        bass.triggerAttackRelease(Tone.Frequency(note, "midi"), "8n", human(bt,0.003), 0.5 - k*0.05)
      }
    }
  }
  const patternNames = Object.keys(PATTERNS)
  const patternName = patternNames[Math.floor(rnd()*patternNames.length)]
  const playPattern = PATTERNS[patternName]

  // ===== Acompañamiento programado en el Transport con armonía guiada =====
  const barIds = []
  for(let bar=0; bar<totalBars; bar++){
    const barTime = bar*barSec + 0.1
    const i0 = bar*stepsPerBar
    const i1 = Math.min(melody.length, i0 + stepsPerBar)
    const barNotes = melody.slice(i0, i1).filter(m=>m!=null)

    // 1) triada “óptima” por melodía del compás
    let triad = chooseChordForBar({
      barMidis: barNotes,
      key,
      scaleName,
      prefer: (bar === 0 ? "I" : null)
    })

    // 2) asegurar que la nota fuerte cae dentro del acorde
    const strongMidi = barNotes[0] ?? null
    triad = adjustChordToStrongNote({ triad, strongMidi, key, scaleName })

    // 3) cadencia al final V -> I
    const barsLeft = totalBars - bar
    if (barsLeft === 2) { // penúltimo: V
      const ts = buildDiatonicTriads(key, scaleName)
      const V = ts.find(t => t.name==="V")
      if (V) triad = V
    } else if (barsLeft === 1) { // último: I
      const ts = buildDiatonicTriads(key, scaleName)
      const I = ts.find(t => t.name==="I")
      if (I) triad = I
    }

    const chord = triad.midi

    const id = t.schedule((time)=>{
      try{
        playPattern(time, chord)
      } catch(err){ console.error("Bar schedule error:", err) }
    }, `+${barTime.toFixed(3)}`)
    barIds.push(id)
  }

  // ===== Melodía + animación con scheduleRepeat =====
  let i = 0
  const seqId = t.scheduleRepeat((time)=>{
    try{
      if (i >= melody.length){
        t.clear(seqId)
        const stopId = t.schedule(()=>{
          barIds.forEach(id => t.clear(id))
          t.stop()
          t.cancel(0)
          piano.dispose(); pad.dispose(); bass.dispose(); reverb.dispose(); delay.dispose()
          onEnd?.()
        }, "+0.8")
        return
      }
      const m = melody[i]
      onStep?.(i)
      if (m != null){
        const v = 0.7 + 0.2*Math.sin(i*0.4)
        piano.triggerAttackRelease(Tone.Frequency(m,"midi"), noteDur, human(time,0.004), v)
      }
      i++
    } catch(err){
      console.error("Seq step error:", err)
      i++ // avanza aunque haya error para no quedar colgado
    }
  }, stepSec, "+0.1")

  // arrancar
  t.start()
}
