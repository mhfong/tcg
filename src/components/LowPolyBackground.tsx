import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import type { Group } from 'three'

type BallKind = 'poke' | 'great' | 'ultra' | 'master' | 'dusk' | 'quick'

type BallPalette = {
  top: string
  bottom: string
  seam: string
  ring: string
  button: string
  accent?: string
  accentSoft?: string
}

type BallConfig = {
  position: [number, number, number]
  scale: number
  speed: number
  kind: BallKind
  startRotation?: [number, number, number]
}

const HALF_PI = Math.PI / 2

const BALLS: Record<BallKind, BallPalette> = {
  poke: {
    top: '#d88879',
    bottom: '#f2e8d9',
    seam: '#4a3f38',
    ring: '#2f2a29',
    button: '#f7f0e4',
  },
  great: {
    top: '#7c9fd1',
    bottom: '#f3e9db',
    seam: '#3f3a39',
    ring: '#2f2a29',
    button: '#f6eee1',
    accent: '#cf776f',
  },
  ultra: {
    top: '#423b37',
    bottom: '#f3eadc',
    seam: '#262323',
    ring: '#1f1d1d',
    button: '#f5ecdf',
    accent: '#ccb15f',
  },
  master: {
    top: '#ae88c8',
    bottom: '#f3e9db',
    seam: '#4c3f52',
    ring: '#352f3a',
    button: '#f6eee2',
    accent: '#efe1f6',
    accentSoft: '#c8abd8',
  },
  dusk: {
    top: '#473a34',
    bottom: '#e6caa1',
    seam: '#2b2421',
    ring: '#c39e58',
    button: '#d6b46f',
    accent: '#b8924f',
  },
  quick: {
    top: '#d5b86d',
    bottom: '#f1e7d8',
    seam: '#5f4f31',
    ring: '#8f7648',
    button: '#f7eee0',
    accent: '#c89f52',
  },
}

function BallMarkings({ kind, palette }: { kind: BallKind; palette: BallPalette }) {
  if (kind === 'great') {
    return (
      <>
        <mesh position={[-0.45, 0.5, 0.6]} rotation={[0.2, 0.34, 0.72]}>
          <boxGeometry args={[0.68, 0.16, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[0.45, 0.5, 0.6]} rotation={[0.2, -0.34, -0.72]}>
          <boxGeometry args={[0.68, 0.16, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[-0.45, 0.5, -0.6]} rotation={[-0.2, -0.34, -0.72]}>
          <boxGeometry args={[0.68, 0.16, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[0.45, 0.5, -0.6]} rotation={[-0.2, 0.34, 0.72]}>
          <boxGeometry args={[0.68, 0.16, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
      </>
    )
  }

  if (kind === 'ultra') {
    return (
      <>
        <mesh position={[0, 0.48, 0]}>
          <boxGeometry args={[0.24, 0.92, 1.28]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[0.63, 0.35, 0]} rotation={[0, 0, 0.22]}>
          <boxGeometry args={[0.21, 0.74, 1.02]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[-0.63, 0.35, 0]} rotation={[0, 0, -0.22]}>
          <boxGeometry args={[0.21, 0.74, 1.02]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
      </>
    )
  }

  if (kind === 'master') {
    return (
      <>
        <mesh position={[0.62, 0.57, 0.18]} rotation={[0.32, 0.18, 0.26]}>
          <boxGeometry args={[0.35, 0.24, 0.2]} />
          <meshStandardMaterial color={palette.accentSoft!} flatShading />
        </mesh>
        <mesh position={[-0.62, 0.57, 0.18]} rotation={[0.32, -0.18, -0.26]}>
          <boxGeometry args={[0.35, 0.24, 0.2]} />
          <meshStandardMaterial color={palette.accentSoft!} flatShading />
        </mesh>

        <mesh position={[-0.3, 0.6, 0.72]} rotation={[0.1, 0, 0.16]}>
          <boxGeometry args={[0.09, 0.36, 0.08]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[-0.08, 0.63, 0.72]} rotation={[0.1, 0, -0.34]}>
          <boxGeometry args={[0.09, 0.28, 0.08]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[0.12, 0.63, 0.72]} rotation={[0.1, 0, 0.34]}>
          <boxGeometry args={[0.09, 0.28, 0.08]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[0.34, 0.6, 0.72]} rotation={[0.1, 0, -0.16]}>
          <boxGeometry args={[0.09, 0.36, 0.08]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
      </>
    )
  }

  if (kind === 'dusk') {
    return (
      <>
        <mesh position={[0, 0.58, 0]} rotation={[HALF_PI, 0, 0]}>
          <torusGeometry args={[0.82, 0.05, 4, 16]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[0, 0.34, 0]} rotation={[HALF_PI, 0, 0]}>
          <torusGeometry args={[0.94, 0.05, 4, 16]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
      </>
    )
  }

  if (kind === 'quick') {
    return (
      <>
        <mesh position={[0.55, 0.45, 0.62]} rotation={[0.12, 0.2, -0.24]}>
          <boxGeometry args={[0.2, 0.66, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[-0.55, 0.45, 0.62]} rotation={[0.12, -0.2, 0.24]}>
          <boxGeometry args={[0.2, 0.66, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[0.55, 0.45, -0.62]} rotation={[-0.12, -0.2, 0.24]}>
          <boxGeometry args={[0.2, 0.66, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
        <mesh position={[-0.55, 0.45, -0.62]} rotation={[-0.12, 0.2, -0.24]}>
          <boxGeometry args={[0.2, 0.66, 0.1]} />
          <meshStandardMaterial color={palette.accent!} flatShading />
        </mesh>
      </>
    )
  }

  return null
}

function LowPolyBall({ position, scale, speed, kind, startRotation = [0, 0, 0] }: BallConfig) {
  const ref = useRef<Group>(null!)
  const phase = useMemo(() => Math.random() * Math.PI * 2, [])
  const palette = BALLS[kind]

  useFrame((state, delta) => {
    ref.current.rotation.y += delta * speed
    ref.current.rotation.x = startRotation[0] + Math.sin(state.clock.elapsedTime * 0.22 + phase) * 0.08
    ref.current.rotation.z = startRotation[2] + Math.sin(state.clock.elapsedTime * 0.17 + phase) * 0.05
  })

  return (
    <Float speed={1 + speed * 1.5} rotationIntensity={0.08} floatIntensity={0.55}>
      <group ref={ref} position={position} scale={scale}>
        <mesh>
          <sphereGeometry args={[1, 12, 8, 0, Math.PI * 2, 0, HALF_PI]} />
          <meshStandardMaterial color={palette.top} flatShading />
        </mesh>

        <mesh>
          <sphereGeometry args={[1, 12, 8, 0, Math.PI * 2, HALF_PI, HALF_PI]} />
          <meshStandardMaterial color={palette.bottom} flatShading />
        </mesh>

        <mesh rotation={[HALF_PI, 0, 0]}>
          <torusGeometry args={[1, 0.055, 4, 16]} />
          <meshStandardMaterial color={palette.seam} flatShading />
        </mesh>

        <mesh position={[0, 0, 1.02]}>
          <cylinderGeometry args={[0.22, 0.22, 0.09, 8]} />
          <meshStandardMaterial color={palette.ring} flatShading />
        </mesh>
        <mesh position={[0, 0, 1.08]}>
          <cylinderGeometry args={[0.12, 0.12, 0.09, 8]} />
          <meshStandardMaterial color={palette.button} flatShading />
        </mesh>

        <BallMarkings kind={kind} palette={palette} />
      </group>
    </Float>
  )
}

function Scene() {
  const balls = useMemo<BallConfig[]>(() => [
    { kind: 'poke', position: [-7.2, 3.5, -4.6], scale: 0.9, speed: 0.1, startRotation: [0.08, 0.5, 0] },
    { kind: 'great', position: [7.6, -1.7, -5.2], scale: 0.95, speed: 0.13, startRotation: [0.1, 1.2, 0] },
    { kind: 'ultra', position: [-5.8, -4.25, -6.0], scale: 0.82, speed: 0.12, startRotation: [0.02, 2.1, 0] },
    { kind: 'master', position: [5.9, 4.4, -6.9], scale: 0.78, speed: 0.09, startRotation: [0.06, -0.6, 0] },
    { kind: 'dusk', position: [-8.5, 0.8, -7.2], scale: 0.7, speed: 0.11, startRotation: [0.05, 0.9, 0] },
    { kind: 'quick', position: [4.9, -4.8, -6.4], scale: 0.76, speed: 0.1, startRotation: [0.04, -1.5, 0] },
    { kind: 'poke', position: [0.7, 5.2, -7.5], scale: 0.68, speed: 0.08, startRotation: [0.05, 1.8, 0] },
    { kind: 'great', position: [1.5, -5.4, -5.3], scale: 0.64, speed: 0.12, startRotation: [0.03, -2.4, 0] },
  ], [])

  return (
    <>
      <ambientLight intensity={0.5} color="#ffeedd" />
      <directionalLight position={[5, 6, 4]} intensity={1.0} color="#ffe8d0" />
      <directionalLight position={[-3, -4, 3]} intensity={0.26} color="#7ec4c4" />
      <directionalLight position={[-5, 3, -2]} intensity={0.22} color="#b8a4c8" />

      {balls.map((ball, i) => (
        <LowPolyBall key={i} {...ball} />
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
