"use client";

import { Html, Line, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useRouter } from "@/i18n/navigation";
import { GOLD, NIGHT_BG, termPlanets, type TermPlanet } from "../universe";
import { IslandMount, useLowPolyGeometry, useReducedMotion } from "./scene-bits";

export interface PlanetLabel {
  id: string;
  name: string;
  tag: string;
  enter: string;
  recommendedLabel?: string;
}

function GalaxyPlanet({ planet, label, recommended, reduced, onEnter }: {
  planet: TermPlanet;
  label: PlanetLabel;
  recommended: boolean;
  reduced: boolean;
  onEnter: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const geo = useLowPolyGeometry(planet.id, planet.size, 2, 0.05);
  const phase = useMemo(() => planet.position[0] * 1.7 + planet.position[1], [planet.position]);

  useFrame((state, delta) => {
    if (!group.current || !spin.current) return;
    if (!reduced) {
      spin.current.rotation.y += delta * 0.1;
      group.current.position.y = planet.position[1] + Math.sin(state.clock.elapsedTime * 0.45 + phase) * 0.07;
    }
    const target = hover ? 1.07 : 1;
    group.current.scale.lerp(new THREE.Vector3(target, target, target), 0.12);
  });

  return (
    <group ref={group} position={planet.position}>
      <group ref={spin}>
        <mesh
          geometry={geo}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHover(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHover(false);
            document.body.style.cursor = "";
          }}
          onClick={(e) => {
            e.stopPropagation();
            onEnter(planet.id);
          }}
        >
          <meshStandardMaterial color={planet.color} flatShading roughness={0.9} />
        </mesh>
        {planet.islands.map((isl) => (
          <IslandMount
            key={isl.id}
            lat={isl.lat}
            lon={isl.lon}
            R={planet.size}
            color={planet.color2}
            landmark={isl.landmark}
            landmarkColor={planet.color2}
            seed={planet.id + isl.id}
            landmarkScale={planet.size * 0.85}
          />
        ))}
      </group>
      {/* 大气光晕 */}
      <mesh scale={1.22}>
        <sphereGeometry args={[planet.size, 20, 14]} />
        <meshBasicMaterial color={recommended ? GOLD : planet.color} transparent opacity={recommended ? 0.14 : 0.07} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      {/* 名称（常显）+ hover 名片；occlude：被前景星球挡住时名牌一并隐藏 */}
      <Html position={[0, -planet.size - 0.42, 0]} center occlude zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ textAlign: "center", whiteSpace: "nowrap", userSelect: "none" }}>
          <div style={{ color: hover || recommended ? GOLD : "#f2eddf", fontSize: 13, opacity: hover ? 1 : 0.85, letterSpacing: 1, textShadow: "0 1px 6px rgba(0,0,0,.7)" }}>
            {label.name}
          </div>
          {recommended && !hover && (
            <div style={{ color: GOLD, fontSize: 10, opacity: 0.75, marginTop: 2 }}>✦ {label.recommendedLabel}</div>
          )}
          {hover && (
            <div style={{ marginTop: 6, background: "rgba(23,26,40,.92)", border: "1px solid rgba(255,217,138,.35)", borderRadius: 12, padding: "8px 12px", maxWidth: 230, whiteSpace: "normal" }}>
              <div style={{ color: "#f2eddf", fontSize: 11, lineHeight: 1.5, opacity: 0.9 }}>{label.tag}</div>
              <div style={{ color: GOLD, fontSize: 11, marginTop: 4 }}>{label.enter} →</div>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

/** 一条穿过全部星球的星路（星轨母题的宇宙形态）：把散布的星球在纵深里串成旅程 */
function StarLane() {
  const points = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      termPlanets.map((p) => new THREE.Vector3(...p.position)),
      false,
      "catmullrom",
      0.6,
    );
    return curve.getPoints(140).map((v) => [v.x, v.y, v.z] as [number, number, number]);
  }, []);
  return <Line points={points} color="#f2eddf" transparent opacity={0.12} lineWidth={1} dashed dashSize={0.06} gapSize={0.16} />;
}

/** 指针视差：轻微移动镜头，给星系纵深感 */
function Rig({ reduced }: { reduced: boolean }) {
  useFrame((state) => {
    const { camera, pointer } = state;
    if (!reduced) {
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, pointer.x * 0.75, 0.045);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0.25 + pointer.y * 0.45, 0.045);
    }
    camera.lookAt(0.55, 0.2, -2.8);
  });
  return null;
}

export default function GalaxyScene({ planets, labels, recommendedId }: {
  planets: TermPlanet[];
  labels: Record<string, PlanetLabel>;
  recommendedId: string | null;
}) {
  const router = useRouter();
  const reduced = useReducedMotion();
  return (
    <Canvas camera={{ position: [0, 0.25, 8.6], fov: 44 }} dpr={[1, 2]} className="!absolute !inset-0" style={{ touchAction: "pan-x" }}>
      <color attach="background" args={[NIGHT_BG]} />
      <fog attach="fog" args={[NIGHT_BG, 9, 22]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[5, 7, 6]} intensity={1.35} />
      <directionalLight position={[-6, -3, 4]} intensity={0.25} color="#8e9bc4" />
      <Stars radius={45} depth={30} count={2800} factor={3.4} saturation={0} fade speed={reduced ? 0 : 0.5} />
      <Rig reduced={reduced} />
      <StarLane />
      {planets.map((p) => (
        <GalaxyPlanet
          key={p.id}
          planet={p}
          label={labels[p.id]}
          recommended={p.id === recommendedId}
          reduced={reduced}
          onEnter={(id) => router.push(`/terms/${id}`)}
        />
      ))}
    </Canvas>
  );
}
