// src/lib/beautyClassic.js
import * as Tone from "tone"

// ===== Utilidades mínimas (copiadas de beauty) =====
const KEYS = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }
const MAJOR = [0,2,4,5,7,9,11]
const MINOR = [0,2,3,5,7,8,10]
const DEGREE_TO_TRIAD = {
  I:[0,4,7], ii:[2,5,9], iii:[4,7,11], IV:[5,9,12], V:[7,11,14], vi:[9,12,16],
}

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
function mapMelodyMidis({notes, key, scaleName, style="hybrid"}){
  const tonicSemitone = KEYS[key] ?? 0
  const tonicMidi = 60 + tonicSemitone
  const scale = (scaleName === "minor") ? MINOR : MAJOR
  const raw = notes.map(midiFromNoteLike).filter(m=>m!=null)
  if (style === "literal") return raw
  if (style === "quant")  return raw.map(m => quantizeToScale(m, tonicMidi, scale))
  // HYBRID: corrige solo si difiere <= 1 semitono
  return raw.map(m => {
    const q = quantizeToScale(m, tonicMidi, scale)
    return (Math.abs(q - m) <= 1) ? q : m
  })
}
function chordFromDegree(deg, tonicSemitone){ // C3–C5
  const tri = DEGREE_TO_TRIAD[deg] || [0,4,7]
  return tri.map(semi => 48 + ((tonicSemitone + semi) % 24))
}
function humanize(val, amt){ return val + (Math.random()*2-1)*amt }

// ===== PRNG sencillo por seed (xorshift32) solo para variar acompañamiento/timbre =====
function hash32(s){
  let h = 2166136261 >>> 0
  for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h || 1
}
function rngFromSeed(seedStr){
  let x = hash32(seedStr||"seed")
  return () => { x ^= x<<13; x^=x>>>17; x^=x<<5; return (x>>>0)/4294967296 }
}
const pick = (arr, r) => arr[Math.floor(r()*arr.length)]

// ===== Motor clásico (piano + strings + bajo) =====
export async function playBeautifulClassic({
  notes, key, scaleName, prog, bpm, swing, len, gap, style="hybrid", seedStr,
  onStep, onEnd
}){
  await Tone.start()

  const t = Tone.getTransport()
  // variaciones leves por seed (sin romper BPM del URL)
  const r = rngFromSeed(seedStr || notes.join(","))
  const bpmJitter = (r()<0.5 ? -1 : +1) * Math.floor(r()*3) // -2..+2 aprox
  t.bpm.value = Math.max(40, Math.min(220, (bpm||96) + bpmJitter))
  t.swing = swing ?? 0.16
  t.swingSubdivision = "8n"

  const noteDurSec = Tone.Time(len || "8n").toSeconds()
  const stepSec = noteDurSec + (gap ?? 0.05)

  // === Timbres (clásicos) ===
  // Piano real (Sampler Salamander)
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
  // Strings suaves
  const strings = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.55, decay: 0.35, sustain: 0.7, release: 1.2 }
  })
  const stringsLP = new Tone.Filter({ type:"lowpass", frequency: 2400, Q: 0.4 })
  // Bajo
  const bass = new Tone.MonoSynth({
    oscillator:{ type:"triangle" },
    filter:{ Q:1, rolloff:-24 },
    envelope:{ attack:0.01, decay:0.18, sustain:0.24, release:0.24 }
  })

  // FX y dinámica (suaves)
  const reverb = new Tone.Reverb({ decay: 2.4, wet: 0.18 })
  const comp   = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.005, release: 0.2 })
  const limiter= new Tone.Limiter(-1)

  piano.chain(reverb, comp, limiter).toDestination()
  strings.chain(stringsLP, reverb, comp, limiter).toDestination()
  bass.chain(reverb, comp, limiter).toDestination()

  try { await piano.loaded } catch (e) { console.warn("Piano not fully loaded", e) }

  // === Melodía: la de Beauty (HYBRID por defecto)
  const melodyMidis = mapMelodyMidis({notes, key, scaleName, style})
  const tonicSemitone = KEYS[key] ?? 0

  // === Acompañamiento fijo diatónico por compás ===
  const barSec = 4 * Tone.Time("4n").toSeconds()
  const stepsPerBar = Math.max(1, Math.round(barSec / stepSec))
  const totalBars = Math.ceil(Math.max(1, melodyMidis.length) / stepsPerBar)

  // patrón acompañamiento (por seed): block / alberti / arpegio roto
  const accType = pick(["block","alberti","broken"], r)

  const barIds = []
  for (let bar = 0; bar < totalBars; bar++){
    const barTime = bar * barSec + 0.12
    const degree = prog[bar % prog.length]
    const triad = chordFromDegree(degree, tonicSemitone) // [midi,midi,midi]

    const id = t.schedule((time) => {
      try{
        // Strings: acorde sostenido con leve swell
        strings.triggerAttackRelease(
          triad.map(n => Tone.Frequency(n,"midi")),
          barSec * 0.95,
          time,
          0.22
        )
        // Bajo: raíz en negras (root 8th), alternando con 5ª si quieres más movimiento
        const bassSeq = [ triad[0]-12, triad[2]-12, triad[0]-12, triad[2]-12 ]
        for (let k=0;k<4;k++){
          const bt = time + k * Tone.Time("4n").toSeconds()
          bass.triggerAttackRelease(Tone.Frequency(bassSeq[k], "midi"), "8n", humanize(bt,0.003), 0.5 - k*0.05)
        }

        // Piano acompañamiento (mano izquierda): block / alberti / broken
        if (accType === "block"){
          // 2 golpes por compás
          piano.triggerAttackRelease(triad.map(n=>Tone.Frequency(n,"midi")), "2n", time+0.001, 0.25)
          piano.triggerAttackRelease(triad.map(n=>Tone.Frequency(n,"midi")), "2n", time+barSec*0.5, 0.22)
        } else if (accType === "alberti"){
          // patrón: bajo-alto-medio-alto (4x corcheas)
          const order = [0,2,1,2]
          for (let k=0;k<4;k++){
            const bt = time + k * Tone.Time("4n").toSeconds()
            const note = triad[order[k % order.length]]
            piano.triggerAttackRelease(Tone.Frequency(note,"midi"), "8n", humanize(bt,0.003), 0.22)
          }
        } else { // "broken": 6 notas por compás si cabe
          const seq = [ triad[0], triad[1], triad[2], triad[1], triad[0], triad[1] ]
          const dt = barSec / seq.length
          for (let k=0;k<seq.length;k++){
            const bt = time + k*dt
            piano.triggerAttackRelease(Tone.Frequency(seq[k],"midi"), "16n", humanize(bt,0.0025), 0.2)
          }
        }
      } catch(err){ console.error("Companion schedule error:", err) }
    }, `+${barTime.toFixed(3)}`)
    barIds.push(id)
  }

  // === Melodía principal (mano derecha) + animación ===
  let i = 0
  const seqId = t.scheduleRepeat((time) => {
    if (i >= melodyMidis.length){
      t.clear(seqId)
      t.schedule(()=>{
        barIds.forEach(id => t.clear(id))
        t.stop()
        t.cancel(0)
        piano.dispose(); strings.dispose(); stringsLP.dispose(); reverb.dispose(); comp.dispose(); limiter.dispose()
        bass.dispose()
        onEnd?.()
      }, "+0.9")
      return
    }
    const m = melodyMidis[i]
    onStep?.(i)
    // mano derecha: piano lead
    piano.triggerAttackRelease(Tone.Frequency(m,"midi"), noteDurSec, humanize(time,0.0035), 0.7)
    i++
  }, stepSec, "+0.10")

  // Arranque
  t.start()
}
