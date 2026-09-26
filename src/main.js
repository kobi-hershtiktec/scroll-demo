import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

const FRAME_COUNT = 191
const portraitQuery = window.matchMedia('(max-aspect-ratio: 1/1)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let portrait = portraitQuery.matches
const frameUrl = (i) =>
  `${import.meta.env.BASE_URL}frames/${portrait ? 'mobile' : 'desktop'}/${String(i + 1).padStart(4, '0')}.webp`

const canvas = document.querySelector('.stage__canvas')
const ctx = canvas.getContext('2d')
let frames = new Array(FRAME_COUNT)
const state = { frame: 0 }
let lastDrawn = -1

// ---------- drawing ----------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  lastDrawn = -1
  draw()
}

// Rotating a phone / resizing across 1:1 swaps to the other frame set.
portraitQuery.addEventListener('change', (e) => {
  portrait = e.matches
  frames = new Array(FRAME_COUNT)
  preload(() => {})
})

// Nearest loaded frame, so a gap during loading never flashes black.
function nearestLoaded(i) {
  for (let d = 0; d < FRAME_COUNT; d++) {
    if (frames[i - d]?.complete) return frames[i - d]
    if (frames[i + d]?.complete) return frames[i + d]
  }
  return null
}

function draw() {
  const i = Math.round(state.frame)
  if (i === lastDrawn) return
  const img = nearestLoaded(i)
  if (!img || !img.naturalWidth) return
  lastDrawn = img === frames[i] ? i : -1

  const cw = canvas.width
  const ch = canvas.height
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  // The footage's background is pure black like the page, so the frame can be placed
  // freely. Desktop: fill the height, cup centred at 30% from the left (text sits on
  // the right). Portrait: fit to width in the upper part of the screen.
  const scale = portrait ? Math.min(cw / iw, (ch * 0.62) / ih) : Math.max(ch / ih, (cw * 0.62) / iw)
  const w = iw * scale
  const h = ih * scale
  const x = portrait ? (cw - w) / 2 : cw * 0.3 - w / 2
  const y = portrait ? ch * 0.06 : (ch - h) / 2

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, cw, ch)
  ctx.drawImage(img, x, y, w, h)
}

// ---------- preload ----------
function loadFrame(list, i) {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = img.onerror = () => {
      if (list === frames) draw()
      resolve()
    }
    img.src = frameUrl(i)
    list[i] = img
  })
}

async function preload(onProgress) {
  const list = frames
  await loadFrame(list, 0)
  resize()
  let done = 1
  // Coarse pass first (every 8th frame), then fill in: scrubbing works early and sharpens as it loads.
  const order = []
  for (let step of [8, 4, 2, 1]) {
    for (let i = 0; i < FRAME_COUNT; i += step) if (!order.includes(i) && i !== 0) order.push(i)
  }
  const queue = order.slice()
  const worker = async () => {
    // Stop if the set was swapped mid-load.
    while (queue.length && list === frames) {
      await loadFrame(list, queue.shift())
      onProgress(++done / FRAME_COUNT)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}

// ---------- scroll ----------
function setupScroll() {
  const lenis = new Lenis({ lerp: 0.085, smoothWheel: true })
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
      scrub: 0.6,
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
      .fromTo(parts, { y: 60, opacity: 0, filter: 'blur(8px)' }, { y: 0, opacity: 1, filter: 'blur(0px)', stagger: 0.05, duration: 0.25 })
      .to(parts, { y: -50, opacity: 0, filter: 'blur(6px)', stagger: 0.04, duration: 0.2 }, 0.5)
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
    state.frame = 95
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
