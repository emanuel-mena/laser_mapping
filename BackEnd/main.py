# main.py
from typing import List, Optional

import random
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from laser_mapper import LaserMapper3D
from pointcloud_analysis import PointCloudAnalyzer


app = FastAPI(title="LaserMapper3D Demo API")

# CORS for local frontend dev; tighten in production if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # e.g. ["http://localhost:5173"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global mapper and analyzer instances
mapper = LaserMapper3D(units="meters")
analyzer = PointCloudAnalyzer(
    base_height_percentile=0.15,    # usa 15% de puntos más bajos para el plano
    base_distance_threshold=0.01,   # plano un poco más estricto
    cluster_radius=0.08,            # radio para DBSCAN en XZ
    min_samples=5,                  # mínimo vecinos para formar objeto
)

# =========================
# Pydantic models
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
# Basic endpoints
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
        ],
    }


@app.post("/sample", response_model=PointOut)
def add_sample(sample: SampleIn):
    """
    Add a single measurement (from real hardware or simulation).
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
    """
    data = mapper.to_dict()
    return PointCloudOut(
        units=data["units"],
        points=[PointOut(**p) for p in data["points"]],
    )


@app.get("/pointcloud/ply")
def get_pointcloud_ply():
    """
    Return the current point cloud as ASCII PLY (plain text).
    Useful to download and open in external 3D tools (CloudCompare, MeshLab, etc.).
    """
    ply_text = mapper.to_ply()
    return Response(content=ply_text, media_type="text/plain")


@app.delete("/pointcloud")
def clear_pointcloud():
    """
    Clear all stored samples in the mapper.
    """
    mapper.clear()
    return {"status": "cleared"}


# =========================
# Demo helpers
# =========================

@app.post("/demo/random-cloud", response_model=PointCloudOut)
def demo_random_cloud(n: int = 1000):
    """
    Fill the mapper with N random points for demo purposes.
    Points are placed inside a cube [-1, 1]^3.
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
# Point cloud analysis / "tiny ML"
# =========================

@app.get("/pointcloud/segments", response_model=SegmentationResultOut)
def get_pointcloud_segments():
    """
    Analyze the current point cloud:

    - Estimate a dominant base plane (the table).
    - Classify points into base vs objects.
    - Cluster non-base points into individual objects (1..N).
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

    points_out = [
        SegmentedPointOut(**p)
        for p in analysis["points"]
    ]

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
