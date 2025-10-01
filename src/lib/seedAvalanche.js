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
  (DEGREE_TO_TRIAD[deg]||[0,4,7]).map(s => 48 + ((tonic + s) % 24)) // cerca C3–C5

const human = (x,a)=> x + (Math.random()*2-1)*a

// ---------- hashing & PRNG (avalancha fuerte) ----------
async function sha256Bytes(str){
  const data = new TextEncoder().encode(str)
  const buf = await crypto.subtle.digest("SHA-256", data)
  return new Uint8Array(buf) // 32 bytes
}
// xoshiro128** PRNG a partir de 16 bytes del hash
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
function pickProg(rnd){ return pick(PROGRESSIONS, rnd) }
function scalePitches(key, scaleName){
  const tonic = KEYS[key]||0
  const sc = (scaleName==="minor")?MINOR:MAJOR
  return sc.map(s=> (tonic+s)%12 )
}

// genera una melodía a partir del seed (motivos + saltos + rests)
function generateMelody({steps, rnd, key, scaleName}){
  const pcs = scalePitches(key, scaleName)
  const octaves = [4,4,5,3,5,4,5]  // sesgo a 4–5
  const melody = []
  // motivo base (4 notas)
  const motif = Array.from({length:4}, ()=> pcs[Math.floor(rnd()*pcs.length)] + 12*pick(octaves, rnd))
  // transformaciones
  const invert = rnd()<0.5, retro = rnd()<0.35
  const motif2 = motif.map((m)=> invert ? (motif[0]-(m-motif[0])) : m)
  const motifUse = retro ? motif2.slice().reverse() : motif2

  let idx = 0
  for (let i=0;i<steps;i++){
    if (i%4===0 && i) { // cada compás, varía
      const delta = (rnd()<0.6)? (rnd()<0.5?+2:-2) : 0
      for (let k=0;k<motifUse.length;k++) motifUse[k]+=delta
    }
    let note = motifUse[idx % motifUse.length]
    if (rnd()<0.15){ note += (rnd()<0.5?+12:-12) } // salto grande ocasional
    while (note < 48) note += 12
    while (note > 84) note -= 12
    const rest = rnd()<0.07
    melody.push(rest ? null : note)
    idx++
  }
  return melody
}

// ---------- interfaz: usa seed (iv|seed|notes) y genera todo ----------
export async function playSeedAvalanche({
  notes, bpm, len, gap, swing, onStep, onEnd, seedStr, key:forcedKey, scaleName:forcedScale, prog:forcedProg
}){
  await Tone.start()
  const t = Tone.getTransport()
  t.bpm.value = bpm; t.swing = swing; t.swingSubdivision = "8n"

  // seed desde iv|seed|notes
  const rawSeed = seedStr || (Array.isArray(notes) ? notes.join(",") : String(notes||""))
  const digest = await sha256Bytes(rawSeed)
  const rnd = xoshiroFromBytes(digest, 0)

  // parámetros derivados del seed (permiten override)
  const key = forcedKey || pickKey(rnd)
  const scaleName = forcedScale || pickScale(rnd)
  const prog = forcedProg || pick(PROGRESSIONS, rnd)

  // instrumentos (varían por seed)
  const leadType = pick(["triangle","sawtooth","square"], rnd)
  const padType  = pick(["sine","triangle"], rnd)
  const bassType = pick(["square","sawtooth"], rnd)

  const reverb = new Tone.Reverb({ decay: 2.6 + rnd()*2.2, wet: 0.22 + rnd()*0.12 }).toDestination()
  const delay  = new Tone.FeedbackDelay({ delayTime: pick(["8n","16n"], rnd), feedback: 0.18 + rnd()*0.16, wet: 0.14 + rnd()*0.1 }).toDestination()

  const lead = new Tone.Synth({ oscillator:{type:leadType}, envelope:{attack:0.01, decay:0.13, sustain:0.18, release:0.22} }).connect(delay).connect(reverb)
  const pad  = new Tone.PolySynth(Tone.Synth, { oscillator:{type:padType},  envelope:{attack:0.35, decay:0.3, sustain:0.45, release:0.9} }).connect(reverb)
  const bass = new Tone.MonoSynth({ oscillator:{type:bassType}, filter:{Q:1, rolloff:-24}, envelope:{attack:0.02, decay:0.22, sustain:0.22, release:0.22} }).connect(reverb)

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

  // ===== Acompañamiento programado en el Transport =====
  const barIds = []
  for(let bar=0; bar<totalBars; bar++){
    const barTime = bar*barSec + 0.1
    const degree = prog[bar % prog.length]
    const chord  = chordFromDegree(degree, tonicSemitone)

    const id = t.schedule((time)=>{
      // pad
      pad.triggerAttackRelease(chord.map(n=>Tone.Frequency(n,"midi")), barSec, time, 0.33)
      // bajo patrón
      const pattern = [0,2,3,1]
      for (let k=0;k<4;k++){
        const idx = pattern[k % pattern.length]
        const bt = time + k*Tone.Time("4n").toSeconds()
        bass.triggerAttackRelease(Tone.Frequency(chord[idx]-12, "midi"), "8n", human(bt,0.004), 0.6 - k*0.06)
      }
    }, `+${barTime.toFixed(3)}`)
    barIds.push(id)
  }

  // ===== Melodía + animación con scheduleRepeat =====
  let i = 0
  const seqId = t.scheduleRepeat((time)=>{
    if (i >= melody.length){
      t.clear(seqId)
      const stopId = t.schedule(()=>{
        barIds.forEach(id => t.clear(id))
        t.stop()
        t.cancel(0)
        lead.dispose(); pad.dispose(); bass.dispose(); reverb.dispose(); delay.dispose()
        onEnd?.()
      }, "+0.8")
      return
    }
    const m = melody[i]
    onStep?.(i)
    if (m != null){
      const v = 0.6 + 0.3*Math.sin(i*0.5)
      lead.triggerAttackRelease(Tone.Frequency(m,"midi"), noteDur, human(time,0.006), v)
    }
    i++
  }, stepSec, "+0.1")

  // arrancar
  t.start()
}
