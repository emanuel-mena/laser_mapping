# Laser Mapping Demo

A sample application that pairs a FastAPI backend with a React/Three.js frontend to explore 3D laser mapping. The backend exposes an API to manage synthetic scene objects, ingest or generate point clouds, and run basic segmentation over the cloud. The frontend uses Vite and Tailwind to visualize the simulated environment and interact with the API.

## Repository structure
- `BackEnd/` – FastAPI service wrapping the `LaserDemoService` for managing scene objects, point clouds, and segmentation.
- `FrontEnd/` – React + TypeScript client built with Vite that renders the scene/point cloud and issues API calls.
- `LICENSE` – License for this repository.

## Prerequisites
- Python 3.10+ with `pip`
- Node.js 18+ with `npm`

## Backend setup (FastAPI)
1. Create and activate a virtual environment (recommended).
2. Install dependencies:
   ```bash
   pip install -r BackEnd/requirements.txt
   ```
3. Start the API server from the `BackEnd` directory:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
4. Visit the interactive docs at `http://localhost:8000/docs` to try the endpoints.

## Frontend setup (Vite + React)
1. Install dependencies inside `FrontEnd`:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev -- --host
   ```
3. Open the URL shown in the terminal (e.g., `http://localhost:5173`).

### Frontend configuration
Set `VITE_API_BASE` in a `.env` file within `FrontEnd/` to point the UI to your API (by default it uses the same origin as the served page). Example for local dev:
```env
VITE_API_BASE=http://localhost:8000
```

If no variable is provided, the frontend falls back to the same origin where it is served, which is convenient when the SPA is hosted by FastAPI in production.

## Single-service container (FastAPI + Vite build)
The root `DockerFile` builds the React app and bundles it alongside the FastAPI backend so it can run as a single service (e.g., on Railway):

```bash
docker build -t laser-mapping .
docker run -p 8000:8000 laser-mapping
```

The image installs the backend dependencies, builds the frontend (outputting directly to `BackEnd/static/`), and serves those files through FastAPI. Railway will inject the `PORT` environment variable automatically, so no extra configuration is required to expose both the API and the static assets from one container.

## Key API endpoints
- `GET /scene/objects` – List current scene objects.
- `POST /scene/objects` – Create a box or sphere in the scene.
- `PUT /scene/objects/{id}` / `DELETE /scene/objects/{id}` – Update or remove a scene object.
- `POST /scene/reset` – Restore the default demo scene and clear identifiers.
- `POST /sample` / `POST /samples` – Submit individual or batched laser samples to the mapper.
- `GET /pointcloud/json` / `GET /pointcloud/ply` – Export the accumulated point cloud.
- `DELETE /pointcloud` – Clear the current point cloud.
- `POST /demo/random-cloud` – Generate a random demo point cloud for testing.
- `GET /pointcloud/segments` – Run segmentation and return labels, bounding boxes, and the fitted plane.

## Development notes
- The backend wraps `LaserMapper3D` and `PointCloudAnalyzer` to keep domain logic separate from the FastAPI layer.
- The frontend bundles components like `SimulationScene` and `PointCloudViewer` to render scene objects and labeled point clouds in-browser.
- Adjust the CORS configuration in `BackEnd/main.py` if deploying beyond local development.

## License
This project is licensed under the terms of the included `LICENSE` file.
