# pointcloud_analysis.py
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple
import numpy as np
from sklearn.cluster import DBSCAN


@dataclass
class SegmentedPoint:
    x: float
    y: float
    z: float
    distance: float
    label: int  # 0 = base, 1..N = object id


@dataclass
class ObjectInfo:
    label: int
    num_points: int
    bbox_min: Tuple[float, float, float]
    bbox_max: Tuple[float, float, float]


class PointCloudAnalyzer:
    """
    Tiny ML-style analyzer for a 3D point cloud:

    - Estimate a dominant plane (the table/base).
    - Classify points: base vs objects on top.
    - Cluster object points using a simple DBSCAN algorithm
      in the XZ plane.
    """

    def __init__(
        self,
        base_height_percentile: float = 0.15,
        base_distance_threshold: float = 0.01,
        cluster_radius: float = 0.08,
        min_samples: int = 5,
    ) -> None:
        """
        Parameters
        ----------
        base_height_percentile : float
            Fraction of lowest points in Y used to estimate the base plane (0..1).
        base_distance_threshold : float
            Threshold (in same units as coordinates) to classify a point as base.
        cluster_radius : float
            Maximum distance (in XZ) between two points to be in the same cluster.
        min_samples : int
            Minimum number of neighbors (including the point itself) to form a cluster.
        """
        self.base_height_percentile = base_height_percentile
        self.base_distance_threshold = base_distance_threshold
        self.cluster_radius = cluster_radius
        self.min_samples = min_samples

    # ----------------------------- Public API -----------------------------

    def analyze(self, points: List[Dict[str, float]]) -> Dict[str, Any]:
        """
        Analyze a point cloud.

        Parameters
        ----------
        points : list of dicts with keys {"x", "y", "z", "distance"}

        Returns
        -------
        dict with:
        - "points": list of SegmentedPoint (as dicts)
        - "objects": list of ObjectInfo (as dicts)
        - "plane": {"normal": [nx, ny, nz], "d": d}
        """
        if not points:
            return {"points": [], "objects": [], "plane": None}

        xyz = np.array([[p["x"], p["y"], p["z"]] for p in points], dtype=np.float32)

        # 1) Estimate base plane
        normal, d = self._fit_base_plane(xyz)
        distances_to_plane = self._point_plane_distance(xyz, normal, d)

        # 2) Classify base vs non-base
        is_base = np.abs(distances_to_plane) < self.base_distance_threshold
        labels = np.zeros(len(points), dtype=np.int32)  # 0 = base; >0 = object id

        # 3) Clustering of non-base points
        non_base_idx = np.where(~is_base)[0]
        if len(non_base_idx) > 0:
            object_labels = self._cluster_objects_dbscan(xyz[non_base_idx])
            # Shift labels starting at 1
            object_labels = object_labels + 1
            labels[non_base_idx] = object_labels

        # 4) Pack results
        segmented_points: List[SegmentedPoint] = [
            SegmentedPoint(
                x=float(points[i]["x"]),
                y=float(points[i]["y"]),
                z=float(points[i]["z"]),
                distance=float(points[i]["distance"]),
                label=int(labels[i]),
            )
            for i in range(len(points))
        ]

        objects_info = self._compute_object_info(xyz, labels)

        return {
            "points": [sp.__dict__ for sp in segmented_points],
            "objects": [oi.__dict__ for oi in objects_info],
            "plane": {
                "normal": [float(normal[0]), float(normal[1]), float(normal[2])],
                "d": float(d),
            },
        }

    # ----------------------- Plane estimation -----------------------------

    def _fit_base_plane(self, xyz: np.ndarray) -> Tuple[np.ndarray, float]:
        """
        Fit a plane to the lowest subset of points in Y.
        Plane equation: n · x + d = 0
        """
        y = xyz[:, 1]
        threshold = np.quantile(y, self.base_height_percentile)
        mask = y <= threshold
        subset = xyz[mask]

        if subset.shape[0] < 3:
            subset = xyz

        centroid = subset.mean(axis=0)
        centered = subset - centroid
        _, _, vh = np.linalg.svd(centered, full_matrices=False)
        normal = vh[-1]

        # Make normal point upwards-ish
        if normal[1] < 0:
            normal = -normal

        d = -np.dot(normal, centroid)
        return normal, d

    def _point_plane_distance(
        self, xyz: np.ndarray, normal: np.ndarray, d: float
    ) -> np.ndarray:
        """
        Signed distance from each point to the plane n·x + d = 0.
        """
        return xyz.dot(normal) + d

    # -------------------- Object clustering (DBSCAN) ----------------------

    def _cluster_objects_dbscan(self, xyz_obj: np.ndarray) -> np.ndarray:
        """
        Clustering using scikit-learn DBSCAN on the XZ plane.

        Returns
        -------
        labels : np.ndarray of shape (N,), int32
            Cluster label per point, in 0..K, where:
            - 0: "unclassified / noise"
            - 1..K: cluster ids
        """
        N = xyz_obj.shape[0]
        if N == 0:
            return np.zeros(0, dtype=np.int32)

        # Use only XZ for footprint clustering
        coords = xyz_obj[:, [0, 2]]

        db = DBSCAN(
            eps=self.cluster_radius,
            min_samples=self.min_samples,
            metric="euclidean",
            n_jobs=-1,  # use all available cores
        ).fit(coords)

        labels = db.labels_.astype(np.int32)
        # scikit-learn uses -1 for noise; map it to 0
        labels[labels < 0] = 0

        return labels

    # -------------------- Object info (bbox, etc.) ------------------------

    def _compute_object_info(
        self, xyz: np.ndarray, labels: np.ndarray
    ) -> List[ObjectInfo]:
        """
        Compute per-object info (excluding label 0, which is the base).
        """
        objects: List[ObjectInfo] = []
        unique_labels = sorted(set(labels.tolist()))
        for lab in unique_labels:
            if lab == 0:
                continue
            mask = labels == lab
            pts = xyz[mask]
            if pts.shape[0] == 0:
                continue
            min_xyz = pts.min(axis=0)
            max_xyz = pts.max(axis=0)
            objects.append(
                ObjectInfo(
                    label=int(lab),
                    num_points=int(pts.shape[0]),
                    bbox_min=(float(min_xyz[0]), float(min_xyz[1]), float(min_xyz[2])),
                    bbox_max=(float(max_xyz[0]), float(max_xyz[1]), float(max_xyz[2])),
                )
            )
        return objects
