"""Bounded synthetic PNG inference using the pinned MediaPipe model, without disk images."""

import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from app.services.synthetic_capture_png import validate_synthetic_png

MODEL_SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
MODEL_REVISION = "pose_landmarker_lite/float16/1"


class PoseResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    detected: StrictBool
    visible_points: int = Field(ge=0, le=33)
    model_sha256: Literal[
        "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"
    ] = MODEL_SHA256
    model_revision: Literal["pose_landmarker_lite/float16/1"] = MODEL_REVISION

    @model_validator(mode="after")
    def coherent(self):
        if not self.detected and self.visible_points != 0:
            raise ValueError("No detection must have zero visible points")
        return self


def summarize_landmarks(landmarks) -> PoseResult:
    if not landmarks:
        return PoseResult(detected=False, visible_points=0)
    points = landmarks[0]
    if len(points) != 33:
        raise ValueError("Unexpected landmark count")
    for point in points:
        if not all(math.isfinite(v) for v in (point.x, point.y, point.z, point.visibility)):
            raise ValueError("Non-finite landmark")
    visible = sum(0 <= p.x <= 1 and 0 <= p.y <= 1 and p.visibility >= 0.5 for p in points)
    return PoseResult(detected=visible > 0, visible_points=visible)


def verified_model(path: Path) -> bytes:
    with path.open("rb") as model:
        data = model.read(12_000_001)
    if not 1_000_000 <= len(data) <= 12_000_000:
        raise ValueError("Unexpected model size")
    if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise ValueError("Model checksum mismatch")
    return data


def infer_png(payload: bytes, model_path: Path) -> PoseResult:
    # Optional native dependencies are installed only in the separate worker.
    # Never use fake predictions if the model or runtime is unavailable.
    from io import BytesIO

    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    from PIL import Image

    validate_synthetic_png(payload)
    model = verified_model(model_path)
    with Image.open(BytesIO(payload)) as image:
        rgb = np.asarray(image.convert("RGB")).copy()
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_buffer=model),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=1,
    )
    with vision.PoseLandmarker.create_from_options(options) as detector:
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    return summarize_landmarks(result.pose_landmarks)


def run_inference(payload: bytes, model_path: Path) -> PoseResult:
    validate_synthetic_png(payload)
    verified_model(model_path)
    result = subprocess.run(
        [sys.executable, "-m", "app.services.server_pose_inference", str(model_path)],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=45,
        check=True,
    )
    if len(result.stdout) > 1024:
        raise ValueError("Unexpected model output")
    return PoseResult.model_validate_json(result.stdout)


if __name__ == "__main__":
    data = sys.stdin.buffer.read(262_145)
    output = infer_png(data, Path(sys.argv[1]))
    sys.stdout.write(json.dumps(output.model_dump()))
