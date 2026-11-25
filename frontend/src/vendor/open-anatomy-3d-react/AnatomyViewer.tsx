import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ElementRef, ReactNode } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Bvh, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import {
  ANATOMY_BY_KEY, CATEGORY_COLORS, type AnatomySex, type AnatomyStructure, type AnatomySystem, type Vec3,
} from 'open-anatomy-3d'
import { anatomyDisplayName } from '../../features/viewer/anatomyNames'
import { AnatomyModel, DEFAULT_LAYERS, type LayerVisibility, type ProjectedAnchor } from './AnatomyModel'
import { CalloutOverlay, type Callout, type CalloutOverlayHandle } from './CalloutOverlay'
import { RotateArcControl } from './RotateArcControl'
import { cn } from './cn'

/** A structure to call out: it glows and gets a card with a leader line. */
export interface AnatomyPin {
  /** Catalog key, e.g. "heart" or "knee_l". */
  key: string
  /** Card heading. Defaults to the structure's category. */
  title?: string
  /** Lines listed on the card (e.g. conditions, notes). */
  items?: string[]
  /** Card and leader-line colour. Defaults to the category colour. */
  color?: string
}

export interface AnatomyViewerProps {
  /** Controlled body. */
  sex?: AnatomySex
  /** Initial body when uncontrolled. */
  defaultSex?: AnatomySex
  onSexChange?: (sex: AnatomySex) => void
  /** Controlled layer visibility. */
  layers?: LayerVisibility
  defaultLayers?: LayerVisibility
  onLayersChange?: (layers: LayerVisibility) => void
  /** Structures to call out with a card. */
  pins?: AnatomyPin[]
  /** Extra structures to make glow, without a card. */
  highlightedKeys?: readonly string[]
  onStructureClick?: (key: string, structure: AnatomyStructure) => void
  onStructureHover?: (key: string | null) => void
  /** Second line of the hover label. `null` hides it. */
  hoverHint?: string | null
  /** Override where the models are loaded from (e.g. self-hosted copies). */
  modelUrls?: Partial<Record<AnatomySex, string>>
  /** Adapt the atlas to a recorded body height and weight. */
  modelScale?: Vec3
  /** Camera target in atlas metres. */
  focus?: Vec3
  /** Initial camera distance in atlas metres. */
  cameraDistance?: number
  autoRotate?: boolean
  onReadyChange?: (ready: boolean) => void
  showSexToggle?: boolean
  showLayerToggles?: boolean
  showRotateControl?: boolean
  showZoomControls?: boolean
  hoverColor?: string
  highlightColor?: string
  className?: string
  style?: CSSProperties
  /** Rendered over the canvas — e.g. your own buttons. */
  children?: ReactNode
}

type OrbitControlsImpl = ElementRef<typeof OrbitControls>

const DEFAULT_FOCUS: Vec3 = [0, 0.92, 0]
const DEFAULT_DISTANCE = 3.55
const MIN_DISTANCE = 0.6
const MAX_DISTANCE = 6

const LAYER_ORDER: AnatomySystem[] = ['skin', 'muscles', 'skeleton', 'joints', 'organs', 'vessels', 'nerves']
const NO_PINS: AnatomyPin[] = []
const NO_KEYS: readonly string[] = []
const SPANISH_SYSTEM_LABELS: Record<AnatomySystem, string> = {
  skin: 'Piel', skeleton: 'Esqueleto', joints: 'Articulaciones', muscles: 'Músculos',
  organs: 'Órganos', vessels: 'Vasos sanguíneos', nerves: 'Nervios',
}
const SPANISH_CATEGORIES: Readonly<Record<string, string>> = {
  'Musculoskeletal': 'Musculoesquelético', 'Respiratory': 'Respiratorio',
  'Renal / Urinary': 'Renal y urinario', 'Neurological': 'Neurológico',
  'Endocrine': 'Endocrino', 'Digestive': 'Digestivo', 'Reproductive': 'Reproductivo',
  'Eye / Sensory': 'Sensorial', 'Cardiovascular': 'Cardiovascular',
  'Oral / ENT': 'Oral y otorrinolaringológico', 'Immune / Lymphatic': 'Inmunitario y linfático',
  'Skin': 'Piel',
}
const translateCategory = (category: string) => SPANISH_CATEGORIES[category] ?? category

function useControllable<T>(value: T | undefined, initial: T, onChange?: (v: T) => void): [T, (v: T) => void] {
  const [inner, setInner] = useState(initial)
  const current = value !== undefined ? value : inner
  const set = useCallback((v: T) => {
    if (value === undefined) setInner(v)
    onChange?.(v)
  }, [value, onChange])
  return [current, set]
}

/**
 * Interactive human anatomy: a full male or female body (skin, skeleton,
 * muscles, organs, vessels, nerves) you can orbit, zoom and click.
 * Drag to orbit, Ctrl/⌘ + wheel or pinch to zoom, hover to identify a
 * structure, click to select it. Pinned structures glow and get a callout card.
 *
 * Remember to import the styles once: `import 'open-anatomy-3d-react/styles.css'`.
 */
export function AnatomyViewer({
  sex: sexProp,
  defaultSex = 'male',
  onSexChange,
  layers: layersProp,
  defaultLayers = DEFAULT_LAYERS,
  onLayersChange,
  pins = NO_PINS,
  highlightedKeys = NO_KEYS,
  onStructureClick,
  onStructureHover,
  hoverHint = 'Seleccionar estructura',
  modelUrls,
  modelScale = [1, 1, 1],
  focus = DEFAULT_FOCUS,
  cameraDistance = DEFAULT_DISTANCE,
  autoRotate = false,
  onReadyChange,
  showSexToggle = true,
  showLayerToggles = true,
  showRotateControl = true,
  showZoomControls = true,
  hoverColor,
  highlightColor,
  className,
  style,
  children,
}: AnatomyViewerProps) {
  const [sex, setSex] = useControllable(sexProp, defaultSex, onSexChange)
  const [layers, setLayers] = useControllable(layersProp, defaultLayers, onLayersChange)
  const [hoveredKey, setHoveredKeyState] = useState<string | null>(null)
  const [azimuth, setAzimuth] = useState(0)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const overlayRef = useRef<CalloutOverlayHandle>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)

  const onHoverRef = useRef(onStructureHover)
  onHoverRef.current = onStructureHover
  const setHoveredKey = useCallback((key: string | null) => {
    setHoveredKeyState(key)
    onHoverRef.current?.(key)
  }, [])

  // A structure that only exists in the other body (e.g. the uterus on the
  // male model) has nowhere to pin, so it's left off rather than floating.
  const inBody = useCallback((key: string) => {
    const info = ANATOMY_BY_KEY[key]
    return !!info && (!info.sex || info.sex === sex)
  }, [sex])
  const visiblePins = useMemo(() => pins.filter(p => inBody(p.key)), [pins, inBody])
  const highlighted = useMemo(
    () => new Set([...visiblePins.map(p => p.key), ...highlightedKeys.filter(inBody)]),
    [visiblePins, highlightedKeys, inBody],
  )
  const anchorKeys = useMemo(() => visiblePins.map(p => p.key), [visiblePins])

  const callouts: Callout[] = useMemo(() => visiblePins.map(p => {
    const info = ANATOMY_BY_KEY[p.key]
    return {
      key: p.key,
      title: p.title ?? translateCategory(info.category),
      subtitle: anatomyDisplayName(info.label),
      items: p.items ?? [],
      color: p.color ?? CATEGORY_COLORS[info.category] ?? '#d94f0b',
    }
  }), [visiblePins])

  const handleProject = useCallback((anchors: ProjectedAnchor[], w: number, h: number) => {
    overlayRef.current?.update(anchors, w, h)
  }, [])

  const handleSelect = useCallback((key: string) => {
    const info = ANATOMY_BY_KEY[key]
    if (info) onStructureClick?.(key, info)
  }, [onStructureClick])

  const dolly = useCallback((factor: number) => {
    const c = controlsRef.current
    if (!c) return
    const cam = c.object
    const offset = cam.position.clone().sub(c.target)
    const minDistance = Math.min(MIN_DISTANCE, cameraDistance * 0.4)
    const maxDistance = Math.max(MAX_DISTANCE, cameraDistance * 1.8)
    const next = THREE.MathUtils.clamp(offset.length() * factor, minDistance, maxDistance)
    cam.position.copy(c.target).add(offset.setLength(next))
    c.update()
  }, [cameraDistance])

  // A plain scroll wheel over the body scrolls the page (OrbitControls' own
  // wheel-zoom is off). Zoom only on an explicit gesture: trackpad pinch /
  // Ctrl+wheel (both arrive as wheel events with ctrlKey set) or the +/- buttons.
  useEffect(() => {
    const el = canvasWrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      dolly(Math.exp(e.deltaY * 0.0025))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [dolly])

  function setAzimuthAngle(angle: number) {
    const c = controlsRef.current
    if (!c) return
    const cam = c.object
    const offset = cam.position.clone().sub(c.target)
    const s = new THREE.Spherical().setFromVector3(offset)
    s.theta = angle
    cam.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(s))
    c.update()
  }

  function resetView() {
    const c = controlsRef.current
    if (!c) return
    c.target.set(...focus)
    c.object.position.set(focus[0], focus[1] + 0.1, focus[2] + cameraDistance)
    c.update()
  }

  const hoveredInfo = hoveredKey ? ANATOMY_BY_KEY[hoveredKey] : null
  return (
    <div className={cn('oa3d-viewer', className)} style={style}>
      {showSexToggle && (
        <div className="oa3d-sex-toggle" role="radiogroup" aria-label="Modelo corporal">
          {(['male', 'female'] as const).map(option => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={sex === option}
              className={cn('oa3d-sex-option', sex === option && 'oa3d-sex-option-on')}
              onClick={() => { setSex(option); setHoveredKey(null) }}
            >
              {option === 'male' ? 'Masculino' : 'Femenino'}
            </button>
          ))}
          <span className={cn('oa3d-sex-thumb', sex === 'female' && 'oa3d-sex-thumb-right')} aria-hidden />
        </div>
      )}

      {showLayerToggles && (
        <div className="oa3d-layers" role="group" aria-label="Sistemas anatómicos">
          {LAYER_ORDER.map(system => (
            <button
              key={system}
              type="button"
              aria-pressed={layers[system]}
              className={cn('oa3d-layer', layers[system] && 'oa3d-layer-on')}
              onClick={() => setLayers({ ...layers, [system]: !layers[system] })}
            >
              <span className={cn('oa3d-swatch', `oa3d-swatch-${system}`)} />
              {SPANISH_SYSTEM_LABELS[system]}
            </button>
          ))}
        </div>
      )}

      <div ref={canvasWrapRef} className={cn('oa3d-canvas', hoveredKey && 'oa3d-canvas-pointer')}>
        <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
          <PerspectiveCamera makeDefault position={[focus[0], focus[1] + 0.1, focus[2] + cameraDistance]} fov={30} near={0.05} far={50} />
          <hemisphereLight args={['#ffffff', '#b9a58f', 1.1]} />
          <directionalLight position={[2, 4, 3]} intensity={1.8} />
          <directionalLight position={[-3, 2, -2]} intensity={0.7} />
          <directionalLight position={[0, 1, -4]} intensity={0.5} />
          <Suspense fallback={null}>
            <Bvh firstHitOnly={false}>
              <AnatomyModel
                key={sex}
                sex={sex}
                url={modelUrls?.[sex]}
                layers={layers}
                highlightedKeys={highlighted}
                hoveredKey={hoveredKey}
                onHover={setHoveredKey}
                onSelect={handleSelect}
                anchorKeys={anchorKeys}
                onProject={handleProject}
                hoverColor={hoverColor}
                highlightColor={highlightColor}
                modelScale={modelScale}
                onReadyChange={onReadyChange}
              />
            </Bvh>
          </Suspense>
          <OrbitControls
            ref={controlsRef}
            makeDefault
            target={focus}
            autoRotate={autoRotate}
            autoRotateSpeed={0.25}
            enableZoom={false}
            enableDamping
            dampingFactor={0.08}
            enablePan
            screenSpacePanning
            minDistance={Math.min(MIN_DISTANCE, cameraDistance * 0.4)}
            maxDistance={Math.max(MAX_DISTANCE, cameraDistance * 1.8)}
            minPolarAngle={Math.PI * 0.12}
            maxPolarAngle={Math.PI * 0.88}
            rotateSpeed={0.7}
            onChange={() => {
              const c = controlsRef.current
              if (c) setAzimuth(c.getAzimuthalAngle())
            }}
          />
        </Canvas>

        <CalloutOverlay
          ref={overlayRef}
          callouts={callouts}
          hoveredKey={hoveredKey}
          onSelect={handleSelect}
          onHover={setHoveredKey}
        />

        {hoveredInfo && (
          <div className="oa3d-hover-tag" aria-live="polite">
            <span className="oa3d-hover-name">{anatomyDisplayName(hoveredInfo.label)}</span>
            {hoverHint && <span className="oa3d-hover-hint">{hoverHint}</span>}
          </div>
        )}

        {showZoomControls && (
          <>
            <button type="button" className="oa3d-zoom oa3d-zoom-out" onClick={() => dolly(1.18)} aria-label="Alejar">−</button>
            <button type="button" className="oa3d-reset" onClick={resetView} aria-label="Restablecer vista">Restablecer</button>
            <button type="button" className="oa3d-zoom oa3d-zoom-in" onClick={() => dolly(1 / 1.18)} aria-label="Acercar">+</button>
          </>
        )}
        {children}
      </div>
      {showRotateControl && <RotateArcControl rotationY={azimuth} onChange={setAzimuthAngle} />}
    </div>
  )
}
