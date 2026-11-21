import pytest
from pydantic import ValidationError

from app.schemas.pose_summaries import PoseSummaryInput

VALID = dict(
    model_revision="pose_landmarker_lite/float16/1",
    detected=True,
    threshold=0.5,
    visible_points=25,
    core_visible=8,
    quality_state="reviewable",
    capture_passed=True,
    synthetic_confirmed=True,
)


@pytest.mark.parametrize(
    "patch",
    [
        {"photo": "unwanted"},
        {"landmarks": [{"x": 0.5}]},
        {"notes": "person name"},
        {"visible_points": 34},
        {"visible_points": True},
        {"core_visible": 9},
        {"visible_points": 7},
        {"threshold": float("nan")},
        {"threshold": 0.95},
        {"model_revision": "untrusted-model"},
        {"synthetic_confirmed": False},
        {"synthetic_confirmed": 1},
        {"detected": False},
        {"capture_passed": False},
        {"quality_state": "clinical-diagnosis"},
    ],
)
def test_summary_rejects_media_identifiers_bad_counts_and_unconfirmed_data(patch):
    with pytest.raises(ValidationError):
        PoseSummaryInput(**{**VALID, **patch})


def test_valid_negative_result_remains_distinct_from_missing_or_failed_inference():
    value = PoseSummaryInput(
        **{
            **VALID,
            "detected": False,
            "visible_points": 0,
            "core_visible": 0,
            "quality_state": "not-detected",
        }
    )
    assert value.detected is False and value.visible_points == 0
    assert set(value.model_dump()) == set(VALID)
