import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import type { Group } from 'three'

type BallDecal = 'none' | 'straps' | 'double-band' | 'm-mark'

type BallVariant = {
  top: string
  seam: string
  ring: string
  button: string
  bottom?: string
  opacity?: number
  decal?: BallDecal
}

type BallConfig = {
  position: [number, number, number]
  scale: number
  speed: number
  variant: BallVariant
}

const PALETTE = {
  cream: '#f5efe1',
  coral: '#e49a6f',
  coralDeep: '#d78257',
  aqua: '#8bcfcd',
  lilac: '#b89dce',
  violet: '#b296cf',
  mocha: '#4f3c37',
  gold: '#d8b45d',
  sand: '#d5bd8a',
}

function BallDetails({ decal, color, opacity }: { decal: BallDecal; color: string; opacity: number }) {
  if (decal === 'straps') {
    return (
      <>
        <mesh position={[0.35, 0.56, 0.58]} rotation={[0.35, -0.6, -0.38]}>
          <boxGeometry args={[0.68, 0.16, 0.12]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
        <mesh position={[-0.34, 0.42, 0.68]} rotation={[-0.28, 0.5, 0.2]}>
          <boxGeometry args={[0.62, 0.14, 0.12]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
      </>
    )
  }

  if (decal === 'double-band') {
    return (
      <>
        <mesh position={[0, 0.58, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.54, 0.045, 4, 12]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.7, 0.045, 4, 12]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
      </>
    )
  }

  if (decal === 'm-mark') {
    return (
      <>
        <mesh position={[-0.3, 0.58, 0.72]} rotation={[0.1, 0, 0.18]}>
          <boxGeometry args={[0.1, 0.4, 0.08]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
        <mesh position={[-0.06, 0.62, 0.72]} rotation={[0.1, 0, -0.35]}>
          <boxGeometry args={[0.1, 0.3, 0.08]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
        <mesh position={[0.16, 0.62, 0.72]} rotation={[0.1, 0, 0.35]}>
          <boxGeometry args={[0.1, 0.3, 0.08]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
        <mesh position={[0.38, 0.58, 0.72]} rotation={[0.1, 0, -0.18]}>
          <boxGeometry args={[0.1, 0.4, 0.08]} />
          <meshStandardMaterial color={color} flatShading transparent opacity={opacity} />
        </mesh>
      </>
    )
  }

  return null
}

function LowPolyBall({ position, scale, speed, variant }: BallConfig) {
  const ref = useRef<Group>(null!)
  const opacity = variant.opacity ?? 0.38

  useFrame((_, delta) => {
    ref.current.rotation.y += delta * speed
    ref.current.rotation.x += delta * speed * 0.35
  })

  return (
    <Float speed={1.2 + speed * 2} rotationIntensity={0.12} floatIntensity={0.65}>
      <group ref={ref} position={position} scale={scale}>
        <mesh>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color={variant.bottom ?? PALETTE.cream} flatShading transparent opacity={opacity} />
        </mesh>

        <mesh>
          <sphereGeometry args={[1.001, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={variant.top} flatShading transparent opacity={opacity} />
        </mesh>

        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.06, 4, 16]} />
          <meshStandardMaterial color={variant.seam} flatShading transparent opacity={opacity} />
        </mesh>

        <mesh position={[0, 0, 1.01]}>
          <cylinderGeometry args={[0.2, 0.2, 0.08, 8, 1]} />
          <meshStandardMaterial color={variant.ring} flatShading transparent opacity={opacity} />
        </mesh>

        <mesh position={[0, 0, 1.07]}>
          <cylinderGeometry args={[0.11, 0.11, 0.08, 8, 1]} />
          <meshStandardMaterial color={variant.button} flatShading transparent opacity={opacity} />
        </mesh>

        <BallDetails decal={variant.decal ?? 'none'} color={variant.seam} opacity={opacity} />
      </group>
    </Float>
  )
}

function Scene() {
  const balls = useMemo<BallConfig[]>(() => [
    {
      position: [-7.1, 3.6, -4.2],
      scale: 0.9,
      speed: 0.1,
      variant: { top: PALETTE.coral, seam: PALETTE.coralDeep, ring: PALETTE.coralDeep, button: PALETTE.cream }
    },
    {
      position: [7.8, -1.7, -4.9],
      scale: 0.95,
      speed: 0.14,
      variant: { top: PALETTE.aqua, seam: PALETTE.lilac, ring: PALETTE.lilac, button: PALETTE.cream, decal: 'straps' }
    },
    {
      position: [-5.7, -4.2, -5.8],
      scale: 0.82,
      speed: 0.12,
      variant: { top: PALETTE.violet, seam: PALETTE.lilac, ring: PALETTE.lilac, button: PALETTE.cream, decal: 'm-mark' }
    },
    {
      position: [5.9, 4.4, -6.8],
      scale: 0.72,
      speed: 0.09,
      variant: { top: PALETTE.gold, seam: PALETTE.sand, ring: PALETTE.sand, button: PALETTE.cream }
    },
    {
      position: [0.6, 5.3, -7.5],
      scale: 0.7,
      speed: 0.08,
      variant: { top: '#efe2cb', seam: PALETTE.sand, ring: PALETTE.sand, button: PALETTE.cream }
    },
    {
      position: [-8.4, 0.9, -6.9],
      scale: 0.68,
      speed: 0.11,
      variant: { top: PALETTE.mocha, seam: '#b07c5b', ring: '#b07c5b', button: '#edd6b5', decal: 'double-band' }
    },
    {
      position: [4.9, -4.7, -6.3],
      scale: 0.76,
      speed: 0.1,
      variant: { top: PALETTE.gold, seam: '#d8c187', ring: '#d8c187', button: PALETTE.cream }
    },
    {
      position: [1.4, -5.3, -5.2],
      scale: 0.64,
      speed: 0.13,
      variant: { top: '#ebdcc3', seam: PALETTE.sand, ring: PALETTE.sand, button: PALETTE.cream }
    },
  ], [])

  return (
    <>
      <ambientLight intensity={0.45} color="#ffeedd" />
      <directionalLight position={[5, 6, 4]} intensity={1.0} color="#ffe8d0" />
      <directionalLight position={[-3, -4, 3]} intensity={0.3} color="#7ec4c4" />
      <directionalLight position={[-5, 3, -2]} intensity={0.2} color="#b8a4c8" />

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
