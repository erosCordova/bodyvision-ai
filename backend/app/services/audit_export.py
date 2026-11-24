"""Generate an authenticated, bounded audit snapshot with a delivery digest."""

import hashlib
import json
from uuid import UUID, uuid4

from fastapi import Request, Response
from sqlalchemy import text

from app.core.audit_bundle import MAX_AUDIT_BYTES, AuditBundleError, verify_audit_bundle
from app.core.errors import DomainError
from app.services.account_security import check_private_request
from app.services.admin_security import record_session_event
from app.services.auth_sessions import verified_session_digest


def export_audit(request: Request) -> Response:
    identity = check_private_request(request)
    if identity.role != "administrator":
        with request.app.state.auth_engine.begin() as connection:
            record_session_event(request, connection, "admin.audit_denied", "denied")
        raise DomainError(403, "FORBIDDEN", "Solo un administrador puede exportar la auditoría.")
    identifier = uuid4()
    with request.app.state.auth_engine.begin() as connection:
        result = connection.execute(
            text("SELECT export_private_audit_chain(CAST(:digest AS char(64)),:id,:correlation)"),
            {
                "digest": verified_session_digest(request),
                "id": identifier,
                "correlation": UUID(request.state.correlation_id),
            },
        ).scalar_one()
        state = result["status"]
        if state == "ready":
            try:
                verify_audit_bundle(result["bundle"])
                if result["bundle"]["organization_id"] != str(identity.organization_id) or result[
                    "bundle"
                ]["export_id"] != str(identifier):
                    raise AuditBundleError("Audit export scope mismatch")
            except (AuditBundleError, UnicodeError) as exc:
                # A faulty database function cannot commit a generation success.
                raise DomainError(
                    409, "AUDIT_INTEGRITY_FAILED", "La cadena no es íntegra."
                ) from exc
            body = json.dumps(result["bundle"], ensure_ascii=False, separators=(",", ":")).encode()
            if len(body) > MAX_AUDIT_BYTES:
                raise DomainError(413, "AUDIT_EXPORT_TOO_LARGE", "La auditoría supera 8 MiB.")
    # Failed integrity/size checks inside SQL commit their failure event,
    # but never deliver a partial file or a generation-success event.
    failures = {
        "unauthorized": (401, "SESSION_EXPIRED", "La sesión ya no es válida."),
        "forbidden": (403, "FORBIDDEN", "Auditoría no disponible."),
        "size-limit": (
            413,
            "AUDIT_EXPORT_TOO_LARGE",
            "La auditoría supera 10.000 eventos u 8 MiB.",
        ),
        "invalid-chain": (409, "AUDIT_INTEGRITY_FAILED", "La cadena no es íntegra; no se exportó."),
    }
    if state in failures:
        raise DomainError(*failures[state])
    if state != "ready":
        raise DomainError(503, "AUDIT_EXPORT_UNAVAILABLE", "No se pudo preparar la auditoría.")
    return Response(
        body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="bodyvision-audit-{identifier}.json"',
            "X-Content-SHA256": hashlib.sha256(body).hexdigest(),
            "Cache-Control": "no-store",
        },
    )
