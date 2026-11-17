from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProfileInput(StrictInput):
    birth_year: int = Field(ge=1900)
    display_name: str | None = Field(default=None, max_length=100)
    sex: Literal["female", "male", "other"] | None = None

    @field_validator("birth_year")
    @classmethod
    def valid_year(cls, value: int) -> int:
        if value > datetime.now(UTC).year:
            raise ValueError("Birth year cannot be in the future")
        return value


class ProfileUpdate(StrictInput):
    display_name: str | None = Field(default=None, max_length=100)
    status: Literal["active", "restricted"] | None = None


class ProfileRead(BaseModel):
    id: UUID
    organization_id: UUID
    display_code: str
    display_name: str | None
    birth_year: int
    sex: str | None
    status: str
    created_at: datetime
    synthetic: bool = True


class ProfileList(BaseModel):
    items: list[ProfileRead]
    total: int
    limit: int
    offset: int


class MetricRead(BaseModel):
    code: str
    label: str
    unit: str
    min_value: float
    max_value: float
    allowed_methods: list[str]
    precision: int
    instructions: str


class MeasurementInput(StrictInput):
    metric_code: str = Field(min_length=1, max_length=40)
    value: Decimal = Field(allow_inf_nan=False, max_digits=8, decimal_places=2)
    unit: str = Field(max_length=10)
    measured_at: AwareDatetime
    method: Literal["manual", "device"]
    instrument: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)
    outlier_confirmed: bool = False
    duplicate_confirmed: bool = False

    @field_validator("measured_at")
    @classmethod
    def not_future(cls, value: datetime) -> datetime:
        if value > datetime.now(UTC):
            raise ValueError("Future measurements are not allowed")
        return value


class CorrectionInput(MeasurementInput):
    correction_reason: str = Field(min_length=5, max_length=500)


class MeasurementRead(BaseModel):
    id: UUID
    profile_id: UUID
    metric_code: str
    value: float
    unit: str
    measured_at: datetime
    method: Literal["manual", "device"]
    instrument: str | None
    notes: str | None
    created_by: UUID
    responsible: str
    created_at: datetime
    supersedes_id: UUID | None
    correction_reason: str | None
    is_current: bool
    outlier_confirmed: bool
    data_type: Literal["OBSERVADO"] = "OBSERVADO"


class MeasurementList(BaseModel):
    items: list[MeasurementRead]
    total: int
    limit: int
    offset: int


class DerivedRead(BaseModel):
    metric_code: str
    label: str
    value: float | None
    unit: str
    formula: str
    source_measurement_ids: list[UUID]
    as_of: datetime
    reason: str | None
    data_type: Literal["DERIVADO"] = "DERIVADO"
