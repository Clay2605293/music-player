// src/lib/beautyClassic.js
import * as Tone from "tone"

// ===== Utilidades mínimas (tomadas de beauty) =====
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
function chordFromDegree(deg, tonicSemitone){ // C3–C5 aprox
  const tri = DEGREE_TO_TRIAD[deg] || [0,4,7]
  return tri.map(semi => 48 + ((tonicSemitone + semi) % 24))
}
function humanize(val, amt){ return val + (Math.random()*2-1)*amt }

// PRNG ligero para variar acompañamiento
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

// Relación funcional simple para acorde complementario (clásico V⇄I, vi⇄IV, ii→V…)
const COMPLEMENT_OF = {
  I:"V", V:"I", vi:"IV", IV:"V", ii:"V", iii:"vi"
}

// ===== Motor clásico: PIANO SOLO =====
export async function playBeautifulClassic({
  notes, key, scaleName, prog, bpm, swing, len, gap, style="hybrid", seedStr,
  onStep, onEnd
}){
  await Tone.start()

  const t = Tone.getTransport()
  // limpieza por si había algo corriendo
  t.stop(); t.cancel(0)

  // variaciones leves por seed (sin romper BPM del URL)
  const r = rngFromSeed(seedStr || (notes||[]).join(","))
  const bpmJitter = (r()<0.5 ? -1 : +1) * Math.floor(r()*3) // -2..+2
  t.bpm.value = Math.max(40, Math.min(220, (bpm||96) + bpmJitter))
  t.swing = swing ?? 0.16
  t.swingSubdivision = "8n"

  const noteDurSec = Tone.Time(len || "8n").toSeconds()
  const stepSec = noteDurSec + (gap ?? 0.05)

  // === Timbre: Piano Salamander + un reverb de sala muy discreto ===
  const piano = new Tone.Sampler({
    urls: {
      "A1":"A1.mp3","C2":"C2.mp3","D#2":"Ds2.mp3","F#2":"Fs2.mp3",
      "A2":"A2.mp3","C3":"C3.mp3","D#3":"Ds3.mp3","F#3":"Fs3.mp3",
      "A3":"A3.mp3","C4":"C4.mp3","D#4":"Ds4.mp3","F#4":"Fs4.mp3",
      "A4":"A4.mp3","C5":"C5.mp3","D#5":"Ds5.mp3","F#5":"Fs5.mp3",
      "A5":"A5.mp3"
    },
    release: 1.3,
    baseUrl: "https://tonejs.github.io/audio/salamander/"
  })
  // Reverb pequeño tipo sala (natural, nada “electro”)
  const hall = new Tone.Reverb({ decay: 1.8, wet: 0.12 })
  piano.connect(hall).toDestination()

  try { await piano.loaded } catch(e){ console.warn("Piano not fully loaded", e) }

  // === Melodía (misma que Beauty HYBRID por defecto) ===
  const melodyMidis = mapMelodyMidis({notes, key, scaleName, style})
  const tonicSemitone = KEYS[key] ?? 0

  // === Acompañamiento sólo con el piano ===
  const barSec = 4 * Tone.Time("4n").toSeconds()
  const stepsPerBar = Math.max(1, Math.round(barSec / stepSec))
  const totalBars = Math.ceil(Math.max(1, melodyMidis.length) / stepsPerBar)

  // patrón de mano izq. (por seed)
  const accType = pick(["block","alberti","broken"], r)

  const barIds = []
  for (let bar = 0; bar < totalBars; bar++){
    const barTime = bar*barSec + 0.10
    const degree = prog[bar % prog.length]
    const triad = chordFromDegree(degree, tonicSemitone) // acorde base
    // acorde complementario (función sencilla); si no existe mapeo, usa el mismo
    const compDegree = COMPLEMENT_OF[degree] || degree
    const compTriad = chordFromDegree(compDegree, tonicSemitone)

    const id = t.schedule((time)=>{
      try{
        // Acompañamiento mano izquierda
        if (accType === "block"){
          // 2 golpes por compás (blancos)
          piano.triggerAttackRelease(triad.map(n=>Tone.Frequency(n,"midi")), "2n", time+0.001, 0.26)
          piano.triggerAttackRelease(triad.map(n=>Tone.Frequency(n,"midi")), "2n", time+barSec*0.5, 0.23)
        } else if (accType === "alberti"){
          // bajo–alto–medio–alto en corcheas
          const order = [0,2,1,2]
          for (let k=0;k<4;k++){
            const bt = time + k*Tone.Time("4n").toSeconds()
            const note = triad[order[k % order.length]]
            piano.triggerAttackRelease(Tone.Frequency(note,"midi"), "8n", humanize(bt,0.003), 0.23)
          }
        } else { // "broken": arpegio de 6 notas si cabe
          const seq = [ triad[0], triad[1], triad[2], triad[1], triad[0], triad[1] ]
          const dt = barSec / seq.length
          for (let k=0;k<seq.length;k++){
            const bt = time + k*dt
            piano.triggerAttackRelease(Tone.Frequency(seq[k],"midi"), "16n", humanize(bt,0.0025), 0.21)
          }
        }

        // “Acorde complementario” en el tiempo fuerte del medio del compás
        // (entra suave para dar color clásico sin sonar eléctrico)
        const mid = time + barSec*0.5
        piano.triggerAttackRelease(
          compTriad.map(n=>Tone.Frequency(n,"midi")),
          "4n",
          humanize(mid, 0.002),
          0.22
        )
      } catch(err){ console.error("Piano comp schedule error:", err) }
    }, `+${barTime.toFixed(3)}`)
    barIds.push(id)
  }

  // === Melodía principal (mano derecha) + animación ===
  let i = 0
  const seqId = t.scheduleRepeat((time)=>{
    if (i >= melodyMidis.length){
      t.clear(seqId)
      t.schedule(()=>{
        barIds.forEach(id => t.clear(id))
        t.stop(); t.cancel(0)
        piano.dispose(); hall.dispose()
        onEnd?.()
      }, "+0.8")
      return
    }
    const m = melodyMidis[i]
    onStep?.(i)
    piano.triggerAttackRelease(Tone.Frequency(m,"midi"), noteDurSec, humanize(time,0.0035), 0.72)
    i++
  }, stepSec, "+0.12")

  // Arranque
  t.start()
}
