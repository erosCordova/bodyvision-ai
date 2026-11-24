"""Minimal fictional browser reports; never accept media or landmark coordinates."""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator

from app.schemas.core import StrictInput

MODEL_REVISION = "pose_landmarker_lite/float16/1"
ALGORITHM_REVISION = "pose-review-summary-v1"


class PoseSummaryInput(StrictInput):
    model_revision: Literal["pose_landmarker_lite/float16/1"]
    detected: StrictBool
    threshold: Decimal = Field(
        ge=Decimal("0.3"), le=Decimal("0.9"), decimal_places=3, allow_inf_nan=False
    )
    visible_points: int = Field(strict=True, ge=0, le=33)
    core_visible: int = Field(strict=True, ge=0, le=8)
    quality_state: Literal["not-detected", "insufficient", "caution", "reviewable"]
    capture_passed: StrictBool
    synthetic_confirmed: StrictBool

    @field_validator("synthetic_confirmed")
    @classmethod
    def confirmed(cls, value):
        if not value:
            raise ValueError("Explicit fictional confirmation required")
        return value

    @model_validator(mode="after")
    def coherent_counts(self):
        if self.core_visible > self.visible_points:
            raise ValueError("Core points cannot exceed visible points")
        if not self.detected:
            if self.visible_points or self.core_visible or self.quality_state != "not-detected":
                raise ValueError("No detection requires empty counts")
        elif self.quality_state == "not-detected":
            raise ValueError("Detected result cannot be not-detected")
        if self.quality_state == "reviewable" and (
            not self.capture_passed or self.core_visible != 8 or self.visible_points < 20
        ):
            raise ValueError("Inconsistent reviewable summary")
        return self


class PoseSummaryRead(BaseModel):
    id: UUID
    profile_id: UUID
    created_by: UUID
    created_at: datetime
    model_revision: str
    algorithm_revision: str
    detected: bool
    threshold: float
    visible_points: int
    core_visible: int
    quality_state: str
    capture_passed: bool
    summary_sha256: str
    origin: Literal["client_reported_browser"] = "client_reported_browser"
    data_type: Literal["DERIVADO"] = "DERIVADO"
    synthetic: Literal[True] = True


class PoseSummaryList(BaseModel):
    items: list[PoseSummaryRead]
    total: int
    limit: int
    offset: int
