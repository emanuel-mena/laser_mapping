// src/App.tsx
import { useEffect, useState } from "react";
import { SimulationScene } from "./SimulationScene";
import { PointCloudViewer } from "./PointCloudViewer";

const API_BASE = import.meta.env.VITE_API_BASE || window.location.origin;

export type SceneObjectType = "box" | "sphere";

export type SceneObject = {
  id: number;
  type: SceneObjectType;
  position: [number, number, number];
  size?: [number, number, number];
  radius?: number;
  color?: string;
};

export default function App() {
  const [status, setStatus] = useState<string>("Ready.");
  const [sceneObjects, setSceneObjects] = useState<SceneObject[]>([]);

  // =========================
  // Scene objects helpers
  // =========================
  async function refreshSceneObjects() {
    try {
      const res = await fetch(`${API_BASE}/scene/objects`);
      if (!res.ok) throw new Error("Failed to fetch scene objects");
      const data: SceneObject[] = await res.json();
      setSceneObjects(data);
    } catch (err: any) {
      setStatus(`Error loading scene objects: ${err.message}`);
    }
  }

  useEffect(() => {
    void refreshSceneObjects();
  }, []);

  async function handleAddBox() {
    try {
      const body = {
        type: "box",
        position: [0.8, 0.3, 0.2],
        size: [0.8, 0.6, 0.8],
        color: "#3b82f6",
      };
      const res = await fetch(`${API_BASE}/scene/objects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create box");
      await refreshSceneObjects();
      setStatus("Box added to scene.");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function handleAddSphere() {
    try {
      const body = {
        type: "sphere",
        position: [0.0, 0.4, 1.0],
        radius: 0.4,
        color: "#22c55e",
      };
      const res = await fetch(`${API_BASE}/scene/objects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create sphere");
      await refreshSceneObjects();
      setStatus("Sphere added to scene.");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function handleResetScene() {
    try {
      const res = await fetch(`${API_BASE}/scene/reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to reset scene");
      await refreshSceneObjects();
      setStatus("Scene reset and cloud cleared.");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }

  // =========================
  // Point cloud helpers
  // =========================
  async function handleClearCloud() {
    try {
      await fetch(`${API_BASE}/pointcloud`, { method: "DELETE" });
      setStatus("Point cloud cleared.");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function handleGenerateDemo() {
    try {
      const res = await fetch(`${API_BASE}/demo/random-cloud?n=2000`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to generate demo cloud.");
      const data = await res.json();
      setStatus(`Generated demo cloud with ${data.points.length} points.`);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* HEADER */}
      <header className="border-b border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">LaserMapper3D Sandbox</h1>
          <p className="text-xs text-slate-400">
            Pick &amp; place head (downward laser) ➜ FastAPI mapper ➜ ML segmentation
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={handleAddBox}
            className="px-3 py-2 rounded-md bg-slate-700 hover:bg-slate-600"
          >
            + Box
          </button>
          <button
            onClick={handleAddSphere}
            className="px-3 py-2 rounded-md bg-slate-700 hover:bg-slate-600"
          >
            + Sphere
          </button>
          <button
            onClick={handleResetScene}
            className="px-3 py-2 rounded-md bg-slate-700 hover:bg-slate-600"
          >
            Reset scene
          </button>
          <button
            onClick={handleGenerateDemo}
            className="px-3 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-medium"
          >
            Demo cloud
          </button>
          <button
            onClick={handleClearCloud}
            className="px-3 py-2 rounded-md bg-red-500 hover:bg-red-400 text-slate-900 font-medium"
          >
            Clear cloud
          </button>
        </div>
      </header>

      {/* STATUS */}
      <div className="px-6 py-2 border-b border-slate-800 text-xs text-slate-300 flex justify-between gap-2">
        <span>
          <span className="font-semibold text-slate-200">Status:</span> {status}
        </span>
        <span className="hidden sm:inline text-slate-500">
          API: <code className="text-emerald-300">{API_BASE}</code>
        </span>
      </div>

      {/* MAIN – SOLO DOS PANELES */}
      <main className="flex-1 flex flex-col md:flex-row gap-4 p-4">
        {/* Panel izquierdo: simulación */}
        <section className="flex-1 flex flex-col">
          <h2 className="text-sm font-semibold mb-2 text-slate-200">
            Virtual scene &amp; laser simulation
          </h2>
          <div className="flex-1 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
            <SimulationScene
              apiBase={API_BASE}
              objects={sceneObjects}
              onAddBox={handleAddBox}
              onAddSphere={handleAddSphere}
            />

          </div>
          <p className="mt-2 text-xs text-slate-400">
            Drag &amp; drop objects with the mouse (XZ plane).
            <br />
            <span className="text-slate-500">
              Alt + click on an object to delete it.
            </span>
          </p>
        </section>

        {/* Panel derecho: viewer */}
        <section className="flex-1 flex flex-col">
          <h2 className="text-sm font-semibold mb-2 text-slate-200">
            Reconstructed point cloud
          </h2>
          <div className="flex-1 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
            <PointCloudViewer apiBase={API_BASE} />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Viewer uses <code>/pointcloud/segments</code> (base + clustered objects).
          </p>
        </section>
      </main>
    </div>
  );
}
