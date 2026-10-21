"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createCoinGeometry } from "./coin-geometry";
import { COIN_FINISHES, coinFaces } from "./coin-assets";

/** An owned three-dimensional mesh. Artwork is independently replaceable on each face. */
export default function PickEmCoin3D({ coin }: { coin: string }) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef<(() => void) | null>(null);
  const rotate = useRef<((direction: number) => void) | null>(null);
  const [failed, setFailed] = useState(false);
  const finish = COIN_FINISHES[coin] ?? COIN_FINISHES.未获得!;
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { queueMicrotask(() => setFailed(true)); return; }
    let disposed = false;
    renderer.domElement.dataset.coinRenderer = "webgl";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    target.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 50);
    camera.position.set(.55, .2, 4.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = .65;
    controls.minPolarAngle = .12;
    controls.maxPolarAngle = Math.PI - .12;
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(environment, .04);
    scene.environment = env.texture;
    const key = new THREE.DirectionalLight(0xffead1, 4); key.position.set(3, 4, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xc6e6ff, 2); fill.position.set(-4, 0, 2); scene.add(fill);
    const rimLight = new THREE.DirectionalLight(0xb9dfff, 3); rimLight.position.set(2, 3, -4); scene.add(rimLight);
    scene.add(new THREE.AmbientLight(0xffffff, .65));
    const metal = new THREE.MeshStandardMaterial({ color: finish.metal, metalness: .92, roughness: .27 });
    const faces = [0, 1].map(() => new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .3, roughness: .4, emissive: 0xffffff, emissiveIntensity: .25 }));
    const group = new THREE.Group(); scene.add(group);
    const body = new THREE.Mesh(createCoinGeometry(), [metal, ...faces]);
    group.add(body);
    const rimGeometry = new THREE.TorusGeometry(.965, .035, 12, 128);
    for (const z of [-.075, .075]) { const rim = new THREE.Mesh(rimGeometry, metal); rim.position.z = z; group.add(rim); }
    const grooveGeometry = new THREE.BoxGeometry(.018, .035, .11);
    for (let i = 0; i < 96; i++) {
      const angle = i / 96 * Math.PI * 2;
      const groove = new THREE.Mesh(grooveGeometry, metal);
      groove.position.set(Math.cos(angle) * .98, Math.sin(angle) * .98, 0);
      groove.rotation.z = angle; group.add(groove);
    }
    const render = () => { if (!disposed) renderer.render(scene, camera); };
    const textures: THREE.Texture[] = [];
    const loader = new THREE.TextureLoader();
    [coinFaces(coin).front, coinFaces(coin).back].forEach((url, i) => {
      loader.load(url, (texture) => {
        if (disposed) { texture.dispose(); return; }
        textures.push(texture); texture.colorSpace = THREE.SRGBColorSpace;
        faces[i]!.map = texture; faces[i]!.emissiveMap = texture; faces[i]!.needsUpdate = true; render();
      }, undefined, () => { if (!disposed) setFailed(true); });
    });
    controls.addEventListener("change", render);
    reset.current = () => { camera.position.set(.55, .2, 4.4); controls.target.set(0, 0, 0); group.rotation.set(0, 0, 0); controls.update(); render(); };
    rotate.current = (direction) => { group.rotation.y += direction * Math.PI / 8; render(); };
    const resize = new ResizeObserver(() => {
      const { width, height } = target.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
    });
    resize.observe(target);
    const lost = (event: Event) => { event.preventDefault(); setFailed(true); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true; reset.current = null; rotate.current = null;
      resize.disconnect(); controls.dispose(); textures.forEach((texture) => texture.dispose());
      body.geometry.dispose(); rimGeometry.dispose(); grooveGeometry.dispose(); metal.dispose(); faces.forEach((face) => face.dispose());
      env.dispose(); pmrem.dispose(); environment.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [finish.metal, coin]);
  return <div className="flex h-full min-h-0 flex-col">
    <div ref={host} className={`relative flex min-h-[220px] flex-1 items-center justify-center touch-none cursor-grab active:cursor-grabbing ${failed ? "[&_canvas]:hidden" : ""}`} role="img" aria-label={`${finish.label}三维展示，可拖动旋转`}>
      {failed && <div className="h-full max-h-[480px] w-full max-w-[480px] p-5"><Image src={coinFaces(coin).front} width={480} height={480} alt={finish.label} className="h-full w-full object-contain drop-shadow-[0_0_24px_#ffd5a840]" /></div>}
    </div>
    {failed && <p role="status" className="text-center text-sm text-[var(--color-fg-mid)]">当前显示静态币图</p>}
    <div className="flex justify-center gap-4 py-4 text-xs text-[var(--color-fg-mid)]">
      <button type="button" disabled={failed} className="disabled:opacity-40" onClick={() => rotate.current?.(-1)} aria-label="向左旋转纪念币">向左旋转</button>
      <button type="button" disabled={failed} className="disabled:opacity-40" onClick={() => reset.current?.()}>复位</button>
      <button type="button" disabled={failed} className="disabled:opacity-40" onClick={() => rotate.current?.(1)} aria-label="向右旋转纪念币">向右旋转</button>
    </div>
  </div>;
}
