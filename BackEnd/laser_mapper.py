# laser_mapper.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, Any, List, Tuple
import time
import math


@dataclass
class CellSample:
    """
    Representa la ÚLTIMA muestra vista en una celda XZ.
    No se promedia: la última medición manda.
    """
    x: float
    y: float
    z: float
    distance: float
    timestamp: float


class LaserMapper3D:
    """
    LaserMapper3D v4 (last-sample-per-cell heightmap)

    - El espacio XZ se discretiza en celdas de tamaño `cell_size`.
    - Para cada celda, guardamos SOLO la última medición que el láser ha visto ahí.
    - Cuando el entorno cambia y el láser reescanea:
        * la celda se actualiza al nuevo valor (piso u otro objeto),
        * desaparecen "objetos fantasma" sin necesidad de limpiar todo.
    - Memoria O(#celdas), no O(#muestras).
    """

    def __init__(
        self,
        units: str = "meters",
        cell_size: float = 0.02,
    ) -> None:
        """
        Parameters
        ----------
        units : str
            Descripción de unidades (ej: "meters").
        cell_size : float
            Tamaño de celda en el plano XZ. Define la resolución espacial.
        """
        self.units = units
        self.cell_size = cell_size

        # Mapa: (ix, iz) -> CellSample
        self._cells: Dict[Tuple[int, int], CellSample] = {}

    # -----------------------------
    # Helpers de grilla
    # -----------------------------

    def _cell_index(self, x: float, z: float) -> Tuple[int, int]:
        ix = math.floor(x / self.cell_size)
        iz = math.floor(z / self.cell_size)
        return ix, iz

    def clear(self) -> None:
        """Borra el mapa completo."""
        self._cells.clear()

    # -----------------------------
    # API de escritura
    # -----------------------------

    def add_sample(self, x: float, y: float, z: float, distance: float) -> None:
        """
        Registra una muestra en la celda correspondiente.

        - Cuantizamos (x, z) a una celda (ix, iz).
        - Guardamos SOLO esta muestra como la última vista en esa celda
          (sobrescribe cualquier valor anterior).
        """
        ix, iz = self._cell_index(x, z)
        key = (ix, iz)

        self._cells[key] = CellSample(
            x=x,
            y=y,
            z=z,
            distance=distance,
            timestamp=time.time(),
        )

    # -----------------------------
    # API de lectura
    # -----------------------------

    def to_dict(self) -> Dict[str, Any]:
        """
        Devuelve el mapa actual como un dict con un punto por celda.

        Formato:
        {
          "units": "...",
          "cell_size": ...,
          "points": [
            { "x": ..., "y": ..., "z": ..., "distance": ... },
            ...
          ]
        }
        """
        pts: List[Dict[str, float]] = []
        for cell in self._cells.values():
            pts.append(
                {
                    "x": cell.x,
                    "y": cell.y,
                    "z": cell.z,
                    "distance": cell.distance,
                }
            )

        return {
            "units": self.units,
            "cell_size": self.cell_size,
            "points": pts,
        }

    def to_ply(self) -> str:
        """
        Exporta el mapa actual como un archivo PLY ASCII.

        - Un vértice por celda (última medición).
        """
        points = [
            {
                "x": cell.x,
                "y": cell.y,
                "z": cell.z,
                "distance": cell.distance,
            }
            for cell in self._cells.values()
        ]
        n = len(points)

        header = [
            "ply",
            "format ascii 1.0",
            f"comment units={self.units}",
            f"comment cell_size={self.cell_size}",
            f"element vertex {n}",
            "property float x",
            "property float y",
            "property float z",
            "property float distance",
            "end_header",
        ]

        lines: List[str] = []
        for p in points:
            lines.append(f"{p['x']} {p['y']} {p['z']} {p['distance']}")

        return "\n".join(header + lines) + "\n"
