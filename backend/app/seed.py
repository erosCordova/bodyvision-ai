"""Explicit, repeatable fictional fixtures. Never called during API startup."""

import os
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import create_engine, text


def seed_database(url: str) -> int:
    if os.environ.get("APP_ENV", "local") not in {"local", "test"}:
        raise RuntimeError("Synthetic fixtures are local/test only")
    engine = create_engine(url, hide_parameters=True)
    count = 0
    with engine.begin() as conn:
        for suffix in ["1", "2"]:
            org = UUID("10000000-0000-4000-8000-00000000000" + suffix)
            actor = UUID("20000000-0000-4000-8000-00000000000" + suffix)
            for number in range(1, 6):
                key = f"bodyvision:fixture:{org}:{number}"
                profile = uuid5(NAMESPACE_URL, key)
                if conn.execute(
                    text("SELECT 1 FROM profiles WHERE id=:id"), {"id": profile}
                ).first():
                    continue
                conn.execute(
                    text("""INSERT INTO profiles
                    (id,organization_id,display_code,display_name,birth_year,created_by)
                    VALUES (:id,:org,:code,:name,:birth,:actor)"""),
                    {
                        "id": profile,
                        "org": org,
                        "actor": actor,
                        "code": f"FICT-{number:02d}",
                        "name": f"Expediente ficticio {number:02d}",
                        "birth": 1990 + number,
                    },
                )
                conn.execute(
                    text("""INSERT INTO profile_access
                    (id,organization_id,profile_id,user_id,access_level)
                    VALUES (:id,:org,:profile,:actor,'manage')"""),
                    {
                        "id": uuid5(NAMESPACE_URL, key + ":access"),
                        "org": org,
                        "profile": profile,
                        "actor": actor,
                    },
                )
                for index, days in enumerate([150, 120, 90, 60, 30, 1]):
                    if number == 3 and days in [60, 30]:
                        continue
                    timestamp = datetime.now(UTC) - timedelta(days=days)
                    for metric, value, unit in [
                        ("weight", 70 + number - index * 0.3, "kg"),
                        ("height", 165 + number, "cm"),
                        ("waist", 82 + number - index * 0.2, "cm"),
                        ("hip", 95 + number, "cm"),
                    ]:
                        identifier = uuid5(NAMESPACE_URL, key + ":" + metric + ":" + str(index))
                        conn.execute(
                            text("""INSERT INTO measurements
                            (id,organization_id,profile_id,metric_code,value,unit,measured_at,
                             method,created_by) VALUES
                            (:id,:org,:profile,:metric,:value,:unit,:at,'manual',:actor)"""),
                            {
                                "id": identifier,
                                "org": org,
                                "profile": profile,
                                "metric": metric,
                                "value": value,
                                "unit": unit,
                                "at": timestamp,
                                "actor": actor,
                            },
                        )
                        if number == 2 and index == 0 and metric == "weight":
                            conn.execute(
                                text("""INSERT INTO measurements
                                (id,organization_id,profile_id,metric_code,value,unit,measured_at,
                                 method,created_by,supersedes_id,correction_reason)
                                VALUES (:id,:org,:profile,'weight',:value,'kg',:at,'manual',:actor,
                                :old,'Corrección ficticia de transcripción')"""),
                                {
                                    "id": uuid5(NAMESPACE_URL, key + ":correction"),
                                    "org": org,
                                    "profile": profile,
                                    "value": value - 0.2,
                                    "at": timestamp,
                                    "actor": actor,
                                    "old": identifier,
                                },
                            )
                if number == 1:
                    conn.execute(
                        text("""INSERT INTO measurements
                        (id,organization_id,profile_id,metric_code,value,unit,measured_at,
                         method,created_by,outlier_confirmed,notes)
                        VALUES (:id,:org,:profile,'weight',84,'kg',:at,'manual',:actor,true,
                        'Atípico ficticio confirmado para pruebas')"""),
                        {
                            "id": uuid5(NAMESPACE_URL, key + ":outlier"),
                            "org": org,
                            "profile": profile,
                            "at": datetime.now(UTC) - timedelta(hours=1),
                            "actor": actor,
                        },
                    )
                count += 1
    engine.dispose()
    return count


if __name__ == "__main__":
    url = os.environ.get("MIGRATION_DATABASE_URL")
    if not url:
        raise SystemExit("Set MIGRATION_DATABASE_URL for the disposable synthetic database.")
    print(f"Fictional profiles created: {seed_database(url)}; existing fixtures preserved.")
