// src/SimulationScene.tsx
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneObject } from "./App";

interface SimulationSceneProps {
  apiBase: string;
  objects: SceneObject[];
  onAddBox: () => void;
  onAddSphere: () => void;
}

/**
 * Simula la máquina pick & place:
 * - Mesa fija.
 * - Cabezal con láser apuntando hacia abajo.
 * - Escaneo raster en X/Z.
 * - Objetos dinámicos desde backend.
 * - Drag & drop de objetos con el mouse (en el plano XZ).
 * - Alt+click en un objeto para eliminarlo.
 * - Controles UI para velocidad de escaneo y muestreo.
 * - Botones para añadir figuras (delegan en App.tsx).
 */
export const SimulationScene: React.FC<SimulationSceneProps> = ({
  apiBase,
  objects,
  onAddBox,
  onAddSphere,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ====== Controles de simulación (UI) ======
  const [headSpeed, setHeadSpeed] = useState<number>(1); // 1x por defecto
  const [sampleEvery, setSampleEvery] = useState<number>(1); // muestrear cada N pasos

  const headSpeedRef = useRef(headSpeed);
  const sampleEveryRef = useRef(sampleEvery);

  useEffect(() => {
    headSpeedRef.current = headSpeed;
  }, [headSpeed]);

  useEffect(() => {
    sampleEveryRef.current = sampleEvery;
  }, [sampleEvery]);

  // ====== Lógica Three.js ======
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // === Setup Three.js ===
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#020617");

    const camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.01,
      1000
    );
    camera.position.set(5, 4, 5);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(4, 6, 3);
    scene.add(directional);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // === Mesa ===
    const tableSize = 4;
    const tableGeometry = new THREE.PlaneGeometry(tableSize, tableSize);
    const tableMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      side: THREE.DoubleSide,
      metalness: 0.1,
      roughness: 0.8,
    });
    const tableMesh = new THREE.Mesh(tableGeometry, tableMaterial);
    tableMesh.rotation.x = -Math.PI / 2;
    tableMesh.position.y = 0;
    scene.add(tableMesh);

    const grid = new THREE.GridHelper(tableSize, 16, 0x111827, 0x020617);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    grid.position.y = 0.001;
    scene.add(grid);

    // === Objetos dinámicos ===
    const raycastTargets: THREE.Object3D[] = [];
    raycastTargets.push(tableMesh);

    const objectMeshes: THREE.Mesh[] = [];
    const meshToObjectId = new Map<THREE.Object3D, number>();
    const idToObject = new Map<number, SceneObject>();

    for (const obj of objects) {
      const color = new THREE.Color(obj.color ?? "#3b82f6");
      let mesh: THREE.Mesh;

      if (obj.type === "box") {
        const size = obj.size ?? [0.5, 0.5, 0.5];
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(size[0], size[1], size[2]),
          new THREE.MeshStandardMaterial({ color })
        );
      } else {
        const radius = obj.radius ?? 0.4;
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 32, 32),
          new THREE.MeshStandardMaterial({ color })
        );
      }

      mesh.position.set(obj.position[0], obj.position[1], obj.position[2]);
      scene.add(mesh);
      objectMeshes.push(mesh);
      raycastTargets.push(mesh);
      meshToObjectId.set(mesh, obj.id);
      idToObject.set(obj.id, obj);
    }

    // === Estructura de la máquina ===
    const headHeight = 2.0;
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x64748b });
    const railGeomX = new THREE.BoxGeometry(tableSize + 0.5, 0.05, 0.05);
    const railGeomZ = new THREE.BoxGeometry(0.05, 0.05, tableSize + 0.5);

    const railX = new THREE.Mesh(railGeomX, railMaterial);
    railX.position.set(0, headHeight + 0.15, -tableSize / 2 - 0.3);
    scene.add(railX);

    const railZ = new THREE.Mesh(railGeomZ, railMaterial);
    railZ.position.set(-tableSize / 2 - 0.3, headHeight + 0.15, 0);
    scene.add(railZ);

    // === Cabezal ===
    const headGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e7eb });
    const headMesh = new THREE.Mesh(headGeometry, headMaterial);
    headMesh.position.set(0, headHeight, 0);
    scene.add(headMesh);

    // === Láser / raycasters ===
    const laserGeometry = new THREE.BufferGeometry();
    laserGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3)
    );
    const laserMaterial = new THREE.LineBasicMaterial({
      color: 0x22c55e,
      linewidth: 2,
    });
    const laserLine = new THREE.Line(laserGeometry, laserMaterial);
    scene.add(laserLine);

    const scanRaycaster = new THREE.Raycaster();
    const pointerRaycaster = new THREE.Raycaster();

    const downDir = new THREE.Vector3(0, -1, 0);

    function updateLaserLine(origin: THREE.Vector3, end: THREE.Vector3) {
      const positions = laserGeometry.attributes.position
        .array as Float32Array;
      positions[0] = origin.x;
      positions[1] = origin.y;
      positions[2] = origin.z;
      positions[3] = end.x;
      positions[4] = end.y;
      positions[5] = end.z;
      laserGeometry.attributes.position.needsUpdate = true;
    }

    async function sendSample(hitPoint: THREE.Vector3, origin: THREE.Vector3) {
      const distance = origin.distanceTo(hitPoint);
      try {
        void fetch(`${apiBase}/sample`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            x: hitPoint.x,
            y: hitPoint.y,
            z: hitPoint.z,
            distance,
          }),
        });
      } catch {
        // ignore in demo
      }
    }

    // === Escaneo raster ===
    const tableSizeScan = tableSize;
    const scanSizeX = tableSizeScan * 0.8;
    const scanSizeZ = tableSizeScan * 0.8;
    const stepsX = 80;
    const stepsZ = 80;

    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < stepsX; i++) {
      const t = i / (stepsX - 1);
      xs.push(-scanSizeX / 2 + t * scanSizeX);
    }
    for (let k = 0; k < stepsZ; k++) {
      const t = k / (stepsZ - 1);
      zs.push(-scanSizeZ / 2 + t * scanSizeZ);
    }

    let ix = 0;
    let iz = 0;
    let forward = true;
    const baseScanIntervalMs = 40;
    let sampleCounter = 0;

    const scanIntervalId = window.setInterval(() => {
      const speedFactor = Math.max(0.25, Math.min(4, headSpeedRef.current));
      const stepsPerTick = Math.max(1, Math.round(speedFactor));

      for (let step = 0; step < stepsPerTick; step++) {
        const x = xs[ix];
        const z = zs[iz];

        headMesh.position.set(x, headHeight, z);
        const origin = headMesh.position.clone();

        scanRaycaster.set(origin, downDir);
        scanRaycaster.far = headHeight + 1;

        const intersects = scanRaycaster.intersectObjects(
          raycastTargets,
          false
        );
        if (intersects.length > 0) {
          const hit = intersects[0].point;
          updateLaserLine(origin, hit);

          sampleCounter++;
          const every = Math.max(1, sampleEveryRef.current);
          if (sampleCounter % every === 0) {
            void sendSample(hit, origin);
          }
        } else {
          const end = origin
            .clone()
            .add(downDir.clone().multiplyScalar(headHeight));
          updateLaserLine(origin, end);
        }

        // serpentino
        if (forward) {
          ix++;
          if (ix >= stepsX) {
            ix = stepsX - 1;
            iz++;
            forward = false;
          }
        } else {
          ix--;
          if (ix < 0) {
            ix = 0;
            iz++;
            forward = true;
          }
        }

        if (iz >= stepsZ) {
          ix = 0;
          iz = 0;
          forward = true;
        }
      }
    }, baseScanIntervalMs);

    // === Drag & drop setup ===
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0
    let dragging = false;
    let draggedMesh: THREE.Mesh | null = null;
    let draggedObjectId: number | null = null;
    let dragOffset = new THREE.Vector3();
    let dragOriginalY = 0;

    function getIntersectionOnPlane(event: PointerEvent): THREE.Vector3 | null {
      const rect = canvas!.getBoundingClientRect();;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      pointer.x = (x / rect.width) * 2 - 1;
      pointer.y = -(y / rect.height) * 2 + 1;

      pointerRaycaster.setFromCamera(pointer, camera);
      pointerRaycaster.far = 100;

      const intersection = new THREE.Vector3();
      if (pointerRaycaster.ray.intersectPlane(dragPlane, intersection)) {
        return intersection;
      }
      return null;
    }

    async function deleteObjectById(id: number) {
      try {
        await fetch(`${apiBase}/scene/objects/${id}`, {
          method: "DELETE",
        });
      } catch {
        // ignore
      }
    }

    async function updateObjectPosition(id: number, newPos: THREE.Vector3) {
      const obj = idToObject.get(id);
      if (!obj) return;

      const payload = {
        type: obj.type,
        position: [newPos.x, newPos.y, newPos.z],
        size: obj.size,
        radius: obj.radius,
        color: obj.color,
      };

      try {
        await fetch(`${apiBase}/scene/objects/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        // ignore
      }
    }

    function onPointerDown(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      pointer.x = (x / rect.width) * 2 - 1;
      pointer.y = -(y / rect.height) * 2 + 1;

      pointerRaycaster.setFromCamera(pointer, camera);
      pointerRaycaster.far = 100;

      const intersects = pointerRaycaster.intersectObjects(objectMeshes, false);
      if (intersects.length === 0) return;

      const hit = intersects[0];
      const mesh = hit.object as THREE.Mesh;
      const objId = meshToObjectId.get(mesh);
      if (objId == null) return;

      if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        scene.remove(mesh);
        void deleteObjectById(objId);
        return;
      }

      const planeHit = getIntersectionOnPlane(event);
      if (!planeHit) return;

      event.preventDefault();
      event.stopPropagation();

      dragging = true;
      draggedMesh = mesh;
      draggedObjectId = objId;
      dragOriginalY = mesh.position.y;

      controls.enabled = false;

      dragOffset.set(
        mesh.position.x - planeHit.x,
        0,
        mesh.position.z - planeHit.z
      );
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragging || !draggedMesh) return;

      event.preventDefault();

      const planeHit = getIntersectionOnPlane(event);
      if (!planeHit) return;

      draggedMesh.position.set(
        planeHit.x + dragOffset.x,
        dragOriginalY,
        planeHit.z + dragOffset.z
      );
    }

    function onPointerUp() {
      if (!dragging || !draggedMesh || draggedObjectId == null) {
        dragging = false;
        draggedMesh = null;
        draggedObjectId = null;
        controls.enabled = true;
        return;
      }

      const finalPos = draggedMesh.position.clone();
      void updateObjectPosition(draggedObjectId, finalPos);

      dragging = false;
      draggedMesh = null;
      draggedObjectId = null;
      controls.enabled = true;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    // === Render loop ===
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    function handleResize() {
      if (!canvas) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerdown", onPointerDown);

      window.clearInterval(scanIntervalId);
      cancelAnimationFrame(animationFrameId);

      controls.dispose();
      laserGeometry.dispose();
      laserMaterial.dispose();

      objectMeshes.forEach((mesh) => {
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          (mesh.material as THREE.Material).dispose();
        }
      });

      tableGeometry.dispose();
      tableMaterial.dispose();
      railGeomX.dispose();
      railGeomZ.dispose();
      railMaterial.dispose();
      headGeometry.dispose();
      headMaterial.dispose();

      renderer.dispose();
    };
  }, [apiBase, objects]);

  // ====== UI overlay ======
  return (
    <div className="relative w-full h-full">
      <div className="absolute top-2 left-2 z-10 bg-slate-900/80 border border-slate-700 rounded-xl p-3 text-xs space-y-3 backdrop-blur">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-100">Velocidad cabezal</span>
            <span className="text-slate-300">{headSpeed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={10}
            step={0.25}
            value={headSpeed}
            onChange={(e) => setHeadSpeed(parseFloat(e.target.value))}
            className="w-48 accent-emerald-400"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-100">Muestrear cada</span>
            <span className="text-slate-300">
              {sampleEvery} paso{sampleEvery > 1 ? "s" : ""}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={sampleEvery}
            onChange={(e) => setSampleEvery(parseInt(e.target.value, 10))}
            className="w-48 accent-sky-400"
          />
        </div>

        <div className="pt-1 flex gap-2">
          <button
            type="button"
            onClick={onAddBox}
            className="px-2 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white shadow-sm"
          >
            + Caja
          </button>
          <button
            type="button"
            onClick={onAddSphere}
            className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-sm"
          >
            + Esfera
          </button>
        </div>

        <p className="text-[10px] text-slate-400 pt-1">
          Consejo: arrastra objetos con el mouse, Alt+click para eliminarlos.
        </p>
      </div>

      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};
