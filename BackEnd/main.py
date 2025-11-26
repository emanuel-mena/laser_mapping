# main.py
from typing import List, Optional
from enum import Enum
import random

from fastapi import FastAPI, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from laser_mapper import LaserMapper3D
from pointcloud_analysis import PointCloudAnalyzer


app = FastAPI(title="LaserMapper3D Demo API")

# CORS para el frontend (ajusta origin en producción)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ej: ["http://localhost:5173"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Core: mapper + analyzer
# =========================

# Mapa 2.5D por celdas XZ, memoria acotada
mapper = LaserMapper3D(
    units="meters",
    cell_size=0.02,  # resolución XY; ajustable según tu máquina
)

analyzer = PointCloudAnalyzer(
    base_height_percentile=0.15,
    base_distance_threshold=0.01,
    cluster_radius=0.08,
    min_samples=5,
)

# =========================
# Scene object models
# =========================

class ObjectType(str, Enum):
    box = "box"
    sphere = "sphere"


class SceneObjectBase(BaseModel):
    type: ObjectType
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


class SceneObject(SceneObjectBase):
    id: int


scene_objects: List[SceneObject] = []
next_object_id: int = 1


def _create_scene_object(data: SceneObjectBase) -> SceneObject:
    global next_object_id, scene_objects
    obj = SceneObject(id=next_object_id, **data.dict())
    next_object_id += 1
    scene_objects.append(obj)
    return obj


def init_default_scene() -> None:
    """Optional: default virtual objects on startup."""
    global scene_objects, next_object_id
    scene_objects = []
    next_object_id = 1

    # Box 1
    _create_scene_object(
        SceneObjectBase(
            type=ObjectType.box,
            position=[0.8, 0.3, 0.2],
            size=[0.8, 0.6, 0.8],
            color="#3b82f6",
        )
    )

    # Box 2
    _create_scene_object(
        SceneObjectBase(
            type=ObjectType.box,
            position=[-0.7, 0.45, -0.9],
            size=[0.5, 0.9, 0.5],
            color="#f97316",
        )
    )

    # Sphere
    _create_scene_object(
        SceneObjectBase(
            type=ObjectType.sphere,
            position=[0.0, 0.4, 1.0],
            radius=0.4,
            color="#22c55e",
        )
    )


init_default_scene()

# =========================
# Pointcloud models
# =========================

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

@app.get("/")
def read_root():
    return {
        "message": "LaserMapper3D Demo API",
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

@app.get("/scene/objects", response_model=List[SceneObject])
def list_scene_objects():
    """
    Return all virtual scene objects (boxes, spheres, etc.).
    """
    return scene_objects


@app.post("/scene/objects", response_model=SceneObject)
def create_scene_object(obj: SceneObjectBase):
    """
    Create a new scene object.

    Nota:
    - NO limpiamos el mapa aquí; el mapa se actualiza cuando el láser
      vuelve a escanear la zona y sobreescribe las celdas relevantes.
    """
    return _create_scene_object(obj)


@app.put("/scene/objects/{object_id}", response_model=SceneObject)
def update_scene_object(object_id: int, obj: SceneObjectBase):
    """
    Update an existing scene object (replace all fields except id).

    Igual que create: el mapa se actualiza de forma natural con el
    siguiente escaneo.
    """
    for i, existing in enumerate(scene_objects):
        if existing.id == object_id:
            updated = SceneObject(id=object_id, **obj.dict())
            scene_objects[i] = updated
            return updated
    raise HTTPException(status_code=404, detail="Scene object not found")


@app.delete("/scene/objects/{object_id}")
def delete_scene_object(object_id: int):
    """
    Delete a scene object.

    El mapa se corregirá cuando el láser vuelva a pasar por esas celdas
    y registre la nueva geometría (por ejemplo, la mesa).
    """
    global scene_objects
    new_list = [o for o in scene_objects if o.id != object_id]
    if len(new_list) == len(scene_objects):
        raise HTTPException(status_code=404, detail="Scene object not found")
    scene_objects = new_list
    return {"status": "deleted", "id": object_id}


@app.post("/scene/reset")
def reset_scene():
    """
    Reset scene objects to default and clear the point cloud entirely.
    """
    init_default_scene()
    mapper.clear()
    return {"status": "scene_reset_and_cloud_cleared"}


# =========================
# Point cloud endpoints
# =========================

@app.post("/sample", response_model=PointOut)
def add_sample(sample: SampleIn):
    """
    Add a single measurement (from real hardware or simulation).

    LaserMapper3D:
    - Cuantiza X/Z a una celda.
    - Actualiza el punto representativo de esa celda (promedio).
    """
    mapper.add_sample(sample.x, sample.y, sample.z, sample.distance)
    return PointOut(**sample.dict())


@app.post("/samples", response_model=PointCloudOut)
def add_samples(samples: List[SampleIn]):
    """
    Add multiple measurements at once.
    """
    for s in samples:
        mapper.add_sample(s.x, s.y, s.z, s.distance)
    return get_pointcloud_json()


@app.get("/pointcloud/json", response_model=PointCloudOut)
def get_pointcloud_json():
    """
    Return the current point cloud as JSON.

    - Devuelve un punto representativo por celda XZ.
    - No hay duplicados masivos ni "historial infinito".
    """
    data = mapper.to_dict()
    return PointCloudOut(
        units=data["units"],
        points=[
            PointOut(
                x=p["x"],
                y=p["y"],
                z=p["z"],
                distance=p["distance"],
            )
            for p in data["points"]
        ],
    )


@app.get("/pointcloud/ply")
def get_pointcloud_ply():
    """
    Return the current point cloud as ASCII PLY (plain text).
    """
    ply_text = mapper.to_ply()
    return Response(content=ply_text, media_type="text/plain")


@app.delete("/pointcloud")
def clear_pointcloud():
    """
    Clear the current map completely.
    """
    mapper.clear()
    return {"status": "cleared"}


@app.post("/demo/random-cloud", response_model=PointCloudOut)
def demo_random_cloud(n: int = 1000):
    """
    Fill the mapper with N random points for demo purposes.

    Como es una demo artificial, aquí sí hacemos clear.
    """
    mapper.clear()
    for _ in range(n):
        x = random.uniform(-1.0, 1.0)
        y = random.uniform(-1.0, 1.0)
        z = random.uniform(-1.0, 1.0)
        distance = (x**2 + y**2 + z**2) ** 0.5
        mapper.add_sample(x, y, z, distance)

    return get_pointcloud_json()


# =========================
# Point cloud analysis
# =========================

@app.get("/pointcloud/segments", response_model=SegmentationResultOut)
def get_pointcloud_segments():
    """
    Analyze the current point cloud:

    - Estimate base plane
    - Classify base vs objects
    - Cluster objects
    """
    data = mapper.to_dict()
    units = data["units"]
    raw_points = data["points"]

    analysis = analyzer.analyze(raw_points)

    plane = analysis["plane"]
    if plane is None:
        plane_out = None
    else:
        plane_out = PlaneOut(
            normal=plane["normal"],
            d=plane["d"],
        )

    points_out = [SegmentedPointOut(**p) for p in analysis["points"]]

    objects_out = [
        ObjectInfoOut(
            label=o["label"],
            num_points=o["num_points"],
            bbox_min=list(o["bbox_min"]),
            bbox_max=list(o["bbox_max"]),
        )
        for o in analysis["objects"]
    ]

    return SegmentationResultOut(
        units=units,
        points=points_out,
        objects=objects_out,
        plane=plane_out,
    )
