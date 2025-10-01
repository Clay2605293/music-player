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

const human = (x,a)=> x + (Math.random()*2-1)*a
const PITCH_CLASS = m => ((m % 12) + 12) % 12

const chordFromDegree = (deg, tonic) =>
  (DEGREE_TO_TRIAD[deg]||[0,4,7]).map(s => 48 + ((tonic + s) % 24)) // base ~C3–C5

// ---------- hashing & PRNG ----------
async function sha256Bytes(str){
  const data = new TextEncoder().encode(str)
  const buf = await crypto.subtle.digest("SHA-256", data)
  return new Uint8Array(buf)
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

// ---------- escala / melodía ----------
function pick(arr, rnd){ return arr[Math.floor(rnd()*arr.length)] }
function pickKey(rnd){ return Object.keys(KEYS)[Math.floor(rnd()*7)] }
function pickScale(rnd){ return rnd()<0.35 ? "minor" : "major" }
function scalePitches(key, scaleName){
  const tonic = KEYS[key]||0
  const sc = (scaleName==="minor")?MINOR:MAJOR
  return sc.map(s=> (tonic+s)%12 )
}

// motivo con variaciones + saltos + silencios
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

// ---------- armonía guiada por melodía ----------
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
function chooseChordForBar({barMidis, key, scaleName, prefer, prevRootPc}){
  const triads = buildDiatonicTriads(key, scaleName)
  if (barMidis.length === 0) return triads[0]
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
    // transición suave de raíces (pequeña ventaja si la raíz está cerca de la anterior)
    if (prevRootPc != null){
      const rootPc = t.pcs[0]
      const dist = Math.min((rootPc - prevRootPc + 12) % 12, (prevRootPc - rootPc + 12) % 12)
      s += (6 - dist) * 0.05 // cuanto más cerca, mejor
    }
    s += (t.name==="V") ? 0.03 : 0
    if (s > bestScore){ bestScore = s; best = t }
  }
  return best
}
function adjustChordToStrongNote({triad, strongMidi, key, scaleName}){
  if (strongMidi == null) return triad
  const strongPc = PITCH_CLASS(strongMidi)
  if (triad.pcs.includes(strongPc)) return triad
  const triads = buildDiatonicTriads(key, scaleName)
  const cand = triads.filter(t => t.pcs.includes(strongPc))
  return cand[0] || triad
}

// inversions/voicings cercanos al acorde anterior (conducción de voces)
function voiceLeadChord(prevVoicing, baseTriad){ // baseTriad = [midi... alrededor de C3–C5]
  if (!prevVoicing) return baseTriad
  const options = []
  // generar voicings moviendo notas +/- 12 hasta quedar cerca del promedio anterior
  const prevAvg = prevVoicing.reduce((a,b)=>a+b,0)/prevVoicing.length
  for (let o0 of [ -12, 0, +12 ]){
    for (let o1 of [ -12, 0, +12 ]){
      for (let o2 of [ -12, 0, +12 ]){
        const v = [baseTriad[0]+o0, baseTriad[1]+o1, baseTriad[2]+o2]
        const avg = (v[0]+v[1]+v[2])/3
        const spread = Math.max(...v)-Math.min(...v)
        const dist = Math.abs(avg - prevAvg) + spread*0.02
        options.push({v, dist})
      }
    }
  }
  options.sort((a,b)=>a.dist-b.dist)
  return options[0].v
}

// diatonic third/sixth above for harmony voice
function diatonicOffset(m, key, scaleName, steps=2){ // 2 steps ≈ tercera diatónica
  const tonic = KEYS[key]||0
  const scale = (scaleName==="minor")?MINOR:MAJOR
  const pc = PITCH_CLASS(m)
  // construir escala absoluta a partir de esta octava
  const scalePcs = scale.map(s => ((tonic+s)%12))
  // encontrar índice actual dentro de la escala (más cercano)
  let idx = 0, best=1e9
  for (let i=0;i<scalePcs.length;i++){
    const d = Math.min((scalePcs[i]-pc+12)%12,(pc-scalePcs[i]+12)%12)
    if (d<best){ best=d; idx=i }
  }
  const targetPc = scalePcs[(idx+steps)%scalePcs.length]
  // cantidad de semitonos diatónica hacia arriba (o abajo si conviene)
  let up = (targetPc - pc + 12)%12
  if (up===0) up = 12
  return m + up
}

// armoniza melodía con acorde (ajusta downbeats) + genera segunda voz
function harmonizeMelodyToChords({melody, chordsPerBar, stepsPerBar, key, scaleName}){
  const outMel = melody.slice()
  const second = new Array(melody.length).fill(null)

  for (let i=0;i<melody.length;i++){
    const bar = Math.floor(i/stepsPerBar)
    const chord = chordsPerBar[bar] || chordsPerBar[chordsPerBar.length-1]
    const strong = (i % stepsPerBar) === 0 || (i % stepsPerBar) === Math.floor(stepsPerBar/2) // 1 y 3
    let m = outMel[i]
    if (m != null && strong){
      // si no es del acorde, ajusta al tono del acorde más cercano
      const pcs = chord.map(n => PITCH_CLASS(n))
      if (!pcs.includes(PITCH_CLASS(m))){
        // sube/baja al más cercano
        const candidates = [m-1, m+1, m-2, m+2]
        let best = m, bestD = 1e9
        for (const c of candidates){
          const d = Math.min(...pcs.map(pc=> Math.min((pc - PITCH_CLASS(c)+12)%12, (PITCH_CLASS(c) - pc + 12)%12)))
          if (d < bestD){ bestD = d; best = c }
        }
        m = best
        outMel[i] = m
      }
      // segunda voz: tercera diatónica arriba (o sexta abajo si queda muy cerca)
      let h = diatonicOffset(m, key, scaleName, 2)
      if (Math.abs(h - m) < 3) h += 5 // evita choque cercano
      second[i] = h
    } else if (m != null){
      // tiempos débiles: opcionalmente una segunda voz ocasional
      if (i%2===1 && Math.random()<0.25) second[i] = diatonicOffset(m, key, scaleName, 2)
    }
  }
  return { melody: outMel, harmony: second }
}

// ---------- interfaz seed ----------
export async function playSeedAvalanche({
  notes, bpm, len, gap, swing, onStep, onEnd, seedStr, key:forcedKey, scaleName:forcedScale, prog:forcedProg
}){
  await Tone.start()

  // Limpieza previa
  const t = Tone.getTransport()
  t.stop()
  t.cancel(0)
  t.bpm.value = bpm
  t.swing = swing
  t.swingSubdivision = "8n"

  // seed
  const rawSeed = seedStr || (Array.isArray(notes) ? notes.join(",") : String(notes||""))
  const digest = await sha256Bytes(rawSeed)
  const rnd = xoshiroFromBytes(digest, 0)

  // parámetros del seed (overridable)
  const key = forcedKey || pickKey(rnd)
  const scaleName = forcedScale || pickScale(rnd)
  const prog = forcedProg || pick(PROGRESSIONS, rnd)

  // ===== Instrumentos (orquesta ligera) =====
  // Piano (lead)
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

  // Strings (pad orquestal)
  const strings = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.6, decay: 0.4, sustain: 0.7, release: 1.4 }
  })
  const stringsFilter = new Tone.Filter({ type: "lowpass", frequency: 2500, Q: 0.3 })
  const stringsChorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4.5, depth: 0.6, feedback: 0.1, wet: 0.35 }).start()

  // Cellos (bajo suave)
  const cellos = new Tone.MonoSynth({
    oscillator:{ type:"triangle" },
    filter:{ Q:1, rolloff:-24 },
    envelope:{ attack:0.01, decay:0.18, sustain:0.25, release:0.25 }
  })

  // FX y dinámica
  const reverb = new Tone.Reverb({ decay: 2.6, wet: 0.2 })
  const comp = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.005, release: 0.2 })
  const limiter = new Tone.Limiter(-1)

  piano.chain(reverb, comp, limiter).toDestination()
  strings.chain(stringsFilter, stringsChorus, reverb, comp, limiter).toDestination()
  cellos.chain(reverb, comp, limiter).toDestination()

  try { await piano.loaded } catch (e) { console.warn("Piano not fully loaded", e) }

  // melodía base
  const steps = Math.max(16, Math.min(256, (notes && notes.length) || 64))
  const melodyRaw = generateMelody({steps, rnd, key, scaleName})

  // tiempos base
  const tonicSemitone = KEYS[key]||0
  const barSec = 4 * Tone.Time("4n").toSeconds()
  const noteDur = Tone.Time(len).toSeconds()
  const stepSec = noteDur + gap
  const stepsPerBar = Math.max(1, Math.round(barSec/stepSec))
  const totalBars = Math.ceil(melodyRaw.length/stepsPerBar)

  // ===== Selección de acordes (por compás) con conducción de voces =====
  const chordsPerBar = []
  let prevRootPc = null
  let prevVoicing = null

  for (let bar=0; bar<totalBars; bar++){
    const i0 = bar*stepsPerBar
    const i1 = Math.min(melodyRaw.length, i0 + stepsPerBar)
    const barNotes = melodyRaw.slice(i0, i1).filter(m=>m!=null)

    // 1) triada por melodía
    let triad = chooseChordForBar({
      barMidis: barNotes,
      key, scaleName,
      prefer: (bar === 0 ? "I" : null),
      prevRootPc
    })

    // 2) asegurar que la nota fuerte cae en el acorde
    const strongMidi = barNotes[0] ?? null
    triad = adjustChordToStrongNote({ triad, strongMidi, key, scaleName })

    // 3) cadencia V -> I al final
    const barsLeft = totalBars - bar
    if (barsLeft === 2) {
      const ts = buildDiatonicTriads(key, scaleName)
      const V = ts.find(t => t.name==="V")
      if (V) triad = V
    } else if (barsLeft === 1) {
      const ts = buildDiatonicTriads(key, scaleName)
      const I = ts.find(t => t.name==="I")
      if (I) triad = I
    }

    // 4) voicing cercano al anterior
    const voiced = voiceLeadChord(prevVoicing, triad.midi)
    chordsPerBar.push(voiced)
    prevVoicing = voiced
    prevRootPc = triad.pcs[0]
  }

  // ===== Armoniza melodía (ajustes en beats fuertes + 2ª voz) =====
  const { melody, harmony } = harmonizeMelodyToChords({
    melody: melodyRaw, chordsPerBar, stepsPerBar, key, scaleName
  })

  // ===== Acompañamiento sinfónico =====
  const barIds = []
  for(let bar=0; bar<totalBars; bar++){
    const barTime = bar*barSec + 0.12
    const chord = chordsPerBar[bar]

    const id = t.schedule((time)=>{
      try{
        // strings: acorde largo con leve “crescendo” manual (dos golpes solapados)
        strings.triggerAttackRelease(chord.map(n=>Tone.Frequency(n,"midi")), barSec*0.9, time, 0.18)
        strings.triggerAttackRelease(chord.map(n=>Tone.Frequency(n,"midi")), barSec*0.6, time+barSec*0.35, 0.24)

        // cellos: raíz-quinta-raíz-quinta (negra)
        const bassSeq = [ chord[0]-12, chord[2]-12, chord[0]-12, chord[2]-12 ]
        for (let k=0;k<4;k++){
          const bt = time + k*Tone.Time("4n").toSeconds()
          cellos.triggerAttackRelease(Tone.Frequency(bassSeq[k],"midi"), "8n", human(bt,0.003), 0.52 - k*0.05)
        }
      } catch(err){ console.error("Bar schedule error:", err) }
    }, `+${barTime.toFixed(3)}`)
    barIds.push(id)
  }

  // ===== Melodía principal + 2ª voz + animación =====
  let i = 0
  const seqId = t.scheduleRepeat((time)=>{
    try{
      if (i >= melody.length){
        t.clear(seqId)
        t.schedule(()=>{
          barIds.forEach(id => t.clear(id))
          t.stop()
          t.cancel(0)
          piano.dispose(); strings.dispose(); stringsFilter.dispose(); stringsChorus.dispose()
          cellos.dispose(); reverb.dispose(); comp.dispose(); limiter.dispose()
          onEnd?.()
        }, "+0.9")
        return
      }

      const m  = melody[i]
      const h2 = harmony[i]
      onStep?.(i)

      if (m != null){
        const v = 0.72 + 0.18*Math.sin(i*0.35)
        piano.triggerAttackRelease(Tone.Frequency(m,"midi"), noteDur, human(time,0.004), v)
      }
      if (h2 != null){
        piano.triggerAttackRelease(Tone.Frequency(h2,"midi"), noteDur*0.95, human(time+0.002,0.003), 0.55)
      }

      i++
    } catch(err){
      console.error("Seq step error:", err)
      i++
    }
  }, stepSec, "+0.1")

  // arrancar
  t.start()
}
