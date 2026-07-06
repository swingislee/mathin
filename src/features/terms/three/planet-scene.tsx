"use client";

import { Html, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useRouter } from "@/i18n/navigation";
import { GOLD, NIGHT_BG, type TermPlanet } from "../universe";
import { IslandMount, useLowPolyGeometry, useReducedMotion } from "./scene-bits";

const R = 1.92;

export interface IslandCard {
  id: string;
  name: string;
  desc: string;
  countLine: string;
  enterLine: string;
}

function FocusPlanet({ planet, islands, reduced, onEnterIsland }: {
  planet: TermPlanet;
  islands: IslandCard[];
  reduced: boolean;
  onEnterIsland: (id: string) => void;
}) {
  const spin = useRef<THREE.Group>(null);
  const sphereRef = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState<string | null>(null);
  const geo = useLowPolyGeometry(planet.id, R, 3, 0.035);

  useFrame((_, delta) => {
    if (spin.current && !reduced && !hover) spin.current.rotation.y += delta * 0.09;
  });

  return (
    <group>
      <group ref={spin}>
        <mesh ref={sphereRef} geometry={geo}>
          <meshStandardMaterial color={planet.color} flatShading roughness={0.92} />
        </mesh>
        {planet.islands.map((isl) => {
          const card = islands.find((c) => c.id === isl.id);
          const active = hover === isl.id;
          return (
            <group key={isl.id}>
              <IslandMount
                lat={isl.lat}
                lon={isl.lon}
                R={R}
                color={planet.color2}
                landmark={isl.landmark}
                landmarkColor={active ? GOLD : planet.color2}
                lift={active ? 0.06 : 0}
                seed={planet.id + isl.id}
                landmarkScale={1.7}
              >
                {/* 命中区：覆盖整片模块簇 */}
                <mesh
                  position={[0, 0.06, 0]}
                  onPointerOver={(e) => {
                    e.stopPropagation();
                    setHover(isl.id);
                    document.body.style.cursor = "pointer";
                  }}
                  onPointerOut={() => {
                    setHover(null);
                    document.body.style.cursor = "";
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEnterIsland(isl.id);
                  }}
                >
                  <cylinderGeometry args={[1.0, 1.0, 0.45, 8]} />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
                {/* 岛屿标签：外部 UI 名牌，不写在模型上（docs §9.2） */}
                <Html position={[0, 0.62, 0]} center occlude={[sphereRef as React.RefObject<THREE.Object3D>]} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
                  <div style={{ textAlign: "center", whiteSpace: "nowrap", userSelect: "none", transition: "opacity .2s" }}>
                    <div style={{ color: active ? GOLD : "#f2eddf", fontSize: 12.5, textShadow: "0 1px 6px rgba(0,0,0,.8)", letterSpacing: 0.5 }}>
                      {card?.name}
                    </div>
                    {active && card && (
                      <div style={{ marginTop: 6, background: "rgba(23,26,40,.94)", border: "1px solid rgba(255,217,138,.35)", borderRadius: 12, padding: "8px 12px", maxWidth: 220, whiteSpace: "normal" }}>
                        <div style={{ color: "#f2eddf", fontSize: 11, lineHeight: 1.5, opacity: 0.9 }}>{card.desc}</div>
                        <div style={{ color: "#f2eddf", fontSize: 10.5, opacity: 0.65, marginTop: 3 }}>{card.countLine}</div>
                        <div style={{ color: GOLD, fontSize: 11, marginTop: 4 }}>{card.enterLine} →</div>
                      </div>
                    )}
                  </div>
                </Html>
              </IslandMount>
            </group>
          );
        })}
      </group>
      {/* 大气 */}
      <mesh scale={1.14}>
        <sphereGeometry args={[R, 24, 18]} />
        <meshBasicMaterial color={planet.color} transparent opacity={0.08} side={THREE.BackSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** 竖屏时相机自动后撤，保证完整球体轮廓可见 */
function ResponsiveCamera() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const z = aspect >= 1 ? 5.4 : 5.4 / Math.max(0.44, aspect * 0.92);
    camera.position.set(0, 0.7, z);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export default function PlanetScene({ planet, islands }: { planet: TermPlanet; islands: IslandCard[] }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  return (
    <Canvas camera={{ position: [0, 0.7, 5.4], fov: 42 }} dpr={[1, 2]} className="!absolute !inset-0">
      <color attach="background" args={[NIGHT_BG]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 7]} intensity={1.4} />
      <directionalLight position={[-6, -2, 3]} intensity={0.22} color="#8e9bc4" />
      <Stars radius={40} depth={24} count={2200} factor={3} saturation={0} fade speed={reduced ? 0 : 0.4} />
      <ResponsiveCamera />
      <FocusPlanet planet={planet} islands={islands} reduced={reduced} onEnterIsland={(id) => router.push(`/terms/${planet.id}/${id}`)} />
      <OrbitControls enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} minPolarAngle={Math.PI * 0.28} maxPolarAngle={Math.PI * 0.68} />
    </Canvas>
  );
}
