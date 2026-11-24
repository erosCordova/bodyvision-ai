import hashlib
import statistics
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import text

from app.core.errors import DomainError
from app.models.context import Workspace
from app.repositories import records
from app.schemas.core import MeasurementInput


def validate(
    scope: Workspace, profile_id: UUID, data: MeasurementInput, supersedes_id: UUID | None = None
) -> None:
    current = records.profile(scope, profile_id)
    if datetime.now(UTC).year - current["birth_year"] < 18 and data.method != "manual":
        raise DomainError(
            422,
            "VALIDATION_ERROR",
            "En menores solo se admiten mediciones manuales en esta versión.",
        )
    catalog = {m["code"]: m for m in records.metrics(scope)}
    metric = catalog.get(data.metric_code)
    if metric is None:
        raise DomainError(422, "VALIDATION_ERROR", "Selecciona una métrica del catálogo.")
    if data.unit != metric["unit"] or data.method not in metric["allowed_methods"]:
        raise DomainError(422, "VALIDATION_ERROR", "Unidad o método incompatible con la métrica.")
    if not metric["min_value"] <= data.value <= metric["max_value"]:
        raise DomainError(
            422,
            "VALIDATION_ERROR",
            "El valor está fuera del rango del catálogo.",
            {"min": float(metric["min_value"]), "max": float(metric["max_value"])},
        )
    precision = max(0, min(2, int(metric["precision"])))
    if data.value != data.value.quantize(Decimal(1).scaleb(-precision)):
        raise DomainError(
            422, "VALIDATION_ERROR", "El valor excede la precisión del catálogo.",
            {"precision": precision},
        )
    if data.method == "device" and not data.instrument:
        raise DomainError(422, "VALIDATION_ERROR", "Indica el instrumento utilizado.")
    previous = [
        x for x in records.history(scope, profile_id, data.metric_code) if x["id"] != supersedes_id
    ]
    if any(x["measured_at"] == data.measured_at and x["value"] == data.value for x in previous):
        if not data.duplicate_confirmed:
            raise DomainError(
                409,
                "DUPLICATE_CONFIRMATION_REQUIRED",
                "Ya existe un registro con el mismo valor y fecha. Confirma para repetirlo.",
            )
    before = [x for x in previous if x["measured_at"] <= data.measured_at]
    flags = []
    if before and data.metric_code == "weight":
        last = before[-1]
        if data.measured_at - last["measured_at"] <= timedelta(days=1):
            if abs(float(data.value / last["value"]) - 1) > 0.1:
                flags.append("weight_change_24h")
    if len(before) >= 3:
        values = [float(x["value"]) for x in before]
        deviation = statistics.pstdev(values)
        if deviation > 0 and abs(float(data.value) - statistics.mean(values)) / deviation > 3:
            flags.append("historical_outlier")
    if flags and not data.outlier_confirmed:
        raise DomainError(
            409,
            "OUTLIER_CONFIRMATION_REQUIRED",
            "El valor es atípico frente al historial. Verifica y confirma el registro.",
            {"flags": flags},
        )


def save(
    scope: Workspace,
    profile_id: UUID,
    data: MeasurementInput,
    key: UUID,
    supersedes_id: UUID | None = None,
) -> dict:
    records.profile(scope, profile_id, write=True)
    endpoint = f"measurement:{profile_id}:{supersedes_id or 'new'}"
    payload = hashlib.sha256(data.model_dump_json().encode()).hexdigest()
    conn = scope.connection
    # Serialize retries and concurrent submissions for the same idempotency key.
    lock_key = f"{scope.organization_id}:{scope.actor_id}:{key}"
    conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": lock_key})
    existing = (
        conn.execute(
            text("""SELECT * FROM idempotency_keys
        WHERE organization_id=:org AND user_id=:actor AND key=:key"""),
            {"org": scope.organization_id, "actor": scope.actor_id, "key": key},
        )
        .mappings()
        .first()
    )
    if existing:
        if existing["endpoint"] != endpoint or existing["request_hash"] != payload:
            raise DomainError(409, "CONFLICT", "La clave de envío ya se utilizó con otros datos.")
        return records.measurement(scope, existing["measurement_id"])
    if supersedes_id:
        old = records.measurement(scope, supersedes_id, lock=True)
        if not old["is_current"]:
            raise DomainError(
                409, "CONFLICT", "Esta versión ya fue corregida. Actualiza el historial."
            )
        if old["metric_code"] != data.metric_code:
            raise DomainError(422, "VALIDATION_ERROR", "La corrección debe conservar la métrica.")
    validate(scope, profile_id, data, supersedes_id)
    identifier = uuid4()
    params = data.model_dump(exclude={"duplicate_confirmed"})
    params.update(
        id=identifier,
        org=scope.organization_id,
        profile=profile_id,
        actor=scope.actor_id,
        supersedes=supersedes_id,
        correction_reason=getattr(data, "correction_reason", None),
    )
    conn.execute(
        text("""INSERT INTO measurements
        (id,organization_id,profile_id,metric_code,value,unit,measured_at,method,instrument,
         notes,created_by,supersedes_id,correction_reason,outlier_confirmed)
        VALUES (:id,:org,:profile,:metric_code,:value,:unit,:measured_at,:method,:instrument,
                :notes,:actor,:supersedes,:correction_reason,:outlier_confirmed)"""),
        params,
    )
    conn.execute(
        text("""INSERT INTO idempotency_keys
        (key,organization_id,user_id,endpoint,request_hash,measurement_id)
        VALUES (:key,:org,:actor,:endpoint,:hash,:id)"""),
        {
            "key": key,
            "org": scope.organization_id,
            "actor": scope.actor_id,
            "endpoint": endpoint,
            "hash": payload,
            "id": identifier,
        },
    )
    return records.measurement(scope, identifier)


def derived(scope: Workspace, profile_id: UUID, as_of: datetime | None = None) -> list[dict]:
    as_of = as_of or datetime.now(UTC)
    rows = [x for x in records.history(scope, profile_id) if x["measured_at"] <= as_of]
    latest = {x["metric_code"]: x for x in rows}
    outputs = []
    for code, label, a, b, unit, formula in [
        ("bmi", "IMC", "weight", "height", "kg/m²", "peso_kg / (estatura_cm / 100)²"),
        ("waist_hip", "Cintura / cadera", "waist", "hip", "razón", "cintura_cm / cadera_cm"),
        (
            "waist_height",
            "Cintura / estatura",
            "waist",
            "height",
            "razón",
            "cintura_cm / estatura_cm",
        ),
    ]:
        first, second = latest.get(a), latest.get(b)
        value, reason, sources = None, None, []
        if not first or not second:
            reason = "Faltan mediciones observadas de referencia."
        elif second["value"] <= 0:
            reason = "El denominador debe ser mayor que cero."
        elif code == "waist_hip" and abs(first["measured_at"] - second["measured_at"]) > timedelta(
            days=7
        ):
            reason = "Cintura y cadera deben registrarse dentro de una ventana de 7 días."
        else:
            denominator = (second["value"] / 100) ** 2 if code == "bmi" else second["value"]
            value = round(float(first["value"] / denominator), 3)
            sources = [first["id"], second["id"]]
        outputs.append(
            dict(
                metric_code=code,
                label=label,
                value=value,
                unit=unit,
                formula=formula,
                source_measurement_ids=sources,
                as_of=as_of,
                reason=reason,
                data_type="DERIVADO",
            )
        )
    return outputs
