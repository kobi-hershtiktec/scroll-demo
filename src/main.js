import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

const FRAME_COUNT = 382
const portraitQuery = window.matchMedia('(max-aspect-ratio: 1/1)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let portrait = portraitQuery.matches
const frameUrl = (i) =>
  `${import.meta.env.BASE_URL}frames/${portrait ? 'mobile' : 'desktop'}/${String(i + 1).padStart(4, '0')}.webp`

const canvas = document.querySelector('.stage__canvas')
// Opaque canvas: the browser can skip blending it with what's behind.
const ctx = canvas.getContext('2d', { alpha: false })
const state = { frame: 0 }

// All 382 frames decoded would need ~1.5GB, so the browser would evict them and
// re-decode on the main thread mid-scroll (visible hitches). Instead: keep every frame
// as a small encoded Blob, and decode only a window around the playhead into
// ImageBitmaps (off the main thread, straight at the drawn size), freeing the rest.
const WINDOW = 24 // frames decoded ahead of and behind the playhead
const KEEP = 36 // bitmaps further than this are freed
const MAX_IN_FLIGHT = 6

let blobs = new Array(FRAME_COUNT)
let bitmaps = new Map()
let inFlight = new Set()
let setId = 0
let decodeSize = null
let lastDrawn = -1

const frameSize = () => (portrait ? [600, 720] : [900, 1080])

// Frames are cropped to the cup on a pure-black background like the page, so they
// can be placed freely. Desktop: fill the height, cup centred at 30% from the left
// (text sits on the right). Portrait: fit to width in the upper part of the screen.
function layout() {
  const cw = canvas.width
  const ch = canvas.height
  const [iw, ih] = frameSize()
  const scale = portrait ? Math.min(cw / iw, (ch * 0.62) / ih) : Math.min(ch / ih, (cw * 0.55) / iw)
  const w = Math.round(iw * scale)
  const h = Math.round(ih * scale)
  const x = portrait ? (cw - w) / 2 : cw * 0.3 - w / 2
  const y = portrait ? ch * 0.06 : (ch - h) / 2
  return { x, y, w, h }
}

function freeAll() {
  bitmaps.forEach((b) => b.close())
  bitmaps = new Map()
  inFlight = new Set()
  setId++
  lastDrawn = -1
}

function resize() {
  // Frames are at most 1080px tall, so anything above 1.5x only costs fill-rate.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  const { w, h } = layout()
  if (!decodeSize || decodeSize.w !== w || decodeSize.h !== h) {
    decodeSize = { w, h }
    freeAll()
  }
  lastDrawn = -1
  draw()
}

// Rotating a phone / resizing across 1:1 swaps to the other frame set.
portraitQuery.addEventListener('change', (e) => {
  portrait = e.matches
  blobs = new Array(FRAME_COUNT)
  decodeSize = null
  freeAll()
  preload(() => {})
})

function decode(i) {
  if (i < 0 || i >= FRAME_COUNT || !blobs[i] || bitmaps.has(i) || inFlight.has(i)) return
  const id = setId
  const pending = inFlight
  pending.add(i)
  const { w, h } = decodeSize
  createImageBitmap(blobs[i], { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
    .catch(() => createImageBitmap(blobs[i]))
    .then((bmp) => {
      pending.delete(i)
      if (id !== setId || Math.abs(i - state.frame) > KEEP) return bmp.close()
      bitmaps.set(i, bmp)
      draw()
    })
    .catch(() => pending.delete(i))
}

// Decode outward from the playhead, and free what has fallen far behind.
function schedule() {
  if (!decodeSize) return
  const c = Math.round(state.frame)
  for (let d = 0; d <= WINDOW && inFlight.size < MAX_IN_FLIGHT; d++) {
    decode(c + d)
    if (inFlight.size < MAX_IN_FLIGHT) decode(c - d)
  }
  bitmaps.forEach((b, k) => {
    if (Math.abs(k - c) > KEEP) {
      b.close()
      bitmaps.delete(k)
    }
  })
}

function draw() {
  schedule()
  const i = Math.round(state.frame)
  if (i === lastDrawn) return
  // Exact frame, or the nearest decoded one while it catches up (never a black flash).
  let bmp = null
  let at = -1
  for (let d = 0; d <= KEEP && !bmp; d++) {
    if (bitmaps.has(i - d)) (bmp = bitmaps.get(i - d)), (at = i - d)
    else if (bitmaps.has(i + d)) (bmp = bitmaps.get(i + d)), (at = i + d)
  }
  if (!bmp) return
  lastDrawn = at === i ? i : -1
  const { x, y, w, h } = layout()
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, x, y, w, h)
}

// ---------- preload (encoded files only, ~5MB) ----------
async function loadFrame(list, i) {
  try {
    const res = await fetch(frameUrl(i))
    if (res.ok) list[i] = await res.blob()
  } catch {}
  if (list === blobs) draw()
}

async function preload(onProgress) {
  const list = blobs
  await loadFrame(list, 0)
  resize()
  let done = 1
  // Coarse pass first (every 16th frame), then fill in: scrubbing works early and sharpens as it loads.
  const order = new Set()
  for (const step of [16, 8, 4, 2, 1]) {
    for (let i = step; i < FRAME_COUNT; i += step) order.add(i)
  }
  const queue = [...order]
  const worker = async () => {
    // Stop if the set was swapped mid-load.
    while (queue.length && list === blobs) {
      await loadFrame(list, queue.shift())
      onProgress(++done / FRAME_COUNT)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}

// ---------- scroll ----------
function setupScroll() {
  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)

  const degEl = document.querySelector('.deg')

  // The rotation spans the hero bottom → end of the story.
  gsap.to(state, {
    frame: FRAME_COUNT - 1,
    ease: 'none',
    scrollTrigger: {
      trigger: '.story',
      start: 'top bottom',
      end: 'bottom bottom',
      // Lenis already smooths the scroll; a second heavy smoothing layer feels laggy.
      scrub: 0.25,
    },
    onUpdate() {
      draw()
      degEl.textContent = Math.round((state.frame / (FRAME_COUNT - 1)) * 360)
    },
  })

  // Slow camera push-in across the story, then settle back for the outro.
  gsap
    .timeline({ scrollTrigger: { trigger: 'main', start: 'top top', end: 'bottom bottom', scrub: 1 } })
    .fromTo(canvas, { scale: 1 }, { scale: 1.12, ease: 'none', duration: 0.8 })
    .to(canvas, { scale: 1, opacity: 0.35, ease: 'power1.inOut', duration: 0.2 })

  gsap.to('.progress__bar', {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: { trigger: 'main', start: 'top top', end: 'bottom bottom', scrub: true },
  })

  // Hero leaves.
  gsap.to('.hero > *', {
    y: -80,
    opacity: 0,
    stagger: 0.05,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 30%', scrub: true },
  })

  // Each step's content is sticky: it lifts in, holds while the cup turns, then lifts out.
  gsap.utils.toArray('.step').forEach((step) => {
    const parts = step.querySelector('.step__inner').children
    gsap
      .timeline({ scrollTrigger: { trigger: step, start: 'top 70%', end: 'bottom top', scrub: true } })
      .fromTo(parts, { y: 60, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.25 })
      .to(parts, { y: -50, opacity: 0, stagger: 0.04, duration: 0.2 }, 0.5)
  })

  gsap.from('.outro > *', {
    y: 40,
    opacity: 0,
    stagger: 0.12,
    scrollTrigger: { trigger: '.outro', start: 'top 60%', end: 'top 10%', scrub: true },
  })

  // Web fonts change text heights, which moves every trigger.
  document.fonts.ready.then(() => ScrollTrigger.refresh())

  // Hero intro.
  gsap.from('.hero .line > span', { yPercent: 110, duration: 1.4, ease: 'expo.out', stagger: 0.12, delay: 0.2 })
  gsap.from(['.eyebrow', '.hero__lead', '.hero__hint'], { opacity: 0, y: 20, duration: 1.2, ease: 'power3.out', stagger: 0.1, delay: 0.6 })
}

// ---------- boot ----------
const loader = document.querySelector('.loader')
const pctEl = document.querySelector('.loader__pct')
document.body.classList.add('is-loading')
window.addEventListener('resize', resize)

let revealed = false
function reveal() {
  if (revealed) return
  revealed = true
  loader.classList.add('is-done')
  document.body.classList.remove('is-loading')
  if (reducedMotion) {
    // Static, front-facing frame; content simply scrolls.
    state.frame = FRAME_COUNT / 2
    lastDrawn = -1
    draw()
    return
  }
  setupScroll()
}

preload((p) => {
  pctEl.textContent = Math.round(p * 100)
  // The coarse pass (every 4th frame) is enough to start; the rest streams in behind.
  if (p >= 0.3) reveal()
}).then(() => {
  reveal()
  lastDrawn = -1
  draw()
})
