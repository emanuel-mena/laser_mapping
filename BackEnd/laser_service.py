# laser_service.py
from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import List, Dict, Any, Optional, Tuple

from laser_mapper import LaserMapper3D
from pointcloud_analysis import PointCloudAnalyzer


# =========================
# Scene object domain models
# =========================

class ObjectType(str, Enum):
    box = "box"
    sphere = "sphere"


@dataclass
class SceneObjectBase:
    type: ObjectType
    position: List[float]  # [x, y, z]
    size: Optional[List[float]] = None  # [sx, sy, sz] para box
    radius: Optional[float] = None      # para sphere
    color: str = "#3b82f6"


@dataclass
class SceneObject(SceneObjectBase):
    id: int = 0


@dataclass
class LaserDemoConfig:
    units: str = "meters"
    cell_size: float = 0.02  # debe coincidir con tu resolución de escaneo
    # Parámetros del analizador original
    base_height_percentile: float = 0.15
    base_distance_threshold: float = 0.01
    cluster_radius: float = 0.08
    min_samples: int = 5
    # ¿crear escena por defecto al inicio?
    with_default_scene: bool = True


class LaserDemoService:
    """
    Servicio de alto nivel para demo de mapeo láser.

    - Mantiene:
      * LaserMapper3D (heightmap last-sample-per-cell).
      * PointCloudAnalyzer (tu versión anterior, sin cambios).
      * Lista de objetos de escena (box/sphere).

    - No sabe nada de FastAPI ni Pydantic.
    - Se puede usar desde:
      * CLI,
      * scripts,
      * otros backends (FastAPI, Flask, etc.).
    """

    def __init__(
        self,
        config: Optional[LaserDemoConfig] = None,
        mapper: Optional[LaserMapper3D] = None,
        analyzer: Optional[PointCloudAnalyzer] = None,
    ) -> None:
        self.config = config or LaserDemoConfig()

        # Core: mapper
        self.mapper: LaserMapper3D = mapper or LaserMapper3D(
            units=self.config.units,
            cell_size=self.config.cell_size,
        )

        # Core: analyzer (usamos tu implementación existente)
        self.analyzer: PointCloudAnalyzer = analyzer or PointCloudAnalyzer(
            base_height_percentile=self.config.base_height_percentile,
            base_distance_threshold=self.config.base_distance_threshold,
            cluster_radius=self.config.cluster_radius,
            min_samples=self.config.min_samples,
        )

        # Escena
        self._scene_objects: List[SceneObject] = []
        self._next_object_id: int = 1

        if self.config.with_default_scene:
            self.reset_scene_objects_to_default()

    # =========================
    # Scene management (reusable)
    # =========================

    @property
    def scene_objects(self) -> List[SceneObject]:
        # devolvemos una copia superficial para no romper encapsulamiento
        return list(self._scene_objects)

    def _create_scene_object_internal(self, base: SceneObjectBase) -> SceneObject:
        obj = SceneObject(
            id=self._next_object_id,
            type=base.type,
            position=list(base.position),
            size=list(base.size) if base.size is not None else None,
            radius=base.radius,
            color=base.color,
        )
        self._next_object_id += 1
        self._scene_objects.append(obj)
        return obj

    def reset_scene_objects_to_default(self) -> None:
        """Recrea una escena demo por defecto (sin tocar el pointcloud)."""
        self._scene_objects = []
        self._next_object_id = 1

        # Box 1
        self._create_scene_object_internal(
            SceneObjectBase(
                type=ObjectType.box,
                position=[0.8, 0.3, 0.2],
                size=[0.8, 0.6, 0.8],
                color="#3b82f6",
            )
        )

        # Box 2
        self._create_scene_object_internal(
            SceneObjectBase(
                type=ObjectType.box,
                position=[-0.7, 0.45, -0.9],
                size=[0.5, 0.9, 0.5],
                color="#f97316",
            )
        )

        # Sphere
        self._create_scene_object_internal(
            SceneObjectBase(
                type=ObjectType.sphere,
                position=[0.0, 0.4, 1.0],
                radius=0.4,
                color="#22c55e",
            )
        )

    # --- CRUD escena ---

    def list_objects(self) -> List[SceneObject]:
        return self.scene_objects

    def create_object(self, base: SceneObjectBase) -> SceneObject:
        return self._create_scene_object_internal(base)

    def update_object(self, object_id: int, base: SceneObjectBase) -> SceneObject:
        for i, existing in enumerate(self._scene_objects):
            if existing.id == object_id:
                updated = SceneObject(
                    id=object_id,
                    type=base.type,
                    position=list(base.position),
                    size=list(base.size) if base.size is not None else None,
                    radius=base.radius,
                    color=base.color,
                )
                self._scene_objects[i] = updated
                return updated
        raise KeyError(f"Scene object {object_id} not found")

    def delete_object(self, object_id: int) -> None:
        new_list = [o for o in self._scene_objects if o.id != object_id]
        if len(new_list) == len(self._scene_objects):
            raise KeyError(f"Scene object {object_id} not found")
        self._scene_objects = new_list

    def reset_scene_and_cloud(self) -> None:
        """Resetea escena demo y borra el mapa de puntos."""
        self.reset_scene_objects_to_default()
        self.mapper.clear()

    # =========================
    # Mapping / pointcloud API
    # =========================

    def clear_pointcloud(self) -> None:
        self.mapper.clear()

    def add_sample(self, x: float, y: float, z: float, distance: float) -> Dict[str, float]:
        """Añade una muestra y devuelve un dict simple."""
        self.mapper.add_sample(x, y, z, distance)
        return {"x": x, "y": y, "z": z, "distance": distance}

    def add_samples(self, samples: List[Dict[str, float]]) -> Dict[str, Any]:
        """Añade varias muestras (lista de dicts con x,y,z,distance) y devuelve el mapa actual."""
        for s in samples:
            self.mapper.add_sample(
                float(s["x"]),
                float(s["y"]),
                float(s["z"]),
                float(s["distance"]),
            )
        return self.get_pointcloud_dict()

    def get_pointcloud_dict(self) -> Dict[str, Any]:
        """Devuelve el mapa actual como dict {'units','cell_size','points':[...] }."""
        return self.mapper.to_dict()

    def get_pointcloud_ply(self) -> str:
        """Devuelve el mapa actual como PLY ASCII."""
        return self.mapper.to_ply()

    def demo_random_cloud(self, n: int = 1000) -> Dict[str, Any]:
        """Genera una nube aleatoria para demo (no está ligada a la escena)."""
        import random

        self.mapper.clear()
        for _ in range(n):
            x = random.uniform(-1.0, 1.0)
            y = random.uniform(-1.0, 1.0)
            z = random.uniform(-1.0, 1.0)
            distance = (x**2 + y**2 + z**2) ** 0.5
            self.mapper.add_sample(x, y, z, distance)

        return self.get_pointcloud_dict()

    # =========================
    # Analysis (usa pointcloud_analysis.py original)
    # =========================

    def analyze_pointcloud(self) -> Dict[str, Any]:
        """
        Corre el analizador sobre el mapa actual.

        Returns
        -------
        dict con:
        - units
        - points: [{'x','y','z','distance','label'}, ...]
        - objects: [{'label','num_points','bbox_min','bbox_max'}, ...]
        - plane: {'normal':[nx,ny,nz], 'd': d} | None
        """
        data = self.mapper.to_dict()
        units = data["units"]
        raw_points = data["points"]

        analysis = self.analyzer.analyze(raw_points)
        analysis["units"] = units
        return analysis
