from types import SimpleNamespace

import pytest

from app.services.server_pose_inference import PoseResult, summarize_landmarks, verified_model


def test_landmark_summary_keeps_only_counts_and_model_provenance():
    points = [SimpleNamespace(x=0.5, y=0.5, z=0.0, visibility=0.8) for _ in range(33)]
    points[0].x = 2.0
    result = summarize_landmarks([points])
    assert result.detected and result.visible_points == 32
    assert set(result.model_dump()) == {
        "detected", "visible_points", "model_sha256", "model_revision"
    }
    assert not summarize_landmarks([]).detected
    points[1].z = float("nan")
    with pytest.raises(ValueError):
        summarize_landmarks([points])
    with pytest.raises(ValueError):
        PoseResult(detected=False, visible_points=1)


def test_modified_model_is_rejected(tmp_path):
    model = tmp_path / "pose.task"
    model.write_bytes(b"x" * 1_000_000)
    with pytest.raises(ValueError, match="checksum"):
        verified_model(model)
