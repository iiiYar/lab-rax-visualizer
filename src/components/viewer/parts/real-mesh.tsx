import * as THREE from 'three'
import type { PartMaterial } from '../../../domain/types'

interface Props {
  geometry: THREE.BufferGeometry
  color: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  /** [x,y,z] scale — use -1 on an axis to mirror (e.g. left/right feet). */
  scale?: [number, number, number]
  /** 'acrylic' renders a clear, low-roughness panel instead of opaque filament. */
  material?: PartMaterial
  onClick?: (e: THREE.Event) => void
}

/**
 * Renders one instance of a prepared real-part geometry. The default is a flat
 * colored filament material; `acrylic` swaps in a clear, tinted, glossy one
 * (used for side panels cut from acrylic sheet). DoubleSide avoids
 * backface-culling artifacts on mirrored (negative-scale) instances.
 */
export function RealMesh({ geometry, color, position, rotation, scale, material, onClick }: Props) {
  const acrylic = material === 'acrylic'
  return (
    <mesh
      geometry={geometry}
      position={position}
      rotation={rotation}
      scale={scale}
      onClick={onClick}
      castShadow={!acrylic}
      receiveShadow={!acrylic}
    >
      {acrylic ? (
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.32}
          roughness={0.08}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.06}
          ior={1.49}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          roughness={0.55}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      )}
    </mesh>
  )
}
