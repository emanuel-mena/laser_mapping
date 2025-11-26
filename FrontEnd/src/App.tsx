// src/App.tsx
import React, { useState } from "react";
import { SimulationScene } from "./SimulationScene";
import { PointCloudViewer } from "./PointCloudViewer";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

export default function App() {
  const [status, setStatus] = useState<string>("Ready.");

  async function handleClear() {
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
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">LaserMapper3D Sandbox</h1>
          <p className="text-xs text-slate-400">
            Virtual raycasting scene ➜ FastAPI mapper ➜ 3D point cloud viewer
          </p>
        </div>

        {/* Controls */}
        <div className="flex gap-3">
          <button
            onClick={handleGenerateDemo}
            className="px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-medium"
          >
            Generate random cloud
          </button>
          <button
            onClick={handleClear}
            className="px-4 py-2 rounded-md bg-red-500 hover:bg-red-400 text-slate-900 text-sm font-medium"
          >
            Clear cloud
          </button>
        </div>
      </header>

      {/* STATUS */}
      <div className="px-6 py-2 border-b border-slate-800 text-xs text-slate-300">
        <span className="font-semibold text-slate-200">Status:</span> {status}
      </div>

      {/* MAIN LAYOUT */}
      <main className="flex-1 flex flex-col md:flex-row gap-4 p-4">

        {/* ===== ZONA A - SIMULATION SCENE ===== */}
        <section className="flex-1 flex flex-col">
          <h2 className="text-sm font-semibold mb-2 text-slate-200">
            Virtual scene & laser simulation
          </h2>
          <div className="flex-1 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
            <SimulationScene apiBase={API_BASE} />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            The simulated laser rotates and raycasts against the virtual objects,
            sending measurements to <code>/sample</code>.
          </p>
        </section>

        {/* ===== ZONA B - BACKEND POINT CLOUD VIEWER ===== */}
        <section className="flex-1 flex flex-col">
          <h2 className="text-sm font-semibold mb-2 text-slate-200">
            Reconstructed point cloud (from backend)
          </h2>
          <div className="flex-1 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
            <PointCloudViewer apiBase={API_BASE} />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            This viewer polls <code>/pointcloud/json</code> every second.
          </p>
        </section>
      </main>
    </div>
  );
}
