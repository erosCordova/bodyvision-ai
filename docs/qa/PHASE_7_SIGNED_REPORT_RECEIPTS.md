# F7 — Comprobantes Ed25519 de informes ficticios

**Alcance:** identidad privada local/test exclusivamente. Propuesta técnica, no firma legal, certificación clínica ni aceptación productiva.

## Funcionalidad

- La variable opcional `REPORT_SIGNING_KEY` contiene una semilla Ed25519 de 32 bytes, codificada como 64 caracteres hexadecimales en minúscula. Se entrega mediante configuración secreta fuera del repositorio; no se genera ni distribuye automáticamente.
- Sin esa clave los informes siguen funcionando con SHA-256 y auditoría, y el comprobante es nulo.
- Con ella, el backend firma el manifiesto canónico JSON (claves ordenadas, separadores compactos, ASCII, excluyendo signature). Incluye versión, algoritmo, alcance ficticio, formato, ID de exportación, nombre, timestamp UTC con seis decimales, SHA-256, tamaño, filas CSV y SHA-256 de la clave pública cruda.
- El frontend comprueba que el comprobante corresponde a los bytes verificados y permite descargar un archivo separado `.receipt.json`. Esta comprobación **no** constituye verificación independiente de firma.
- Se conserva la auditoría transaccional de cada exportación y los permisos de organización/expediente. Un fallo al firmar impide devolver el informe. No se modifican las tablas.

## Verificación independiente

El verificador `app.services.verify_report_receipt`, ejecutado en un entorno Python con las dependencias del backend, recibe tres archivos: informe, comprobante JSON y clave pública Ed25519 cruda de exactamente 32 bytes, obtenida de un canal de confianza independiente. No acepta una clave incrustada en el comprobante.

Ejemplo de invocación desde backend (solo para responsables técnicos):

```sh
python -m app.services.verify_report_receipt --report INFORME.pdf \
  --receipt INFORME.pdf.receipt.json --trusted-public-key PUBLIC.key
```

Salida 0 si verifica, 2 ante rechazo; sin contenido de informes, claves ni rutas en el mensaje final. Se acotan tamaños y se rechazan enlaces simbólicos, archivos no regulares, cambios durante lectura, campos duplicados y claves incorrectas. El informe debe conservar su nombre original.

## Pruebas

Pruebas unitarias de firma PDF/CSV, manipulación de bytes/metadatos, sustitución de clave, JSON duplicado y verificación offline. Integración PostgreSQL para exportación autorizada, denegación de otro tenant y registro de auditoría. Prueba frontend de correspondencia del comprobante con los bytes PDF. CI integral pendiente.

## Límites y gates

No prueba custodia real o identidad legal de quien controla la clave. No sustituye PKI, certificado legal, sello de tiempo externo, registro de revocación, almacenamiento final ni recepción. No se ha configurado una clave real ni activado producción. Distribución de clave pública, rotación, revocación y custodia independiente requieren revisión de seguridad. F7 95 %, global técnico estimado 93 % hasta aceptación independiente. No se modifica el atlas, Neon ni main.
