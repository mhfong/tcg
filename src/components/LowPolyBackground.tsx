import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import { DoubleSide } from 'three'
import type { Group } from 'three'

/*
 * Six pokéball variants with warm-pastel palettes.
 * Uses a fully closed icosahedron as base (bottom colour) so
 * the mesh is always solid from every angle, then overlays the
 * top-cap hemisphere with DoubleSide rendering.
 */

type BallKind = 'poke' | 'great' | 'ultra' | 'master' | 'dusk' | 'quick'

interface BallPalette {
  top: string
  bottom: string
  seam: string
  ring: string
  button: string
  accent?: string
  accentSoft?: string
}

interface BallConfig {
  position: [number, number, number]
  scale: number
  speed: number
  kind: BallKind
  startRotation?: [number, number, number]
}

const HP = Math.PI / 2
const TAU = Math.PI * 2

const BALLS: Record<BallKind, BallPalette> = {
  poke: {
    top: '#d88879',
    bottom: '#f2e8d9',
    seam: '#4a3f38',
    ring: '#3a3230',
    button: '#f7f0e4',
  },
  great: {
    top: '#7c9fd1',
    bottom: '#f3e9db',
    seam: '#3f3a39',
    ring: '#352f2e',
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
    ring: '#3d3342',
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

/* ─── Per-variant markings (all DoubleSide for clean rotation) ─── */

function GreatMarkings({ color }: { color: string }) {
  const s = [0.62, 0.14, 0.1] as [number, number, number]
  return (
    <>
      <mesh position={[-0.42, 0.52, 0.6]} rotation={[0.2, 0.3, 0.7]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[0.42, 0.52, 0.6]} rotation={[0.2, -0.3, -0.7]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[-0.42, 0.52, -0.6]} rotation={[-0.2, -0.3, -0.7]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[0.42, 0.52, -0.6]} rotation={[-0.2, 0.3, 0.7]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
    </>
  )
}

function UltraMarkings({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.22, 0.88, 1.24]} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[0.58, 0.38, 0]} rotation={[0, 0, 0.2]}>
        <boxGeometry args={[0.18, 0.72, 0.98]} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[-0.58, 0.38, 0]} rotation={[0, 0, -0.2]}>
        <boxGeometry args={[0.18, 0.72, 0.98]} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
    </>
  )
}

function MasterMarkings({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  return (
    <>
      <mesh position={[0.62, 0.55, 0]} rotation={[0, 0, 0.24]}>
        <boxGeometry args={[0.32, 0.22, 0.38]} />
        <meshStandardMaterial color={accentSoft} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[-0.62, 0.55, 0]} rotation={[0, 0, -0.24]}>
        <boxGeometry args={[0.32, 0.22, 0.38]} />
        <meshStandardMaterial color={accentSoft} flatShading side={DoubleSide} />
      </mesh>
      {[[-0.26, 0.16], [-0.06, -0.34], [0.12, 0.34], [0.3, -0.16]].map(([x, rot], i) => (
        <mesh key={i} position={[x, 0.6, 0.74]} rotation={[0.08, 0, rot]}>
          <boxGeometry args={[0.08, 0.32, 0.07]} />
          <meshStandardMaterial color={accent} flatShading side={DoubleSide} />
        </mesh>
      ))}
    </>
  )
}

function DuskMarkings({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 0.56, 0]} rotation={[HP, 0, 0]}>
        <torusGeometry args={[0.82, 0.048, 4, 16]} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.36, 0]} rotation={[HP, 0, 0]}>
        <torusGeometry args={[0.93, 0.048, 4, 16]} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
    </>
  )
}

function QuickMarkings({ color }: { color: string }) {
  const s = [0.18, 0.62, 0.09] as [number, number, number]
  return (
    <>
      <mesh position={[0.52, 0.46, 0.6]} rotation={[0.1, 0.18, -0.22]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[-0.52, 0.46, 0.6]} rotation={[0.1, -0.18, 0.22]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[0.52, 0.46, -0.6]} rotation={[-0.1, -0.18, 0.22]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
      <mesh position={[-0.52, 0.46, -0.6]} rotation={[-0.1, 0.18, -0.22]}>
        <boxGeometry args={s} />
        <meshStandardMaterial color={color} flatShading side={DoubleSide} />
      </mesh>
    </>
  )
}

/* ─── Main ball component ─── */

function LowPolyBall({ position, scale, speed, kind, startRotation = [0, 0, 0] }: BallConfig) {
  const ref = useRef<Group>(null!)
  const phase = useMemo(() => Math.random() * TAU, [])
  const p = BALLS[kind]

  useFrame((state, delta) => {
    ref.current.rotation.y += delta * speed
    ref.current.rotation.x = startRotation[0] + Math.sin(state.clock.elapsedTime * 0.22 + phase) * 0.06
    ref.current.rotation.z = startRotation[2] + Math.sin(state.clock.elapsedTime * 0.17 + phase) * 0.04
  })

  return (
    <Float speed={1 + speed * 1.5} rotationIntensity={0.06} floatIntensity={0.5}>
      <group ref={ref} position={position} scale={scale}>
        {/* 1 ─ Fully closed base sphere (bottom colour) — always solid from every angle */}
        <mesh>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={p.bottom} flatShading />
        </mesh>

        {/* 2 ─ Top-cap hemisphere overlay (top colour, DoubleSide so visible inside-out) */}
        <mesh>
          <sphereGeometry args={[1.003, 14, 8, 0, TAU, 0, HP]} />
          <meshStandardMaterial color={p.top} flatShading side={DoubleSide} />
        </mesh>

        {/* 3 ─ Equator band */}
        <mesh rotation={[HP, 0, 0]}>
          <torusGeometry args={[1.006, 0.05, 4, 18]} />
          <meshStandardMaterial color={p.seam} flatShading side={DoubleSide} />
        </mesh>

        {/* 4 ─ Button ring (rotated to face +Z) */}
        <mesh position={[0, 0, 1.02]} rotation={[HP, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.1, 8]} />
          <meshStandardMaterial color={p.ring} flatShading side={DoubleSide} />
        </mesh>

        {/* 5 ─ Button centre */}
        <mesh position={[0, 0, 1.08]} rotation={[HP, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.1, 8]} />
          <meshStandardMaterial color={p.button} flatShading side={DoubleSide} />
        </mesh>

        {/* 6 ─ Per-variant markings */}
        {kind === 'great' && <GreatMarkings color={p.accent!} />}
        {kind === 'ultra' && <UltraMarkings color={p.accent!} />}
        {kind === 'master' && <MasterMarkings accent={p.accent!} accentSoft={p.accentSoft!} />}
        {kind === 'dusk' && <DuskMarkings color={p.accent!} />}
        {kind === 'quick' && <QuickMarkings color={p.accent!} />}
      </group>
    </Float>
  )
}

/* ─── Scene ─── */

function Scene() {
  const balls = useMemo<BallConfig[]>(() => [
    { kind: 'poke',   position: [-7.2,  3.5,  -4.6], scale: 0.9,  speed: 0.1,  startRotation: [0.08, 0.5, 0] },
    { kind: 'great',  position: [ 7.6, -1.7,  -5.2], scale: 0.95, speed: 0.13, startRotation: [0.1, 1.2, 0] },
    { kind: 'ultra',  position: [-5.8, -4.25, -6.0], scale: 0.82, speed: 0.12, startRotation: [0.02, 2.1, 0] },
    { kind: 'master', position: [ 5.9,  4.4,  -6.9], scale: 0.78, speed: 0.09, startRotation: [0.06, -0.6, 0] },
    { kind: 'dusk',   position: [-8.5,  0.8,  -7.2], scale: 0.7,  speed: 0.11, startRotation: [0.05, 0.9, 0] },
    { kind: 'quick',  position: [ 4.9, -4.8,  -6.4], scale: 0.76, speed: 0.1,  startRotation: [0.04, -1.5, 0] },
    { kind: 'poke',   position: [ 0.7,  5.2,  -7.5], scale: 0.68, speed: 0.08, startRotation: [0.05, 1.8, 0] },
    { kind: 'great',  position: [ 1.5, -5.4,  -5.3], scale: 0.64, speed: 0.12, startRotation: [0.03, -2.4, 0] },
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
