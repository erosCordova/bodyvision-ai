# BODYVISION AI — recepción operativa de F1 (desarrollo sintético)

Este documento guía una **prueba manual pendiente** de instalación por una segunda persona. La receta de checkout limpio, compilación y arranque de Docker ya pasó en [GitHub Actions 44110966237](https://github.com/erosCordova/bodyvision-ai/actions/runs/44110966237); la recepción individual **no se ha ejecutado ni firmado**.

## 1. Condiciones de seguridad

- Solo `APP_ENV=local` o `test`; no habilitar `production` ni `staging` para saltarse controles. La aplicación sigue restringida a datos ficticios.
- No copiar a documentos ni compartir las credenciales del `.env`. El script de preparación las genera localmente.
- No borrar volúmenes existentes por error: `docker compose down` conserva datos; **nunca** `down -v` sobre datos que se desean conservar.
- Comprobar que el puerto `8080` de desarrollo no esté abierto a Internet y que Docker Desktop esté iniciado con contenedores Linux (Windows).
- Git Bash, Python 3.11+ y Docker Compose v2.20+ según [README](../../README.md). Instalar en equipo autorizado.

## 2. Alta desde checkout limpio (ejecución manual por validar)

```bash
git clone https://github.com/erosCordova/bodyvision-ai.git
cd bodyvision-ai
git checkout feature/phase3-auth-security
python scripts/setup_local.py
docker compose up --build --wait
docker compose ps
curl --fail http://127.0.0.1:8080/api/v1/health/live
curl --fail http://127.0.0.1:8080/api/v1/health/ready
python scripts/check_local_installation.py
docker compose run --rm seed
docker compose run --rm api-test
docker compose run --rm frontend-test
docker compose --profile test stop db-test
```

El repositorio puede ser privado: este paso exige acceso legítimo. El uso de `curl` en Git Bash depende de disponibilidad local. Verificar además la interfaz `http://localhost:8080`, expediente ficticio y ausencia de desbordamiento móvil. Finalmente, `docker compose down` (sin `-v`).

La demostración pública, la instancia local privada con MFA y una operación productiva **no comparten el mismo nivel de garantías**. Los tests de identidad privada requieren configuración temporal y datos ficticios; no se habilitan con este checklist. El aislamiento completo de entornos, secretos y backups sigue siendo pendiente de F1/F9.

## 3. Planilla de evidencia humana (sin aprobación anticipada)

| Control | Resultado registrado |
|---|---|
| Responsable que ejecuta | Pendiente |
| Equipo, SO y versión Docker/Compose | Pendiente |
| Fecha y rama / commit usados | Pendiente |
| Docker `up --build --wait` desde checkout limpio | Pendiente |
| `live` y `ready` consultan API y SQL (no valores simulados) | Pendiente |
| Seed sin duplicados y pruebas de contenedores | Pendiente |
| UI escritorio/móvil, teclado y error de conexión | Pendiente |
| Incidencias / mitigaciones | Pendiente |
| Conformidad de QA/operaciones | Pendiente |

Solo se marcará **F1 recibida** tras aportar salidas y la conformidad correspondiente. Esta guía es una herramienta, no una prueba de que alguien la haya seguido.
