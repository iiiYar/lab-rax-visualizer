import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useLoader } from '@react-three/fiber'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js'
import type { CustomShelf } from '../../domain/custom-shelves'
import { useCustomShelves } from '../../store/use-custom-shelves'
import {
  firstMeshGeometry,
  prepareGeometry,
  type PreparedGeometry,
} from './materials/use-model-geometry'

const DEG = Math.PI / 180
/** Served by the API, so these are absolute paths like MODEL_BASE. */
const SHELF_FILE_BASE = '/api/shelves/files/'

interface Props {
  /** Catalog id of the shelf (`custom-…`). */
  id: string
  /** Gets the baked geometry, so the caller places it like a builtin shelf. */
  render: (geo: PreparedGeometry) => ReactNode
}

/**
 * Draws an owner-uploaded shelf. Renders nothing while the catalog does not
 * have the id (not loaded yet, or deleted). Wrap in a Suspense: the file loads
 * through useLoader.
 */
export function CustomShelfMesh({ id, render }: Props) {
  const shelf = useCustomShelves((s) => s.shelves.find((c) => c.id === id))
  if (!shelf) return null
  return shelf.file.endsWith('.3mf') ? (
    <Custom3mfShelf shelf={shelf} render={render} />
  ) : (
    <CustomStlShelf shelf={shelf} render={render} />
  )
}

function CustomStlShelf({ shelf, render }: { shelf: CustomShelf; render: Props['render'] }) {
  const raw = useLoader(STLLoader, SHELF_FILE_BASE + shelf.file)
  const geo = useMemo(
    () => prepareGeometry(raw.clone(), shelf.rotY * DEG, shelf.rotX * DEG, shelf.rotZ * DEG),
    [raw, shelf.rotX, shelf.rotY, shelf.rotZ],
  )
  return <>{render(geo)}</>
}

function Custom3mfShelf({ shelf, render }: { shelf: CustomShelf; render: Props['render'] }) {
  const group = useLoader(ThreeMFLoader, SHELF_FILE_BASE + shelf.file)
  const geo = useMemo(
    () => prepareGeometry(firstMeshGeometry(group), shelf.rotY * DEG, shelf.rotX * DEG, shelf.rotZ * DEG),
    [group, shelf.rotX, shelf.rotY, shelf.rotZ],
  )
  return <>{render(geo)}</>
}
