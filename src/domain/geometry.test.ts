import { describe, expect, it } from 'vitest'
import { RACK_HALF_DEPTH_MM } from './models'

// Measured on the meshes — see the comment on RACK_DEPTH_MM.
const WIDTH_RAIL_DEPTH = 54.85
const POST_DEPTH = 35
const SOCKET_WALL_FROM_CENTRE = 6.5
const HOLE_FROM_CENTRE = 5
const BRACE_LENGTH = 217.7
const BRACE_HOLE_SPAN = 194.9
const DEPTH_RAIL_LENGTH = 170

const postCentre = RACK_HALF_DEPTH_MM + WIDTH_RAIL_DEPTH / 2 - POST_DEPTH / 2

describe('rack depth matches the parts that span it', () => {
  it('socket back walls are one long brace apart', () => {
    expect(Math.abs(2 * (postCentre + SOCKET_WALL_FROM_CENTRE) - BRACE_LENGTH)).toBeLessThan(0.3)
  })
  it('insert holes line up with the brace holes', () => {
    expect(Math.abs(2 * (postCentre - HOLE_FROM_CENTRE) - BRACE_HOLE_SPAN)).toBeLessThan(0.3)
  })
  it('the depth rail spans the posts’ inner faces', () => {
    expect(Math.abs(2 * (postCentre - POST_DEPTH / 2) - DEPTH_RAIL_LENGTH)).toBeLessThan(0.3)
  })
})
