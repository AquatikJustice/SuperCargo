import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Edges, Text } from '@react-three/drei'
import sairaFont from '@fontsource/saira/files/saira-latin-600-normal.woff?url'
import { CARGO_GRIDS, type CargoGrid } from '@shared/cargoGrids'
import type { ShipMarkup, BayMarkup, BayDir, BayFaceKind } from '@shared/types'

const SHIPS = Object.keys(CARGO_GRIDS).sort()
// box face material index order
const IDX_DIR: BayDir[] = ['x+', 'x-', 'y+', 'y-', 'z+', 'z-']
const FACE_CYCLE: (BayFaceKind | undefined)[] = [undefined, 'exit', 'aisle', 'wall']
const FACE_COLOR: Record<string, string> = { exit: '#2e9d5b', aisle: '#2a78c2', wall: '#586a7d', unset: '#323d4c' }
const colorFor = (k?: BayFaceKind): string => FACE_COLOR[k ?? 'unset']
const nextFace = (k?: BayFaceKind): BayFaceKind | undefined =>
  FACE_CYCLE[(FACE_CYCLE.indexOf(k) + 1) % FACE_CYCLE.length]
const prevFace = (k?: BayFaceKind): BayFaceKind | undefined =>
  FACE_CYCLE[(FACE_CYCLE.indexOf(k) + FACE_CYCLE.length - 1) % FACE_CYCLE.length]

const OPP: Record<BayDir, BayDir> = { 'x+': 'x-', 'x-': 'x+', 'y+': 'y-', 'y-': 'y+', 'z+': 'z-', 'z-': 'z+' }
// starboard from bow, right-hand rule
const STBD_OF: Record<BayDir, BayDir> = { 'z-': 'x+', 'z+': 'x-', 'x+': 'z+', 'x-': 'z-', 'y+': 'x+', 'y-': 'x+' }
// floor-label spin, reads upright
const IN_PLANE: Record<BayDir, number> = { 'z-': Math.PI, 'z+': 0, 'x+': Math.PI / 2, 'x-': -Math.PI / 2, 'y+': 0, 'y-': 0 }
const DIR_VEC: Record<BayDir, [number, number, number]> = {
  'x+': [1, 0, 0], 'x-': [-1, 0, 0], 'y+': [0, 1, 0], 'y-': [0, -1, 0], 'z+': [0, 0, 1], 'z-': [0, 0, -1]
}
// 90deg face remaps per +axis
type Axis = 'x' | 'y' | 'z'
const ROT: Record<Axis, Record<BayDir, BayDir>> = {
  x: { 'y+': 'z+', 'z+': 'y-', 'y-': 'z-', 'z-': 'y+', 'x+': 'x+', 'x-': 'x-' },
  y: { 'x+': 'z-', 'z+': 'x+', 'x-': 'z+', 'z-': 'x-', 'y+': 'y+', 'y-': 'y-' },
  z: { 'x+': 'y+', 'y+': 'x-', 'x-': 'y-', 'y-': 'x+', 'z+': 'z+', 'z-': 'z-' }
}

// camera behind stern, facing bow
function CameraRig({ fore, span, tick }: { fore: BayDir; span: number; tick: number }): null {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  useEffect(() => {
    const f = DIR_VEC[fore]
    const d = Math.max(span * 2, 8)
    camera.position.set(-f[0] * d + (f[0] === 0 ? d * 0.4 : 0), d * 0.7, -f[2] * d + (f[2] === 0 ? d * 0.4 : 0))
    camera.lookAt(0, 0, 0)
    if (controls) {
      controls.target.set(0, 0, 0)
      controls.update()
    }
  }, [fore, span, tick, camera, controls])
  return null
}

function withBay(
  markup: ShipMarkup[],
  ship: string,
  id: string,
  fn: (b: BayMarkup) => void
): ShipMarkup[] {
  const next = markup.map((s) => ({ ...s, bays: s.bays.map((b) => ({ ...b, faces: b.faces ? { ...b.faces } : undefined })) }))
  let s = next.find((x) => x.ship === ship)
  if (!s) {
    s = { ship, bays: [] }
    next.push(s)
  }
  let b = s.bays.find((x) => x.id === id)
  if (!b) {
    b = { id }
    s.bays.push(b)
  }
  fn(b)
  const empty = (x: BayMarkup): boolean =>
    (!x.faces || !Object.keys(x.faces).length) &&
    x.group === undefined &&
    [x.x, x.y, x.z, x.w, x.l, x.h].every((v) => v === undefined)
  s.bays = s.bays.filter((x) => !empty(x))
  return next
}

function effective(g: CargoGrid, b?: BayMarkup): CargoGrid {
  if (!b) return g
  return {
    ...g,
    ...(b.x !== undefined ? { x: b.x } : {}),
    ...(b.y !== undefined ? { y: b.y } : {}),
    ...(b.z !== undefined ? { z: b.z } : {}),
    ...(b.w !== undefined ? { w: b.w } : {}),
    ...(b.l !== undefined ? { l: b.l } : {}),
    ...(b.h !== undefined ? { h: b.h } : {}),
    ...(b.group !== undefined ? { group: b.group } : {}),
    faces: b.faces
  }
}

function Bay({
  g,
  selected,
  onFace,
  onSelect
}: {
  g: CargoGrid
  selected: boolean
  onFace: (d: BayDir, back: boolean) => void
  onSelect: (additive: boolean) => void
}): JSX.Element {
  const cx = g.x + g.w / 2
  const cy = g.y + g.h / 2
  const cz = g.z + g.l / 2
  return (
    <mesh
      position={[cx, cy, cz]}
      onClick={(e) => {
        e.stopPropagation()
        const additive = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey
        onSelect(additive)
        if (additive) return
        const idx = e.face?.materialIndex
        if (idx != null && idx >= 0 && idx < 6) onFace(IDX_DIR[idx], false)
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        e.nativeEvent.preventDefault()
        const idx = e.face?.materialIndex
        if (idx != null && idx >= 0 && idx < 6) onFace(IDX_DIR[idx], true)
      }}
    >
      <boxGeometry args={[g.w, g.h, g.l]} />
      {IDX_DIR.map((d, i) => (
        <meshStandardMaterial
          key={i}
          attach={`material-${i}`}
          color={colorFor(g.faces?.[d])}
          transparent
          opacity={0.62}
        />
      ))}
      <Edges color={selected ? '#ffd24a' : '#7da2c4'} />
    </mesh>
  )
}

function FrameLabels({ bays, frame }: { bays: CargoGrid[]; frame?: ShipMarkup['frame'] }): JSX.Element | null {
  const b = useMemo(() => {
    if (!bays.length) return null
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const g of bays) {
      minX = Math.min(minX, g.x); maxX = Math.max(maxX, g.x + g.w)
      minY = Math.min(minY, g.y); maxY = Math.max(maxY, g.y + g.h)
      minZ = Math.min(minZ, g.z); maxZ = Math.max(maxZ, g.z + g.l)
    }
    return { minX, minY, minZ, maxX, maxY, maxZ, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2 }
  }, [bays])
  if (!b) return null
  // default bow z-, matches dropdown
  const fore = frame?.fore ?? 'z-'
  const starboard = frame?.starboard ?? STBD_OF[fore]
  const size = Math.min(4, Math.max(1.2, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 * 0.12))
  const off = size * 1.1 + 0.6
  const floorY = b.minY
  // flat on the floor outside
  const posFor = (d: BayDir): [number, number, number] => {
    switch (d) {
      case 'x+': return [b.maxX + off, floorY, b.cz]
      case 'x-': return [b.minX - off, floorY, b.cz]
      case 'z+': return [b.cx, floorY, b.maxZ + off]
      case 'z-': return [b.cx, floorY, b.minZ - off]
      default: return [b.cx, floorY, b.cz]
    }
  }
  const labels: Array<[BayDir, string]> = [
    [fore, 'FRONT'],
    [OPP[fore], 'REAR'],
    [starboard, 'STARBOARD'],
    [OPP[starboard], 'PORT']
  ]
  return (
    <>
      {labels.map(([d, text]) => (
        <Text
          key={text}
          font={sairaFont}
          position={posFor(d)}
          rotation={[-Math.PI / 2, 0, IN_PLANE[d]]}
          fontSize={size}
          color="#ffd24a"
          anchorX="center"
          anchorY="middle"
          letterSpacing={0.12}
          outlineWidth={size * 0.03}
          outlineColor="#000"
        >
          {text}
        </Text>
      ))}
    </>
  )
}

function Scene({
  bays,
  frame,
  sel,
  viewTick,
  onFace,
  onSelect
}: {
  bays: CargoGrid[]
  frame?: ShipMarkup['frame']
  sel: string[]
  viewTick: number
  onFace: (id: string, d: BayDir, back: boolean) => void
  onSelect: (id: string, additive: boolean) => void
}): JSX.Element {
  const ctr = useMemo(() => {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const g of bays) {
      minX = Math.min(minX, g.x); maxX = Math.max(maxX, g.x + g.w)
      minY = Math.min(minY, g.y); maxY = Math.max(maxY, g.y + g.h)
      minZ = Math.min(minZ, g.z); maxZ = Math.max(maxZ, g.z + g.l)
    }
    return {
      c: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as [number, number, number],
      span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 6)
    }
  }, [bays])
  const d = ctr.span * 1.8
  return (
    <Canvas camera={{ position: [ctr.c[0] + d, ctr.c[1] + d, ctr.c[2] + d], fov: 45 }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[10, 20, 15]} intensity={0.8} />
      <group position={[-ctr.c[0], -ctr.c[1], -ctr.c[2]]}>
        {bays.map((g) => (
          <Bay key={g.id} g={g} selected={sel.includes(g.id)} onFace={(dir, back) => onFace(g.id, dir, back)} onSelect={(add) => onSelect(g.id, add)} />
        ))}
        <FrameLabels bays={bays} frame={frame} />
      </group>
      <OrbitControls target={[0, 0, 0]} makeDefault />
      <CameraRig fore={frame?.fore ?? 'z-'} span={ctr.span} tick={viewTick} />
    </Canvas>
  )
}

function RotateButtons({ onRotate }: { onRotate: (a: Axis) => void }): JSX.Element {
  const btn = { fontSize: 12, background: '#2a323c', color: '#cfe3f5', border: '1px solid #28333f', padding: '4px 8px', cursor: 'pointer' } as const
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#8aa3bd', alignSelf: 'center' }}>rotate</span>
      <button onClick={() => onRotate('x')} style={btn} title="pitch (X)">X</button>
      <button onClick={() => onRotate('y')} style={btn} title="yaw (Y) · R">Y</button>
      <button onClick={() => onRotate('z')} style={btn} title="roll (Z)">Z</button>
    </span>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }): JSX.Element {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
      <span style={{ width: 14, color: '#8aa3bd' }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 56, background: '#141b24', color: '#cfe3f5', border: '1px solid #28333f', padding: '2px 4px' }}
      />
    </label>
  )
}

function App(): JSX.Element {
  const [ship, setShip] = useState('Drake Ironclad')
  const [markup, setMarkup] = useState<ShipMarkup[]>([])
  const [sel, setSel] = useState<string[]>([])
  const [status, setStatus] = useState('loading…')
  const [view, setView] = useState(0)
  const [filter, setFilter] = useState<'all' | 'todo' | 'done'>('all')

  const pickBay = (id: string, additive: boolean): void =>
    setSel((s) => (additive ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))

  useEffect(() => {
    fetch('/api/faces')
      .then((r) => r.json())
      .then((m: ShipMarkup[]) => {
        setMarkup(m)
        setStatus(`${m.length} ships loaded`)
      })
      .catch((e) => setStatus(`load failed: ${e}`))
  }, [])

  // done = frame or marked face
  const doneSet = useMemo(() => {
    const d = new Set<string>()
    for (const s of markup) {
      const marked = s.frame || s.bays.some((b) => b.faces && Object.keys(b.faces).length)
      if (marked) d.add(s.ship)
    }
    return d
  }, [markup])
  const shipList = useMemo(
    () => SHIPS.filter((s) => (filter === 'all' ? true : filter === 'done' ? doneSet.has(s) : !doneSet.has(s))),
    [filter, doneSet]
  )

  const sm = markup.find((s) => s.ship === ship)
  const bayMap = useMemo(() => {
    const m = new Map<string, BayMarkup>()
    sm?.bays.forEach((b) => m.set(b.id, b))
    return m
  }, [sm])

  const baseGrids = CARGO_GRIDS[ship]?.grids ?? []
  const bays = useMemo(() => baseGrids.map((g) => effective(g, bayMap.get(g.id))), [baseGrids, bayMap])
  const one = sel.length === 1 ? sel[0] : null
  const selBase = baseGrids.find((g) => g.id === one)
  const selEff = bays.find((g) => g.id === one)

  const setFace = (id: string, d: BayDir, back: boolean): void => {
    setMarkup((m) =>
      withBay(m, ship, id, (b) => {
        const cur = b.faces?.[d]
        const nxt = back ? prevFace(cur) : nextFace(cur)
        const faces = { ...(b.faces ?? {}) }
        if (nxt) faces[d] = nxt
        else delete faces[d]
        b.faces = Object.keys(faces).length ? faces : undefined
      })
    )
  }
  const setOverride = (id: string, patch: Partial<BayMarkup>): void => {
    setMarkup((m) => withBay(m, ship, id, (b) => Object.assign(b, patch)))
  }
  // same group = packs as one room
  const setGroup = (n: number): void => {
    setMarkup((m) => {
      let next = m
      for (const id of sel) next = withBay(next, ship, id, (b) => { b.group = n })
      return next
    })
  }
  const resetBay = (id: string): void => {
    setMarkup((m) => withBay(m, ship, id, (b) => {
      b.x = b.y = b.z = b.w = b.l = b.h = undefined
    }))
  }
  // rotate the selection about its shared center
  const rotateSelected = (axis: Axis): void => {
    const picked = sel.map((id) => bays.find((b) => b.id === id)).filter(Boolean) as CargoGrid[]
    if (!picked.length) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const g of picked) {
      minX = Math.min(minX, g.x); maxX = Math.max(maxX, g.x + g.w)
      minY = Math.min(minY, g.y); maxY = Math.max(maxY, g.y + g.h)
      minZ = Math.min(minZ, g.z); maxZ = Math.max(maxZ, g.z + g.l)
    }
    const gx = (minX + maxX) / 2, gy = (minY + maxY) / 2, gz = (minZ + maxZ) / 2
    setMarkup((m) => {
      let next = m
      for (const g of picked) {
        const rx = g.x + g.w / 2 - gx, ry = g.y + g.h / 2 - gy, rz = g.z + g.l / 2 - gz
        let nrx = rx, nry = ry, nrz = rz, nw = g.w, nh = g.h, nl = g.l
        if (axis === 'y') { nrx = rz; nrz = -rx; nw = g.l; nl = g.w }
        else if (axis === 'x') { nry = -rz; nrz = ry; nh = g.l; nl = g.h }
        else { nrx = -ry; nry = rx; nw = g.h; nh = g.w }
        next = withBay(next, ship, g.id, (b) => {
          b.w = nw; b.h = nh; b.l = nl
          b.x = gx + nrx - nw / 2; b.y = gy + nry - nh / 2; b.z = gz + nrz - nl / 2
          if (g.faces) {
            const nf: Partial<Record<BayDir, BayFaceKind>> = {}
            for (const [d, k] of Object.entries(g.faces)) nf[ROT[axis][d as BayDir]] = k as BayFaceKind
            b.faces = nf
          }
        })
      }
      return next
    })
  }
  // starboard follows the bow, right-hand rule
  const setBow = (fore: BayDir): void => {
    setMarkup((m) => {
      const next = m.map((s) => ({ ...s }))
      let s = next.find((x) => x.ship === ship)
      if (!s) {
        s = { ship, bays: [] }
        next.push(s)
      }
      s.frame = { fore, starboard: STBD_OF[fore] }
      return next
    })
  }

  // arrows move the selection, r rotates
  useEffect(() => {
    if (!sel.length) return
    const h = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return
      const k = e.key.toLowerCase()
      if (k === 'r' || k === 'y') { rotateSelected('y'); e.preventDefault(); return }
      if (k === 'x') { rotateSelected('x'); e.preventDefault(); return }
      if (k === 'z') { rotateSelected('z'); e.preventDefault(); return }
      const step = e.shiftKey ? 5 : 1
      let dx = 0, dy = 0, dz = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dz = -step
      else if (e.key === 'ArrowDown') dz = step
      else if (e.key === 'PageUp') dy = step
      else if (e.key === 'PageDown') dy = -step
      else return
      e.preventDefault()
      setMarkup((m) => {
        let next = m
        for (const id of sel) {
          const g = baseGrids.find((b) => b.id === id)
          if (!g) continue
          next = withBay(next, ship, id, (b) => {
            if (dx) b.x = (b.x ?? g.x) + dx
            if (dy) b.y = (b.y ?? g.y) + dy
            if (dz) b.z = (b.z ?? g.z) + dz
          })
        }
        return next
      })
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sel, baseGrids, bays, ship])

  const save = (): void => {
    setStatus('saving…')
    fetch('/api/faces', { method: 'POST', body: JSON.stringify(markup) })
      .then((r) => r.json())
      .then((r) => setStatus(r.ok ? `saved · ${r.hash.slice(0, 10)}…` : `error: ${r.error}`))
      .catch((e) => setStatus(`save failed: ${e}`))
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 340, padding: 16, borderRight: '1px solid #1d2733', overflowY: 'auto', userSelect: 'none' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Grid Markup</h2>
        <p style={{ fontSize: 12.5, color: '#8aa3bd', lineHeight: 1.45 }}>
          Click a bay <b>face</b> to cycle <span style={{ color: FACE_COLOR.exit }}>exit</span> /{' '}
          <span style={{ color: FACE_COLOR.aisle }}>aisle</span> / <span style={{ color: FACE_COLOR.wall }}>wall</span> / none.
          Right-click cycles backwards.
          Select a bay to move it (number fields, or arrow keys / PageUp-Down; Shift = ×5). Rotate with the
          <b> X/Y/Z</b> buttons or keys (<b>R</b> = Y). Ctrl/Shift-click bays to select several and move them as one. Save writes
          <code> data/uex/grid-faces.json</code> and rehashes it.
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'todo', 'done'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ fontSize: 11, textTransform: 'capitalize', padding: '2px 8px', cursor: 'pointer', borderRadius: 3, border: '1px solid #28333f', background: filter === f ? '#2e7d4f' : '#141b24', color: filter === f ? '#fff' : '#8aa3bd' }}>
                {f}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: '#8aa3bd' }}>{doneSet.size}/{SHIPS.length} done</span>
        </div>
        <select value={shipList.includes(ship) ? ship : ''} onChange={(e) => { setShip(e.target.value); setSel([]) }}
          style={{ width: '100%', margin: '4px 0 14px', padding: 6, background: '#141b24', color: '#cfe3f5', border: '1px solid #28333f' }}>
          {!shipList.includes(ship) && <option value="" disabled>{ship} (filtered out)</option>}
          {shipList.map((s) => <option key={s} value={s}>{doneSet.has(s) ? '✓ ' : '○ '}{s}</option>)}
        </select>

        <div style={{ fontSize: 13, color: '#8aa3bd', marginBottom: 6 }}>Ship frame</div>
        <label style={{ fontSize: 12, color: '#8aa3bd', display: 'block', marginBottom: 14 }}>Bow (front) faces
          <select value={sm?.frame?.fore ?? 'z-'} onChange={(e) => setBow(e.target.value as BayDir)}
            style={{ display: 'block', marginTop: 2, background: '#141b24', color: '#cfe3f5', border: '1px solid #28333f', padding: 4, width: 120 }}>
            {(['z-', 'z+', 'x-', 'x+'] as BayDir[]).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span style={{ color: '#5a6b7d' }}>
            starboard = {STBD_OF[sm?.frame?.fore ?? 'z-']} · port = {OPP[STBD_OF[sm?.frame?.fore ?? 'z-']]} (auto)
          </span>
        </label>
        <button onClick={() => setView((v) => v + 1)} style={{ marginBottom: 14, fontSize: 12, background: '#2a323c', color: '#cfe3f5', border: '1px solid #28333f', padding: '4px 10px', cursor: 'pointer' }}>
          Reset view (behind stern)
        </button>

        {selEff && selBase ? (
          <div style={{ border: '1px solid #28333f', borderRadius: 4, padding: 10, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{selEff.name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <NumField label="x" value={selEff.x} onChange={(n) => setOverride(one!, { x: n })} />
              <NumField label="y" value={selEff.y} onChange={(n) => setOverride(one!, { y: n })} />
              <NumField label="z" value={selEff.z} onChange={(n) => setOverride(one!, { z: n })} />
              <NumField label="w" value={selEff.w} onChange={(n) => setOverride(one!, { w: n })} />
              <NumField label="l" value={selEff.l} onChange={(n) => setOverride(one!, { l: n })} />
              <NumField label="h" value={selEff.h} onChange={(n) => setOverride(one!, { h: n })} />
            </div>
            <div style={{ fontSize: 12, color: '#8aa3bd', marginTop: 8 }}>
              faces: {selEff.faces ? Object.entries(selEff.faces).map(([d, k]) => `${d}=${k}`).join(' ') : 'none'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#8aa3bd' }}>hold group</span>
              <input type="number" min={0} value={selEff.group ?? 0}
                onChange={(e) => setOverride(one!, { group: Math.max(0, Math.floor(+e.target.value || 0)) })}
                style={{ width: 54, background: '#141b24', color: '#cfe3f5', border: '1px solid #28333f', borderRadius: 4, padding: '4px 6px' }} />
              <span style={{ fontSize: 11, color: '#5a6b7d' }}>same number = one combined hold</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <RotateButtons onRotate={rotateSelected} />
              <button onClick={() => resetBay(one!)} style={{ fontSize: 12, background: '#2a323c', color: '#cfe3f5', border: '1px solid #28333f', padding: '4px 8px', cursor: 'pointer' }}>
                reset position/size
              </button>
            </div>
          </div>
        ) : sel.length > 1 ? (
          <div style={{ border: '1px solid #28333f', borderRadius: 4, padding: 10, marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{sel.length} bays selected</div>
            <div style={{ fontSize: 12, color: '#8aa3bd', marginBottom: 8 }}>
              Arrow keys / PageUp-Down move them together (Shift = ×5).
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#8aa3bd' }}>combine into hold group</span>
              {[0, 1, 2, 3].map((n) => {
                const active = sel.every((id) => bays.find((b) => b.id === id)?.group === n)
                return (
                  <button key={n} onClick={() => setGroup(n)}
                    style={{ fontSize: 12, fontWeight: active ? 700 : 400, background: active ? '#ffd24a' : '#2a323c', color: active ? '#141b24' : '#cfe3f5', border: `1px solid ${active ? '#ffd24a' : '#28333f'}`, borderRadius: 4, padding: '4px 9px', cursor: 'pointer' }}>
                    {n}
                  </button>
                )
              })}
            </div>
            <RotateButtons onRotate={rotateSelected} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#5a6b7d', marginBottom: 12 }}>Select a bay to move it. Ctrl/Shift-click for several.</div>
        )}

        <div style={{ fontSize: 13, marginBottom: 6, color: '#8aa3bd' }}>Bays ({bays.length})</div>
        {bays.map((g) => (
          <div key={g.id} onClick={(e) => pickBay(g.id, e.ctrlKey || e.metaKey || e.shiftKey)}
            style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', marginBottom: 3, cursor: 'pointer', background: sel.includes(g.id) ? '#2a323c' : '#141b24', border: `1px solid ${sel.includes(g.id) ? '#ffd24a55' : '#28333f'}`, borderRadius: 4, fontSize: 13 }}>
            <span>{g.name}{g.autoLoad === false ? ' ·ref' : ''}</span>
            <span style={{ display: 'inline-flex', gap: 8 }}>
              {g.group !== undefined && <span style={{ color: '#5a6b7d' }}>h{g.group}</span>}
              <span style={{ color: g.exit ? FACE_COLOR.exit : '#5a6b7d' }}>{g.faces ? Object.keys(g.faces).length + 'f' : '0f'}</span>
            </span>
          </div>
        ))}

        <button onClick={save} style={{ width: '100%', marginTop: 14, padding: 10, background: '#2e7d4f', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
          Save grid-faces.json
        </button>
        <div style={{ fontSize: 12, color: '#8aa3bd', marginTop: 10 }}>{status}</div>
      </div>
      <div style={{ flex: 1 }}>
        <Scene bays={bays} frame={sm?.frame} sel={sel} viewTick={view} onFace={setFace} onSelect={pickBay} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
