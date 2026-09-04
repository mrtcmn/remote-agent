import * as React from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

const HOLD_MS = 2500
const OUT_S = 1.1
const BACK_S = 0.22

function Ellipsis({
  className,
  children,
  style,
  ...props
}: React.ComponentProps<"span">) {
  const boxRef = React.useRef<HTMLSpanElement>(null)
  const probeRef = React.useRef<HTMLSpanElement>(null)
  const holdRef = React.useRef(0)
  const [hovering, setHovering] = React.useState(false)
  const [x, setX] = React.useState(0)
  const [fade, setFade] = React.useState(false)

  const overflow = React.useCallback(() => {
    const box = boxRef.current
    const probe = probeRef.current
    if (!box || !probe) return 0
    return Math.max(0, probe.offsetWidth - box.getBoundingClientRect().width)
  }, [])

  React.useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const host = box.closest("button, [role='button']") ?? box
    const enter = () => setHovering(true)
    const leave = () => setHovering(false)
    host.addEventListener("mouseenter", enter)
    host.addEventListener("mouseleave", leave)
    return () => {
      host.removeEventListener("mouseenter", enter)
      host.removeEventListener("mouseleave", leave)
    }
  }, [])

  React.useEffect(() => {
    if (!hovering) {
      window.clearTimeout(holdRef.current)
      setX(0)
      return
    }

    let started = false
    const start = () => {
      const o = overflow()
      if (o <= 0) return
      started = true
      setFade(true)
      setX(-o)
    }

    const raf = requestAnimationFrame(start)
    const ro = new ResizeObserver(() => {
      if (!started) {
        start()
        return
      }
      setX((cur) => (cur < 0 ? -overflow() : cur))
    })
    if (boxRef.current) ro.observe(boxRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.clearTimeout(holdRef.current)
    }
  }, [hovering, overflow])

  const sliding = x !== 0

  return (
    <span
      ref={boxRef}
      data-slot="ellipsis"
      className={cn("relative block w-full min-w-0 overflow-hidden", className)}
      style={{
        ...style,
        ...(fade
          ? {
              maskImage:
                "linear-gradient(to right, transparent, #000 1.75rem)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent, #000 1.75rem)",
            }
          : null),
      }}
      {...props}
    >
      <span
        ref={probeRef}
        aria-hidden
        className="absolute left-0 top-0 w-max whitespace-nowrap opacity-0 pointer-events-none"
      >
        {children}
      </span>
      <motion.span
        className={cn(
          "block whitespace-nowrap",
          sliding ? "w-max" : "overflow-hidden text-ellipsis"
        )}
        animate={{ x }}
        transition={{
          duration: x === 0 ? BACK_S : OUT_S,
          delay: x === 0 ? 0 : 0.08,
          ease: x === 0 ? [0.16, 1, 0.3, 1] : [0.4, 0, 0.2, 1],
        }}
        onAnimationComplete={() => {
          if (x < 0 && hovering) {
            holdRef.current = window.setTimeout(() => setX(0), HOLD_MS)
            return
          }
          if (x === 0) setFade(false)
        }}
      >
        {children}
      </motion.span>
    </span>
  )
}

export { Ellipsis }
