import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

type SegmentedPoint = {
  x: number;
  y: number;
  z: number;
  distance: number;
  label: number; // 0 = base, 1..N = objeto
};

type ObjectInfo = {
  label: number;
  num_points: number;
  bbox_min: number[];
  bbox_max: number[];
};

type PlaneInfo = {
  normal: number[];
  d: number;
};

type SegmentationResponse = {
  units: string;
  points: SegmentedPoint[];
  objects: ObjectInfo[];
  plane: PlaneInfo | null;
};

interface ViewerProps {
  apiBase: string;
}

/**
 * PointCloudViewer
 *
 * - Consume /pointcloud/segments
 * - Pinta cada punto según su label:
 *   - 0 => base (mesa)
 *   - 1..N => objetos individuales (colores distintos)
 */
export const PointCloudViewer: React.FC<ViewerProps> = ({ apiBase }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // === Setup básico de Three.js ===
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#020617");

    const camera = new THREE.PerspectiveCamera(
      50,
      canvas.clientWidth / canvas.clientHeight,
      0.01,
      1000
    );
    camera.position.set(3, 3, 3);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    // Luces
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(4, 5, 3);
    scene.add(directional);

    // Grid opcional (como referencia global)
    const grid = new THREE.GridHelper(4, 16, 0x111827, 0x020617);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = -1;
    scene.add(grid);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // === Geometría de la nube de puntos ===
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      size: 0.04,
      sizeAttenuation: true,
      vertexColors: true, // usamos colores por vértice
    });
    const pointsMesh = new THREE.Points(geometry, material);
    scene.add(pointsMesh);

    // Paleta de colores para los labels (base + objetos)
    const baseColor = new THREE.Color("#1e293b"); // mesa
    const palette = [
      new THREE.Color("#ef4444"), // objeto 1 (rojo)
      new THREE.Color("#22c55e"), // objeto 2 (verde)
      new THREE.Color("#3b82f6"), // objeto 3 (azul)
      new THREE.Color("#eab308"), // objeto 4 (amarillo)
      new THREE.Color("#a855f7"), // objeto 5 (morado)
      new THREE.Color("#06b6d4"), // objeto 6 (cyan)
      new THREE.Color("#f97316"), // objeto 7 (naranja)
    ];

    function getColorForLabel(label: number): THREE.Color {
      if (label <= 0) {
        return baseColor;
      }
      const idx = (label - 1) % palette.length;
      return palette[idx];
    }

    // === Fetch de la nube segmentada ===
    async function fetchSegments() {
      try {
        const res = await fetch(`${apiBase}/pointcloud/segments`);
        if (!res.ok) return;

        const data: SegmentationResponse = await res.json();
        const pts = data.points;
        if (!pts || pts.length === 0) {
          geometry.setAttribute(
            "position",
            new THREE.BufferAttribute(new Float32Array(), 3)
          );
          geometry.setAttribute(
            "color",
            new THREE.BufferAttribute(new Float32Array(), 3)
          );
          geometry.computeBoundingSphere();
          return;
        }

        const positions = new Float32Array(pts.length * 3);
        const colors = new Float32Array(pts.length * 3);

        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const idx3 = i * 3;

          positions[idx3 + 0] = p.x;
          positions[idx3 + 1] = p.y;
          positions[idx3 + 2] = p.z;

          const c = getColorForLabel(p.label);
          c.toArray(colors, idx3);
        }

        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(positions, 3)
        );
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.computeBoundingSphere();
      } catch {
        // ignorar errores de red en demo
      }
    }

    // Primer fetch inmediato
    fetchSegments();
    // Polling cada 1s
    const intervalId = window.setInterval(fetchSegments, 1000);

    // === Loop de render ===
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
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

    // Cleanup al desmontar
    return () => {
      window.removeEventListener("resize", handleResize);
      window.clearInterval(intervalId);
      cancelAnimationFrame(animationFrameId);

      controls.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [apiBase]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};
