# Comprobación de instalación local — F1

20 de noviembre de 2026 · America/Lima.

El README de la rama de desarrollo seguía indicando que todas las instalaciones
requerían el esquema F2 y que MFA no existía. Se corrige para distinguir el
checkout actual, la demostración y la identidad privada optativa. La base alojada
es Neon; Docker/PostgreSQL es una instalación descartable de desarrollo o CI.

## Uso y alcance

Después de `docker compose up --build --wait`:

```bash
python scripts/check_local_installation.py
```

Para el arranque nativo con Vite y su proxy de API:

```bash
python scripts/check_local_installation.py --base-url http://127.0.0.1:5173 --json
```

Requiere solo Python 3.11+; no necesita instalar dependencias del backend.
Devuelve código 0 únicamente si pasan los tres controles:

| Control | Condición |
|---|---|
| API | JSON `alive`, servicio `bodyvision-api`, entorno local/test |
| Base de datos | JSON `ready`, conexión SQL confirmada por la API, revisión igual al contrato del checkout en `backend/app/db/session.py` |
| Interfaz | HTML con raíz React y script de módulo; no basta un HTTP 200 de una página genérica del proxy |

El contrato SQL se lee como literal con AST, sin importar configuración ni ejecutar
el módulo. La prueba HTTP de readiness aprovecha la consulta SQL real del backend;
el comprobador no abre una segunda conexión ni recibe credenciales de PostgreSQL.
Cada solicitud tiene límite de cinco segundos y 64 KiB. Solo el CLI acepta HTTP
en loopback con puerto, sin usuario, contraseña, query ni fragmento. Se desactivan
proxies y redirecciones. El informe contiene identificador del control, estado
y consejo fijo; no imprime cuerpos HTTP, URLs, tokens, nombres de personas ni `.env`.

No inicia/paraliza contenedores, genera configuración, aplica migraciones, carga
seed ni borra volúmenes. Si falla la base, revisar PostgreSQL y Alembic; no cambiar
el contrato esperado para hacer pasar una instalación antigua. Demo queda fuera
de esta comprobación local.

## Evidencia y límites de cierre

La batería `scripts/tests/test_check_local_installation.py` levanta un servidor HTTP
descartable y prueba éxito, HTTP 503, esquema antiguo, HTML en lugar de JSON,
respuesta no objeto, exceso de tamaño, redirección, UI genérica, modo demo,
servicio ausente, URLs prohibidas y lectura del contrato sin dependencias.
La CI ejecuta esta batería y después el comprobador contra los servicios reales
en los jobs nativo y Docker. Su estado se consulta en la PR de esta entrega;
no considerar ejecutada la integración real hasta ver ambos jobs aprobados.

Un HTML válido no acredita ejecución de JavaScript ni navegación funcional;
eso sigue cubierto por Playwright. Una respuesta readiness valida el contrato
del servicio, no demuestra por sí sola permisos, aislamiento ni restauración.
La recepción humana de F1 sigue pendiente en el checklist de alta. Este bloque
no aumenta porcentajes ni firma fases, y no habilita datos reales.
