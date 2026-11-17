from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.engine import Connection

FIRST_WORKSPACE = UUID("10000000-0000-4000-8000-000000000001")
SECOND_WORKSPACE = UUID("10000000-0000-4000-8000-000000000002")


@dataclass(frozen=True)
class Workspace:
    connection: Connection
    organization_id: UUID
    actor_id: UUID
