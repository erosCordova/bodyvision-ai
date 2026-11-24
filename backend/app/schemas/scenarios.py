"""Strict, synthetic-only, append-only 3D simulation scenario contracts."""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.core import StrictInput

# Keep the original pinned licensed atlas; do not accept arbitrary uploaded models.
ATLAS_REVISION = "28912432581accd7a1c62129d55f0e9758221d48"
ALGORITHM_REVISION = "regional-soft-tissue-v2"


class ScenarioInput(StrictInput):
    reference_kg: Decimal = Field(ge=40, le=200, max_digits=5, decimal_places=1)
    variation_percent: int = Field(ge=-30, le=30)
    stature_cm: int = Field(ge=145, le=205)
    prior_version_id: UUID | None = None
    revision_note: str | None = Field(default=None, min_length=5, max_length=200)

    @model_validator(mode="after")
    def revision_chain(self) -> "ScenarioInput":
        if (self.prior_version_id is None) != (self.revision_note is None):
            raise ValueError("A revised scenario requires a previous version and reason")
        return self


class ScenarioRead(BaseModel):
    id: UUID
    profile_id: UUID
    series_id: UUID
    version: int
    prior_version_id: UUID | None
    reference_kg: float
    variation_percent: int
    stature_cm: int
    simulated_kg: float
    model_revision: str
    algorithm_revision: str
    revision_note: str | None
    created_by: UUID
    created_at: datetime
    data_type: Literal["SIMULADO"] = "SIMULADO"


class ScenarioList(BaseModel):
    items: list[ScenarioRead]
    total: int
    limit: int
    offset: int
    # Consistent high-watermark for paginated fictitious-history exports.
    # Demo remains empty and does not advertise a PostgreSQL snapshot.
    snapshot_at: datetime | None = None
