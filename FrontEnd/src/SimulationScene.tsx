// src/SimulationScene.tsx
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

interface SimulationSceneProps {
    apiBase: string;
}

/**
 * SimulationScene
 *
 * Simula una máquina tipo pick & place con un láser:
 * - El láser está montado en la "cabeza" de la máquina, apuntando SIEMPRE hacia abajo (eje -Y).
 * - La cabeza se mueve en un patrón de escaneo sobre la mesa (X/Z).
 * - En cada paso se hace raycasting hacia abajo y se manda la medición al backend (/sample).
 */
export const SimulationScene: React.FC<SimulationSceneProps> = ({ apiBase }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // === Three.js básico ===
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

        // Luces
        const ambient = new THREE.AmbientLight(0xffffff, 0.45);
        scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(4, 6, 3);
        scene.add(directional);

        // Orbit controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // === Mesa (plano) en Y = 0 ===
        const tableSize = 4;
        const tableGeometry = new THREE.PlaneGeometry(tableSize, tableSize);
        const tableMaterial = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            side: THREE.DoubleSide,
            metalness: 0.1,
            roughness: 0.8,
        });
        const tableMesh = new THREE.Mesh(tableGeometry, tableMaterial);
        tableMesh.rotation.x = -Math.PI / 2; // plano XZ
        tableMesh.position.y = 0;
        scene.add(tableMesh);

        // Grid helper sobre la mesa
        const grid = new THREE.GridHelper(tableSize, 16, 0x111827, 0x020617);
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.7;
        grid.position.y = 0.001;
        scene.add(grid);

        // === "Piezas" sobre la mesa ===
        const objects: THREE.Object3D[] = [];

        const box1 = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.6, 0.8),
            new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
        );
        box1.position.set(0.8, 0.3, 0.2); // altura = half-height
        scene.add(box1);
        objects.push(box1);

        const box2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.9, 0.5),
            new THREE.MeshStandardMaterial({ color: 0xf97316 })
        );
        box2.position.set(-0.7, 0.45, -0.9);
        scene.add(box2);
        objects.push(box2);

        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 32, 32),
            new THREE.MeshStandardMaterial({
                color: 0x22c55e,
                metalness: 0.2,
                roughness: 0.3,
            })
        );
        sphere.position.set(0.0, 0.4, 1.0);
        scene.add(sphere);
        objects.push(sphere);

        // También queremos que el raycast pueda pegar la mesa si no hay pieza
        objects.push(tableMesh);

        // === Cabezal de la máquina (donde está el láser) ===
        const headHeight = 2.0; // altura fija sobre la mesa
        const headGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const headMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e7eb });
        const headMesh = new THREE.Mesh(headGeometry, headMaterial);
        headMesh.position.set(0, headHeight, 0);
        scene.add(headMesh);

        // Rieles simples para dar sensación de máquina (opcional)
        const railMaterial = new THREE.MeshStandardMaterial({ color: 0x64748b });
        const railGeomX = new THREE.BoxGeometry(tableSize + 0.5, 0.05, 0.05);
        const railGeomZ = new THREE.BoxGeometry(0.05, 0.05, tableSize + 0.5);

        const railX = new THREE.Mesh(railGeomX, railMaterial);
        railX.position.set(0, headHeight + 0.15, -tableSize / 2 - 0.3);
        scene.add(railX);

        const railZ = new THREE.Mesh(railGeomZ, railMaterial);
        railZ.position.set(-tableSize / 2 - 0.3, headHeight + 0.15, 0);
        scene.add(railZ);

        // === Láser: línea desde el cabezal hacia abajo ===
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

        // === Raycaster: SIEMPRE apuntando hacia abajo ===
        const raycaster = new THREE.Raycaster();
        const downDir = new THREE.Vector3(0, -1, 0);

        async function sendSample(hitPoint: THREE.Vector3, origin: THREE.Vector3) {
            const distance = origin.distanceTo(hitPoint); // distancia real cabezal→impacto

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
                // ignoramos errores en demo
            }
        }

        // === Patrón de escaneo: raster sobre la mesa ===
        const scanSizeX = tableSize * 0.8; // escanear un poco dentro de los bordes
        const scanSizeZ = tableSize * 0.8;
        const stepsX = 80;
        const stepsZ = 80;
        const scanIntervalMs = 30; // o mantener 40, como prefieras


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
        let forward = true; // para serpentine

        const scanIntervalId = window.setInterval(() => {
            const x = xs[ix];
            const z = zs[iz];

            // Mover el cabezal de la máquina
            headMesh.position.set(x, headHeight, z);

            const origin = headMesh.position.clone();

            // Raycast hacia abajo
            raycaster.set(origin, downDir);
            raycaster.far = headHeight + 1; // suficiente para llegar a la mesa

            const intersects = raycaster.intersectObjects(objects, false);
            if (intersects.length > 0) {
                const hit = intersects[0].point;
                updateLaserLine(origin, hit);
                void sendSample(hit, origin);
            } else {
                // Por si acaso no pega nada, dibujamos hasta la mesa teórica
                const end = origin.clone().add(downDir.clone().multiplyScalar(headHeight));
                updateLaserLine(origin, end);
            }

            // Avanzar en el patrón "serpentino"
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
                // Llegamos al final del escaneo: reiniciar desde el inicio
                ix = 0;
                iz = 0;
                forward = true;
            }
        }, scanIntervalMs);

        // === Loop de render ===
        let animationFrameId: number;
        const animate = () => {
            animationFrameId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Resize
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
            window.clearInterval(scanIntervalId);
            cancelAnimationFrame(animationFrameId);

            controls.dispose();
            laserGeometry.dispose();
            laserMaterial.dispose();

            [box1, box2, sphere, tableMesh].forEach((mesh) => {
                mesh.geometry.dispose();
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((m) => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            });

            headGeometry.dispose();
            headMaterial.dispose();
            railGeomX.dispose();
            railGeomZ.dispose();
            railMaterial.dispose();

            renderer.dispose();
        };
    }, [apiBase]);

    return <canvas ref={canvasRef} className="w-full h-full block" />;
};
