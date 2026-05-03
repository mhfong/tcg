import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import type { Mesh } from 'three'

const PALETTE = {
  coral: '#e08860',
  peach: '#e8b4a0',
  lavender: '#b8a4c8',
  lilac: '#c8b4d8',
  teal: '#7ec4c4',
  mint: '#a8d8c8',
  sand: '#d4c898',
  rose: '#d4a0a0',
  cream: '#ede0cc',
  stone: '#b8a898',
}

function LowPolyGem({ position, color, scale = 1, speed = 0.15 }: {
  position: [number, number, number]
  color: string
  scale?: number
  speed?: number
}) {
  const ref = useRef<Mesh>(null!)
  useFrame((_, delta) => {
    ref.current.rotation.x += delta * speed
    ref.current.rotation.y += delta * speed * 1.3
  })

  return (
    <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.6}>
      <mesh ref={ref} position={position} scale={scale}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={color} flatShading transparent opacity={0.35} />
      </mesh>
    </Float>
  )
}

function LowPolyOcta({ position, color, scale = 1, speed = 0.1 }: {
  position: [number, number, number]
  color: string
  scale?: number
  speed?: number
}) {
  const ref = useRef<Mesh>(null!)
  useFrame((_, delta) => {
    ref.current.rotation.z += delta * speed
    ref.current.rotation.x += delta * speed * 0.8
  })

  return (
    <Float speed={1.8} rotationIntensity={0.4} floatIntensity={0.8}>
      <mesh ref={ref} position={position} scale={scale}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={color} flatShading transparent opacity={0.3} />
      </mesh>
    </Float>
  )
}

function LowPolyTetra({ position, color, scale = 1 }: {
  position: [number, number, number]
  color: string
  scale?: number
}) {
  const ref = useRef<Mesh>(null!)
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.08
  })

  return (
    <Float speed={1} rotationIntensity={0.2} floatIntensity={0.5}>
      <mesh ref={ref} position={position} scale={scale}>
        <tetrahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={color} flatShading transparent opacity={0.25} />
      </mesh>
    </Float>
  )
}

function LowPolyDodec({ position, color, scale = 1 }: {
  position: [number, number, number]
  color: string
  scale?: number
}) {
  const ref = useRef<Mesh>(null!)
  useFrame((_, delta) => {
    ref.current.rotation.x += delta * 0.06
    ref.current.rotation.z += delta * 0.04
  })

  return (
    <Float speed={0.8} rotationIntensity={0.15} floatIntensity={0.4}>
      <mesh ref={ref} position={position} scale={scale}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={color} flatShading transparent opacity={0.22} />
      </mesh>
    </Float>
  )
}

function Scene() {
  const shapes = useMemo(() => [
    { Comp: LowPolyGem, pos: [-7, 3.5, -3] as [number, number, number], color: PALETTE.coral, scale: 0.7 },
    { Comp: LowPolyGem, pos: [8, -2, -4] as [number, number, number], color: PALETTE.peach, scale: 1.0 },
    { Comp: LowPolyGem, pos: [-5, -4, -5] as [number, number, number], color: PALETTE.lavender, scale: 0.5 },
    { Comp: LowPolyGem, pos: [6, 4, -6] as [number, number, number], color: PALETTE.sand, scale: 0.4 },
    { Comp: LowPolyGem, pos: [0, -5, -3] as [number, number, number], color: PALETTE.rose, scale: 0.6 },

    { Comp: LowPolyOcta, pos: [7, 2, -3] as [number, number, number], color: PALETTE.teal, scale: 0.6 },
    { Comp: LowPolyOcta, pos: [-6, -1, -4] as [number, number, number], color: PALETTE.mint, scale: 0.8 },
    { Comp: LowPolyOcta, pos: [3, 5, -7] as [number, number, number], color: PALETTE.lilac, scale: 0.35 },
    { Comp: LowPolyOcta, pos: [-3, 4, -5] as [number, number, number], color: PALETTE.cream, scale: 0.5 },

    { Comp: LowPolyTetra, pos: [5, -4, -5] as [number, number, number], color: PALETTE.coral, scale: 0.45 },
    { Comp: LowPolyTetra, pos: [-8, 1, -6] as [number, number, number], color: PALETTE.stone, scale: 0.55 },
    { Comp: LowPolyTetra, pos: [2, 3, -4] as [number, number, number], color: PALETTE.sand, scale: 0.3 },

    { Comp: LowPolyDodec, pos: [-4, 5, -8] as [number, number, number], color: PALETTE.peach, scale: 0.7 },
    { Comp: LowPolyDodec, pos: [9, 0, -7] as [number, number, number], color: PALETTE.lavender, scale: 0.6 },
  ], [])

  return (
    <>
      <ambientLight intensity={0.45} color="#ffeedd" />
      <directionalLight position={[5, 6, 4]} intensity={1.0} color="#ffe8d0" />
      <directionalLight position={[-3, -4, 3]} intensity={0.3} color="#7ec4c4" />
      <directionalLight position={[-5, 3, -2]} intensity={0.2} color="#b8a4c8" />

      {shapes.map((s, i) => (
        <s.Comp key={i} position={s.pos} color={s.color} scale={s.scale} />
      ))}
    </>
  )
}

export default function LowPolyBackground() {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: 0
    }}>
      <Canvas camera={{ position: [0, 0, 10], fov: 60 }}>
        <Scene />
      </Canvas>
    </div>
  )
}
