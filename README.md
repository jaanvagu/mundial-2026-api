# mundial-2026-api

Base minima en Node.js para que Hostinger reconozca este repositorio como una aplicacion valida.

## Requisitos

- Node.js 18 o superior

## Instalar dependencias

```bash
npm install
```

## Ejecutar localmente

```bash
npm start
```

## Endpoint disponible

- `GET /api/health`

Respuesta:

```json
{
  "ok": true,
  "service": "mundial-2026-api",
  "time": "ISO_DATE"
}
```
