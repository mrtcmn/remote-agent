import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

// Luminous, low-contrast washes: a pale base, a warm bloom set against a cool
// wash, and a bright core. Every palette stays light enough that the ink wins
// on contrast, so the letters never sit on a muddy mid-tone.
const PALETTES = [
  { base: "#e6e8fa", colors: ["#ffa45c", "#ff7043", "#5aa9ff"], glow: "#fff0d6", ink: "#2a2d5c" },
  { base: "#eae7fb", colors: ["#8b7bf0", "#ff9ecb", "#ffd08a"], glow: "#fdf1ff", ink: "#38265f" },
  { base: "#e2f1fb", colors: ["#39bde0", "#54d6b0", "#ffd07a"], glow: "#effcff", ink: "#0f4459" },
  { base: "#fdeade", colors: ["#ff7f5e", "#ffc266", "#8fb6ff"], glow: "#fff3e2", ink: "#5c2a24" },
  { base: "#e9f4e1", colors: ["#6fcb7a", "#cfe063", "#7fc6f5"], glow: "#f7ffe8", ink: "#21492a" },
  { base: "#ece5f7", colors: ["#7a6ad6", "#f18fb4", "#ffc27a"], glow: "#fdeef5", ink: "#372754" },
  { base: "#e3eafb", colors: ["#4f86f0", "#7fd4f2", "#ffb0a0"], glow: "#eff6ff", ink: "#1c3364" },
  { base: "#fbe9e6", colors: ["#f58a7c", "#f7c08a", "#9fb8f0"], glow: "#fff6ee", ink: "#5b2b2e" },
] as const

function seedToInt(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return h >>> 0
}

function randomFrom(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexToRgb(hex: string) {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255] as const
}

function relativeLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex)
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** "nx" → "NX", "juri-pkb" → "JP", "PDF exporter" → "PE" */
function initialsFrom(name: string) {
  const words = name.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (words.length === 0) return "??"
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase()
  return words[0].slice(0, 2).toUpperCase().padEnd(2, words[0][0].toUpperCase())
}

type Blob = {
  color: string
  x: number
  y: number
  size: number
  driftX: number
  driftY: number
  duration: number
}

function buildOrb(seed: string) {
  const random = randomFrom(seedToInt(seed))
  const palette = PALETTES[Math.floor(random() * PALETTES.length)]

  const blobs: Blob[] = palette.colors.map((color, i) => ({
    color,
    x: 18 + random() * 64,
    y: 18 + random() * 64,
    size: 62 + random() * 44,
    driftX: (random() - 0.5) * 0.3,
    driftY: (random() - 0.5) * 0.3,
    duration: 8 + i * 2 + random() * 6,
  }))

  const glow = { x: 24 + random() * 44, y: 20 + random() * 40 }
  // Rotating every colour by the same amount keeps the palette in harmony while
  // still separating two projects that landed on the same one.
  const hueShift = Math.round((random() - 0.5) * 32)

  const swatches = [palette.base, ...palette.colors, palette.glow, palette.glow]
  const luminance =
    swatches.reduce((sum, hex) => sum + relativeLuminance(hex), 0) / swatches.length
  const inkLuminance = relativeLuminance(palette.ink)
  const preferInk = contrastRatio(luminance, inkLuminance) >= contrastRatio(luminance, 1)

  return {
    base: palette.base,
    glowColor: palette.glow,
    blobs,
    glow,
    hueShift,
    foreground: preferInk ? palette.ink : "#ffffff",
    textShadow: preferInk
      ? "0 1px 0 rgba(255,255,255,0.55)"
      : "0 1px 2px rgba(20,20,50,0.4)",
  }
}

function CloudOrb({
  name,
  label,
  seed,
  size = 28,
  animated = true,
  className,
  style,
  ...props
}: {
  name: string
  label?: string
  seed?: string
  size?: number
  animated?: boolean
} & Omit<React.ComponentProps<"span">, "children">) {
  const orb = React.useMemo(() => buildOrb(seed ?? name), [seed, name])
  const reduceMotion = useReducedMotion()
  const drifting = animated && !reduceMotion

  return (
    <span
      data-slot="cloud-orb"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        className
      )}
      style={{
        width: size,
        height: size,
        // WKWebView does not clip a filtered child to the parent's border-radius,
        // so the blurred blob layer escapes and the orb renders square. clip-path
        // holds on a composited layer where overflow + radius does not.
        clipPath: "circle(50%)",
        background: orb.base,
        boxShadow:
          "inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -3px 6px rgba(60,54,110,0.16), 0 1px 2px rgba(24,22,60,0.14)",
        ...style,
      }}
      {...props}
    >
      <span
        aria-hidden
        className="absolute inset-[-30%]"
        style={{
          filter: `blur(${Math.max(3, size * 0.15)}px) hue-rotate(${orb.hueShift}deg) saturate(1.05)`,
        }}
      >
        {orb.blobs.map((blob, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${blob.x}%`,
              top: `${blob.y}%`,
              width: `${blob.size}%`,
              height: `${blob.size}%`,
              translate: "-50% -50%",
              background: blob.color,
              opacity: 0.78,
            }}
            animate={
              drifting
                ? { x: [0, blob.driftX * size, 0], y: [0, blob.driftY * size, 0] }
                : undefined
            }
            transition={{ duration: blob.duration, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
        <motion.span
          className="absolute rounded-full"
          style={{
            left: `${orb.glow.x}%`,
            top: `${orb.glow.y}%`,
            width: "62%",
            height: "62%",
            translate: "-50% -50%",
            background: `radial-gradient(circle, ${orb.glowColor} 0%, ${orb.glowColor}00 70%)`,
          }}
          animate={drifting ? { scale: [1, 1.14, 1], opacity: [0.85, 1, 0.85] } : undefined}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>

      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(56% 46% at 30% 20%, rgba(255,255,255,0.6), transparent 68%)",
        }}
      />

      <span
        className="relative font-semibold uppercase leading-none"
        style={{
          fontSize: Math.round(size * 0.36),
          letterSpacing: "-0.02em",
          color: orb.foreground,
          textShadow: orb.textShadow,
        }}
      >
        {label ?? initialsFrom(name)}
      </span>
    </span>
  )
}

export { CloudOrb }
