# mundial-2026-api

API privada en Node.js/Express para exponer resultados del Mundial 2026 con caché, fallback entre fuentes gratuitas y despliegue compatible con Hostinger.

## Requisitos

- Node.js 18 o superior

## Instalacion

```bash
npm install
```

## Variables de entorno

```bash
PORT=3000
CACHE_TTL_SECONDS=40
FETCH_TIMEOUT_MS=15000
ALLOWED_ORIGIN=https://culturarunner.com.co
API_ACCESS_TOKEN=tu-token-seguro
TZ=America/Bogota
```

Notas:

- `API_ACCESS_TOKEN` es obligatorio en produccion. Si falta, los endpoints protegidos responden `503` para evitar dejar la API abierta.
- En desarrollo local, si no defines `API_ACCESS_TOKEN` y `NODE_ENV !== production`, el servidor usa el token de ejemplo `dev-local-token`.
- En Hostinger debes configurar `API_ACCESS_TOKEN`, `ALLOWED_ORIGIN` y las demas variables desde el panel de entorno.

## Ejecutar localmente

```bash
npm start
```

## Endpoints

- `GET /api/health` publico
- `GET /api/results` protegido
- `GET /api/results/live` protegido
- `GET /api/results/finished` protegido
- `GET /api/matches` protegido, alias de compatibilidad
- `GET /api/matches/live` protegido, alias de compatibilidad
- `GET /api/matches/finished` protegido, alias de compatibilidad

## Autenticacion

Los endpoints protegidos aceptan cualquiera de estos headers:

- `x-api-key: <API_ACCESS_TOKEN>`
- `Authorization: Bearer <API_ACCESS_TOKEN>`

Errores esperados:

- sin token: `401 { "ok": false, "error": "Unauthorized" }`
- token incorrecto: `403 { "ok": false, "error": "Forbidden" }`

## Ejemplos curl

```bash
curl https://api.culturarunner.com.co/api/health
```

```bash
curl https://api.culturarunner.com.co/api/results \
  -H "x-api-key: $API_ACCESS_TOKEN"
```

```bash
curl https://api.culturarunner.com.co/api/results/live \
  -H "Authorization: Bearer $API_ACCESS_TOKEN"
```

## CORS

- Produccion: solo permite `ALLOWED_ORIGIN`, que por defecto es `https://culturarunner.com.co`
- Desarrollo: tambien permite `http://localhost:3000`, `http://localhost:5173` y `http://127.0.0.1:5500`
- Soporta preflight `OPTIONS`
- Permite el header `x-api-key`

## Fuentes externas

- Prioridad principal: `https://worldcup26.ir/get/games`
- Fallback: `https://wheniskickoff.com/data/v1/matches.json`

La API prioriza la fuente principal para `score`, `status` y `elapsed` cuando esos datos existen. Si falla o llega incompleta, completa el resultado desde la fuente secundaria.

## Cache y fallback

- Cache en memoria compartida por `CACHE_TTL_SECONDS`, default `40`
- Evita refresh simultaneos con una promesa compartida
- Intenta persistir el ultimo dato valido en `data/cache/results-cache.json`
- Si ambas fuentes fallan y existe cache, responde el ultimo dato valido con `meta.cache_stale=true`
- Si ambas fuentes fallan y no existe cache, responde `502`
- Las fuentes gratuitas no tienen SLA, por lo que puede haber latencia, downtime o cambios de esquema

## Formato de respuesta

```json
{
  "meta": {
    "generated_at": "ISO_DATE",
    "served_from_cache": true,
    "cache_updated_at": "ISO_DATE",
    "cache_stale": false,
    "refresh_interval_seconds": 40,
    "sources": {
      "worldcup26": {
        "ok": true,
        "count": 104,
        "error": null
      },
      "wheniskickoff": {
        "ok": true,
        "count": 104,
        "error": null
      }
    }
  },
  "results": [
    {
      "id": "mexico-vs-south-africa-2026-06-11",
      "match_number": 1,
      "home_code": "MEX",
      "away_code": "RSA",
      "home_name": "Mexico",
      "away_name": "South Africa",
      "score_home": 2,
      "score_away": 0,
      "status": "FINISHED",
      "status_raw": "FINISHED",
      "elapsed": 90,
      "estimated_elapsed": true,
      "last_seen_at": "ISO_DATE"
    }
  ]
}
```

## Despliegue en Hostinger

1. Sube este repositorio.
2. Configura las variables de entorno, especialmente `API_ACCESS_TOKEN`.
3. Verifica que el comando de arranque sea `npm start`.
4. Comprueba `GET /api/health`.
5. Prueba los endpoints protegidos con `x-api-key` o `Authorization: Bearer`.
