import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import type { Mesh } from 'three'

function LowPolyShape({ position, color, scale = 1 }: {
  position: [number, number, number]
  color: string
  scale?: number
}) {
  const ref = useRef<Mesh>(null!)
  useFrame((_, delta) => {
    ref.current.rotation.x += delta * 0.15
    ref.current.rotation.y += delta * 0.2
  })

  return (
    <Float speed={1.5} rotationIntensity={0.3} floatIntensity={0.8}>
      <mesh ref={ref} position={position} scale={scale}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={color} flatShading={true} transparent opacity={0.6} />
      </mesh>
    </Float>
  )
}

function LowPolyOcta({ position, color, scale = 1 }: {
  position: [number, number, number]
  color: string
  scale?: number
}) {
  const ref = useRef<Mesh>(null!)
  useFrame((_, delta) => {
    ref.current.rotation.z += delta * 0.12
    ref.current.rotation.x += delta * 0.1
  })

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={1}>
      <mesh ref={ref} position={position} scale={scale}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={color} flatShading={true} transparent opacity={0.4} />
      </mesh>
    </Float>
  )
}

export default function LowPolyBackground() {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: 0
    }}>
      <Canvas camera={{ position: [0, 0, 10], fov: 60 }}>
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <directionalLight position={[-3, -3, 2]} intensity={0.4} color="#4fc3f7" />

        <LowPolyShape position={[-6, 3, -2]} color="#4fc3f7" scale={0.8} />
        <LowPolyShape position={[7, -2, -3]} color="#29b6f6" scale={1.2} />
        <LowPolyShape position={[-4, -4, -4]} color="#0288d1" scale={0.6} />
        <LowPolyShape position={[5, 4, -5]} color="#81d4fa" scale={0.5} />

        <LowPolyOcta position={[6, 2, -2]} color="#4fc3f7" scale={0.7} />
        <LowPolyOcta position={[-5, -1, -3]} color="#29b6f6" scale={0.9} />
        <LowPolyOcta position={[0, 5, -6]} color="#0288d1" scale={0.4} />
        <LowPolyOcta position={[-2, 3, -4]} color="#b3e5fc" scale={0.3} />
      </Canvas>
    </div>
  )
}
