# mundial-2026-api

API publica en Node.js/Express para exponer resultados del Mundial 2026 con cache, fallback entre fuentes gratuitas y proteccion por CORS restringido, validacion de origen y rate limit.

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
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
TZ=America/Bogota
```

Notas:

- `ALLOWED_ORIGIN` acepta uno o varios origenes separados por coma.
- En desarrollo, tambien se permiten `http://localhost:3000`, `http://localhost:5173` y `http://127.0.0.1:5500`.
- `API_ACCESS_TOKEN` queda obsoleta y no se usa para bloquear endpoints publicos.

## Ejecutar localmente

```bash
npm start
```

## Endpoints

- `GET /api/health` publico
- `GET /api/results` publico
- `GET /api/results/live` publico
- `GET /api/results/finished` publico
- `GET /api/matches` publico, alias de compatibilidad
- `GET /api/matches/live` publico, alias de compatibilidad
- `GET /api/matches/finished` publico, alias de compatibilidad

## Proteccion aplicada

- CORS restringido a `ALLOWED_ORIGIN`
- Validacion server-side de `Origin` y `Referer` para endpoints de resultados
- Rate limit por IP
- Cache compartido por TTL
- Sin stack traces en respuestas

## Ejemplos curl

```bash
curl https://api.culturarunner.com.co/api/health
```

```bash
curl https://api.culturarunner.com.co/api/results
```

```bash
curl https://api.culturarunner.com.co/api/results/live
```

```bash
curl https://api.culturarunner.com.co/api/results/finished
```

## CORS

- Produccion: solo permite `ALLOWED_ORIGIN`, que por defecto es `https://culturarunner.com.co`
- Desarrollo: tambien permite `http://localhost:3000`, `http://localhost:5173` y `http://127.0.0.1:5500`
- Soporta preflight `OPTIONS`
- Solo permite el header `Content-Type`

## Origin y Referer

- Si una peticion browser-like envia `Origin`, debe coincidir con uno de los origenes permitidos.
- Si no envia `Origin` pero si envia `Referer`, el `Referer` debe iniciar con un origen permitido.
- Si no envia ni `Origin` ni `Referer`, se permite para monitoreo, curl y pruebas operativas.
- Un origen no permitido responde `403 { "ok": false, "error": "Forbidden origin" }`

## Rate limit

- Se aplica a `/api/results*` y `/api/matches*`
- Defaults:
  - `RATE_LIMIT_WINDOW_MS=60000`
  - `RATE_LIMIT_MAX=60`
- Cuando una IP supera el limite, responde `429 { "ok": false, "error": "Too many requests" }`
- El servidor usa `trust proxy` para funcionar correctamente detras de Hostinger

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
2. Configura las variables de entorno, especialmente `ALLOWED_ORIGIN`, `RATE_LIMIT_WINDOW_MS` y `RATE_LIMIT_MAX`.
3. Verifica que el comando de arranque sea `npm start`.
4. Comprueba `GET /api/health`.
5. Prueba `/api/results` desde el frontend y con curl sin headers especiales.
