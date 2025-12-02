# main.py
from typing import List, Optional
from enum import Enum

from fastapi import FastAPI, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel, Field

from laser_service import (
    LaserDemoService,
    LaserDemoConfig,
    ObjectType,
    SceneObjectBase,
    SceneObject,
)


app = FastAPI(title="LaserMapper3D Demo API")

# CORS para el frontend (ajusta origin para producción)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # p.ej. ["http://localhost:5173"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Instancia del servicio core
# =========================

service = LaserDemoService(
    LaserDemoConfig(
        units="meters",
        cell_size=0.02,
        base_height_percentile=0.15,
        base_distance_threshold=0.01,
        cluster_radius=0.08,
        min_samples=5,
        with_default_scene=True,
    )
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = (BASE_DIR / "static").resolve()

# =========================
# Pydantic models (solo para API)
# =========================

class ObjectTypeAPI(str, Enum):
    box = "box"
    sphere = "sphere"


class SceneObjectBaseAPI(BaseModel):
    type: ObjectTypeAPI
    position: List[float] = Field(..., min_items=3, max_items=3)
    size: Optional[List[float]] = Field(
        None, min_items=3, max_items=3, description="Box size [sx, sy, sz]"
    )
    radius: Optional[float] = Field(
        None, description="Sphere radius (for type='sphere')"
    )
    color: Optional[str] = Field(
        "#3b82f6", description="Hex color for visualization"
    )


class SceneObjectAPI(SceneObjectBaseAPI):
    id: int


class SampleIn(BaseModel):
    x: float
    y: float
    z: float
    distance: float


class PointOut(BaseModel):
    x: float
    y: float
    z: float
    distance: float


class PointCloudOut(BaseModel):
    units: str
    points: List[PointOut]


class SegmentedPointOut(BaseModel):
    x: float
    y: float
    z: float
    distance: float
    label: int  # 0 = base, 1..N = object id


class ObjectInfoOut(BaseModel):
    label: int
    num_points: int
    bbox_min: List[float]
    bbox_max: List[float]


class PlaneOut(BaseModel):
    normal: List[float]
    d: float


class SegmentationResultOut(BaseModel):
    units: str
    points: List[SegmentedPointOut]
    objects: List[ObjectInfoOut]
    plane: Optional[PlaneOut]


# =========================
# Root
# =========================

def _api_overview():
    return {
        "message": "LaserMapper3D Demo API (FastAPI adapter)",
        "endpoints": [
            "/sample",
            "/samples",
            "/pointcloud/json",
            "/pointcloud/ply",
            "/pointcloud (DELETE)",
            "/demo/random-cloud",
            "/pointcloud/segments",
            "/scene/objects",
            "/scene/reset",
        ],
    }


# =========================
# Scene object endpoints
# =========================

@app.get("/scene/objects", response_model=List[SceneObjectAPI])
def list_scene_objects():
    """Devuelve los objetos de escena actuales."""
    objs = service.list_objects()
    return [
        SceneObjectAPI(
            id=o.id,
            type=ObjectTypeAPI(o.type.value),
            position=o.position,
            size=o.size,
            radius=o.radius,
            color=o.color,
        )
        for o in objs
    ]


@app.post("/scene/objects", response_model=SceneObjectAPI)
def create_scene_object(obj: SceneObjectBaseAPI):
    """
    Crea un nuevo objeto de escena.
    """
    core_obj = SceneObjectBase(
        type=ObjectType(obj.type.value),
        position=list(obj.position),
        size=list(obj.size) if obj.size is not None else None,
        radius=obj.radius,
        color=obj.color,
    )
    created = service.create_object(core_obj)
    return SceneObjectAPI(
        id=created.id,
        type=ObjectTypeAPI(created.type.value),
        position=created.position,
        size=created.size,
        radius=created.radius,
        color=created.color,
    )


@app.put("/scene/objects/{object_id}", response_model=SceneObjectAPI)
def update_scene_object(object_id: int, obj: SceneObjectBaseAPI):
    """
    Actualiza un objeto de escena existente.
    """
    core_obj = SceneObjectBase(
        type=ObjectType(obj.type.value),
        position=list(obj.position),
        size=list(obj.size) if obj.size is not None else None,
        radius=obj.radius,
        color=obj.color,
    )
    try:
        updated = service.update_object(object_id, core_obj)
    except KeyError:
        raise HTTPException(status_code=404, detail="Scene object not found")

    return SceneObjectAPI(
        id=updated.id,
        type=ObjectTypeAPI(updated.type.value),
        position=updated.position,
        size=updated.size,
        radius=updated.radius,
        color=updated.color,
    )


@app.delete("/scene/objects/{object_id}")
def delete_scene_object(object_id: int):
    """
    Elimina un objeto de escena.
    """
    try:
        service.delete_object(object_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Scene object not found")
    return {"status": "deleted", "id": object_id}


@app.post("/scene/reset")
def reset_scene():
    """
    Resetea la escena demo y limpia el pointcloud.
    """
    service.reset_scene_and_cloud()
    return {"status": "scene_reset_and_cloud_cleared"}


# =========================
# Point cloud endpoints
# =========================

@app.post("/sample", response_model=PointOut)
def add_sample(sample: SampleIn):
    """
    Añade una sola medición (real o simulada).
    """
    p = service.add_sample(sample.x, sample.y, sample.z, sample.distance)
    return PointOut(**p)


@app.post("/samples", response_model=PointCloudOut)
def add_samples(samples: List[SampleIn]):
    """
    Añade varias mediciones a la vez y devuelve el mapa actual.
    """
    data = service.add_samples([s.dict() for s in samples])
    return PointCloudOut(
        units=data["units"],
        points=[PointOut(**p) for p in data["points"]],
    )


@app.get("/pointcloud/json", response_model=PointCloudOut)
def get_pointcloud_json():
    """
    Devuelve el mapa actual en JSON.
    """
    data = service.get_pointcloud_dict()
    return PointCloudOut(
        units=data["units"],
        points=[PointOut(**p) for p in data["points"]],
    )


@app.get("/pointcloud/ply")
def get_pointcloud_ply():
    """
    Devuelve el mapa actual como PLY ASCII.
    """
    ply_text = service.get_pointcloud_ply()
    return Response(content=ply_text, media_type="text/plain")


@app.delete("/pointcloud")
def clear_pointcloud():
    """
    Limpia el mapa actual (todas las celdas).
    """
    service.clear_pointcloud()
    return {"status": "cleared"}


@app.post("/demo/random-cloud", response_model=PointCloudOut)
def demo_random_cloud(n: int = 1000):
    """
    Genera una nube aleatoria (no ligadas a la escena física).
    """
    data = service.demo_random_cloud(n)
    return PointCloudOut(
        units=data["units"],
        points=[PointOut(**p) for p in data["points"]],
    )


# =========================
# Point cloud analysis
# =========================

@app.get("/pointcloud/segments", response_model=SegmentationResultOut)
def get_pointcloud_segments():
    """
    Analiza el mapa actual usando pointcloud_analysis.py (versión anterior).

    - Estima plano base.
    - Clasifica base vs objetos.
    - Clusteriza objetos.
    """
    analysis = service.analyze_pointcloud()
    units = analysis.get("units", "meters")
    plane = analysis.get("plane", None)
    objects = analysis.get("objects", [])
    points = analysis.get("points", [])

    plane_out: Optional[PlaneOut]
    if plane is None:
        plane_out = None
    else:
        plane_out = PlaneOut(
            normal=list(plane["normal"]),
            d=float(plane["d"]),
        )

    points_out = [
        SegmentedPointOut(
            x=float(p["x"]),
            y=float(p["y"]),
            z=float(p["z"]),
            distance=float(p["distance"]),
            label=int(p["label"]),
        )
        for p in points
    ]

    objects_out = [
        ObjectInfoOut(
            label=int(o["label"]),
            num_points=int(o["num_points"]),
            bbox_min=list(o["bbox_min"]),
            bbox_max=list(o["bbox_max"]),
        )
        for o in objects
    ]

    return SegmentationResultOut(
        units=units,
        points=points_out,
        objects=objects_out,
        plane=plane_out,
    )


@app.get("/api", tags=["meta"])
def read_root():
    return _api_overview()


if FRONTEND_DIST.exists():
    frontend_assets = FRONTEND_DIST / "assets"
    if frontend_assets.exists():
        app.mount("/assets", StaticFiles(directory=frontend_assets), name="assets")

    @app.get("/", include_in_schema=False)
    def serve_spa_index():
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa_catch_all(full_path: str):
        candidate = (FRONTEND_DIST / full_path).resolve()
        try:
            candidate.relative_to(FRONTEND_DIST)
        except ValueError:
            return FileResponse(FRONTEND_DIST / "index.html")

        if candidate.is_file():
            return FileResponse(candidate)

        return FileResponse(FRONTEND_DIST / "index.html")
else:
    @app.get("/")
    def serve_api_overview():
        return _api_overview()
