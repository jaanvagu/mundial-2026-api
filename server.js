const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

const SERVICE_NAME = "mundial-2026-api";
const PORT = Number(process.env.PORT) || 3000;
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 40;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15000;
const DEFAULT_ALLOWED_ORIGIN = "https://culturarunner.com.co";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEV_FALLBACK_TOKEN = "dev-local-token";
const API_ACCESS_TOKEN = process.env.API_ACCESS_TOKEN || (!IS_PRODUCTION ? DEV_FALLBACK_TOKEN : "");
const CACHE_FILE_PATH = path.join(__dirname, "data", "cache", "results-cache.json");
const ALLOWED_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500"
];
const ALLOWED_ORIGINS = new Set([ALLOWED_ORIGIN, ...ALLOWED_DEV_ORIGINS]);

const cacheState = {
  data: null,
  updatedAt: null,
  refreshPromise: null
};

loadPersistedCache();

app.use(express.json());
app.use(cors(buildCorsOptions));
app.options(/.*/, cors(buildCorsOptions));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: SERVICE_NAME,
    time: new Date().toISOString(),
    cache: {
      has_data: Boolean(cacheState.data),
      cache_updated_at: cacheState.updatedAt ? new Date(cacheState.updatedAt).toISOString() : null,
      refresh_interval_seconds: CACHE_TTL_SECONDS
    }
  });
});

app.get("/api/results", requireApiKey, createResultsHandler(() => true));
app.get("/api/results/live", requireApiKey, createResultsHandler((match) => match.status === "LIVE" || match.status === "HALFTIME"));
app.get("/api/results/finished", requireApiKey, createResultsHandler((match) => match.status === "FINISHED"));

app.get("/api/matches", requireApiKey, createResultsHandler(() => true));
app.get("/api/matches/live", requireApiKey, createResultsHandler((match) => match.status === "LIVE" || match.status === "HALFTIME"));
app.get("/api/matches/finished", requireApiKey, createResultsHandler((match) => match.status === "FINISHED"));

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err && err.message ? err.message : err);
  res.status(500).json({
    ok: false,
    error: "Internal Server Error"
  });
});

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found"
  });
});

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});

function buildCorsOptions(req, callback) {
  const origin = req.header("Origin");

  if (!origin) {
    callback(null, createCorsOptions(true));
    return;
  }

  const allowed = ALLOWED_ORIGINS.has(origin);
  callback(null, createCorsOptions(allowed));
}

function createCorsOptions(originAllowed) {
  return {
    origin: originAllowed,
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
    optionsSuccessStatus: 204
  };
}

function requireApiKey(req, res, next) {
  if (!API_ACCESS_TOKEN) {
    res.status(503).json({
      ok: false,
      error: "Service unavailable: API_ACCESS_TOKEN is not configured"
    });
    return;
  }

  const apiKeyHeader = req.header("x-api-key");
  const authorizationHeader = req.header("Authorization");
  const bearerToken = authorizationHeader && authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice(7).trim()
    : "";
  const providedToken = apiKeyHeader || bearerToken;

  if (!providedToken) {
    res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
    return;
  }

  if (providedToken !== API_ACCESS_TOKEN) {
    res.status(403).json({
      ok: false,
      error: "Forbidden"
    });
    return;
  }

  next();
}

function createResultsHandler(filterFn) {
  return async (_req, res) => {
    try {
      const payload = await getResultsPayload();
      res.json({
        meta: payload.meta,
        results: payload.results.filter(filterFn)
      });
    } catch (error) {
      const statusCode = error && error.statusCode ? error.statusCode : 500;
      res.status(statusCode).json({
        ok: false,
        error: error && error.publicMessage ? error.publicMessage : "Unexpected error"
      });
    }
  };
}

async function getResultsPayload() {
  const now = Date.now();
  const cacheAgeMs = cacheState.updatedAt ? now - cacheState.updatedAt : Number.POSITIVE_INFINITY;
  const cacheIsFresh = cacheState.data && cacheAgeMs < CACHE_TTL_SECONDS * 1000;

  if (cacheIsFresh) {
    return clonePayload(cacheState.data, {
      served_from_cache: true,
      cache_stale: false
    });
  }

  if (cacheState.refreshPromise) {
    return cacheState.refreshPromise;
  }

  cacheState.refreshPromise = refreshResults()
    .finally(() => {
      cacheState.refreshPromise = null;
    });

  return cacheState.refreshPromise;
}

async function refreshResults() {
  const generatedAt = new Date().toISOString();
  const [worldcupSource, whenIsKickoffSource] = await Promise.all([
    fetchWorldCup26(generatedAt),
    fetchWhenIsKickoff(generatedAt)
  ]);

  const mergedResults = mergeSourceResults(worldcupSource.matches, whenIsKickoffSource.matches, generatedAt);
  const sourcesMeta = {
    worldcup26: worldcupSource.meta,
    wheniskickoff: whenIsKickoffSource.meta
  };

  if (mergedResults.length === 0) {
    if (cacheState.data) {
      return clonePayload(cacheState.data, {
        served_from_cache: true,
        cache_stale: true,
        generated_at: generatedAt,
        sources: sourcesMeta
      });
    }

    throw createHttpError(502, "Bad Gateway", "No results available from upstream sources");
  }

  const payload = {
    meta: {
      generated_at: generatedAt,
      served_from_cache: false,
      cache_updated_at: generatedAt,
      cache_stale: false,
      refresh_interval_seconds: CACHE_TTL_SECONDS,
      sources: sourcesMeta
    },
    results: mergedResults
  };

  cacheState.data = payload;
  cacheState.updatedAt = Date.now();
  persistCache(payload);

  return payload;
}

async function fetchWorldCup26(generatedAt) {
  const url = "https://worldcup26.ir/get/games";

  try {
    const json = await fetchJsonWithTimeout(url);
    const rawMatches = extractMatchList(json);
    const matches = rawMatches
      .map((item) => normalizeWorldCupMatch(item, generatedAt))
      .filter(Boolean);

    return {
      matches,
      meta: {
        ok: true,
        count: matches.length,
        error: null
      }
    };
  } catch (error) {
    return {
      matches: [],
      meta: {
        ok: false,
        count: 0,
        error: sanitizeUpstreamError(error)
      }
    };
  }
}

async function fetchWhenIsKickoff(generatedAt) {
  const url = "https://wheniskickoff.com/data/v1/matches.json";

  try {
    const json = await fetchJsonWithTimeout(url);
    const rawMatches = extractMatchList(json);
    const matches = rawMatches
      .map((item) => normalizeWhenIsKickoffMatch(item, generatedAt))
      .filter(Boolean);

    return {
      matches,
      meta: {
        ok: true,
        count: matches.length,
        error: null
      }
    };
  } catch (error) {
    return {
      matches: [],
      meta: {
        ok: false,
        count: 0,
        error: sanitizeUpstreamError(error)
      }
    };
  }
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": `${SERVICE_NAME}/1.0`
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream responded with ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractMatchList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const possibleLists = [
    payload.data,
    payload.games,
    payload.matches,
    payload.results,
    payload.response
  ];

  for (const value of possibleLists) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeWorldCupMatch(item, generatedAt) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const kickoff = firstString(
    item.datetime_utc,
    item.match_datetime_utc,
    item.kickoff_utc,
    item.kickoff,
    item.date_time,
    item.utc_date
  );
  const statusRaw = firstString(
    item.status,
    item.match_status,
    item.state,
    item.live_status,
    item.stage_status
  );
  const explicitElapsed = parseMinuteValue(
    item.time_elapsed,
    item.elapsed,
    item.minute,
    item.match_time
  );
  const scores = extractScores(item);
  const estimated = estimateMatchProgress(kickoff, generatedAt, explicitElapsed, statusRaw);
  const status = normalizeStatus(statusRaw, estimated.status);
  const stableId = buildStableId(item, kickoff);

  return {
    id: stableId,
    match_number: toNumberOrNull(item.num, item.match_number, item.matchday_number, item.id_match),
    home_code: firstString(item.home, item.home_code, item.home_team_code, item.home_short),
    away_code: firstString(item.away, item.away_code, item.away_team_code, item.away_short),
    home_name: firstString(item.home_name, item.homeTeam, item.home_team, item.team_home_name),
    away_name: firstString(item.away_name, item.awayTeam, item.away_team, item.team_away_name),
    score_home: scores.home,
    score_away: scores.away,
    status,
    status_raw: statusRaw || null,
    elapsed: explicitElapsed ?? estimated.elapsed,
    estimated_elapsed: explicitElapsed != null ? false : estimated.estimated_elapsed,
    last_seen_at: generatedAt
  };
}

function normalizeWhenIsKickoffMatch(item, generatedAt) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const kickoff = firstString(item.datetime_utc);
  const statusRaw = firstString(item.status);
  const explicitElapsed = parseMinuteValue(
    item.time_elapsed,
    item.elapsed,
    item.minute,
    item.match_time
  );
  const estimated = estimateMatchProgress(kickoff, generatedAt, explicitElapsed, statusRaw);
  const status = normalizeStatus(statusRaw, estimated.status);
  const stableId = buildStableId(item, kickoff);

  return {
    id: stableId,
    match_number: toNumberOrNull(item.num, item.match_number),
    home_code: firstString(item.home),
    away_code: firstString(item.away),
    home_name: firstString(item.home_name),
    away_name: firstString(item.away_name),
    score_home: toNumberOrNull(item.score_home),
    score_away: toNumberOrNull(item.score_away),
    status,
    status_raw: statusRaw || null,
    elapsed: explicitElapsed ?? estimated.elapsed,
    estimated_elapsed: explicitElapsed != null ? false : estimated.estimated_elapsed,
    last_seen_at: generatedAt
  };
}

function extractScores(item) {
  const directHome = toNumberOrNull(item.score_home, item.home_score, item.homeScore, item.goals_home);
  const directAway = toNumberOrNull(item.score_away, item.away_score, item.awayScore, item.goals_away);

  if (directHome != null || directAway != null) {
    return {
      home: directHome,
      away: directAway
    };
  }

  const combined = firstString(item.score, item.result, item.ft_score, item.current_score);
  if (!combined) {
    return { home: null, away: null };
  }

  const match = combined.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!match) {
    return { home: null, away: null };
  }

  return {
    home: Number(match[1]),
    away: Number(match[2])
  };
}

function estimateMatchProgress(kickoffIso, nowIso, explicitElapsed, statusRaw) {
  if (explicitElapsed != null) {
    return {
      status: null,
      elapsed: explicitElapsed,
      estimated_elapsed: false
    };
  }

  if (!kickoffIso) {
    return {
      status: null,
      elapsed: null,
      estimated_elapsed: null
    };
  }

  const kickoffMs = Date.parse(kickoffIso);
  const nowMs = Date.parse(nowIso);

  if (Number.isNaN(kickoffMs) || Number.isNaN(nowMs)) {
    return {
      status: null,
      elapsed: null,
      estimated_elapsed: null
    };
  }

  const diffMinutes = Math.floor((nowMs - kickoffMs) / 60000);
  if (diffMinutes < 0) {
    return {
      status: "SCHEDULED",
      elapsed: null,
      estimated_elapsed: null
    };
  }

  if (diffMinutes <= 45) {
    return {
      status: "LIVE",
      elapsed: diffMinutes,
      estimated_elapsed: true
    };
  }

  if (diffMinutes <= 60) {
    return {
      status: "HALFTIME",
      elapsed: 45,
      estimated_elapsed: true
    };
  }

  if (diffMinutes <= 105) {
    return {
      status: "LIVE",
      elapsed: clamp(diffMinutes - 15, 46, 90),
      estimated_elapsed: true
    };
  }

  const hasRealStatus = typeof statusRaw === "string" && statusRaw.trim() !== "";

  if (diffMinutes > 115 && !hasRealStatus) {
    return {
      status: "FINISHED",
      elapsed: 90,
      estimated_elapsed: true
    };
  }

  return {
    status: null,
    elapsed: null,
    estimated_elapsed: null
  };
}

function normalizeStatus(statusRaw, fallbackStatus) {
  const value = typeof statusRaw === "string" ? statusRaw.trim().toUpperCase() : "";
  const compactValue = value.replace(/[\s-]+/g, "_");

  if (!compactValue) {
    return fallbackStatus || "UNKNOWN";
  }

  if (["LIVE", "IN_PLAY", "1H", "2H", "SECOND_HALF", "FIRST_HALF"].includes(compactValue)) {
    return "LIVE";
  }

  if (["HT", "HALF_TIME", "HALFTIME", "BREAK"].includes(compactValue)) {
    return "HALFTIME";
  }

  if (["FINISHED", "FT", "FULL_TIME", "ENDED", "COMPLETED"].includes(compactValue)) {
    return "FINISHED";
  }

  if (["SCHEDULED", "NS", "NOT_STARTED", "UPCOMING", "TIMED"].includes(compactValue)) {
    return "SCHEDULED";
  }

  return fallbackStatus || "UNKNOWN";
}

function mergeSourceResults(primaryMatches, fallbackMatches, generatedAt) {
  const fallbackMap = new Map();

  for (const match of fallbackMatches) {
    fallbackMap.set(match.id, match);
  }

  const merged = [];
  const seenIds = new Set();

  for (const primary of primaryMatches) {
    const fallback = fallbackMap.get(primary.id);
    const resolved = mergeMatch(primary, fallback, generatedAt);
    merged.push(resolved);
    seenIds.add(resolved.id);
  }

  for (const fallback of fallbackMatches) {
    if (!seenIds.has(fallback.id)) {
      merged.push(mergeMatch(null, fallback, generatedAt));
    }
  }

  return merged.sort(sortMatches);
}

function mergeMatch(primary, fallback, generatedAt) {
  const base = primary || fallback;
  const resolved = {
    id: base.id,
    match_number: coalesce(primary && primary.match_number, fallback && fallback.match_number),
    home_code: coalesce(primary && primary.home_code, fallback && fallback.home_code),
    away_code: coalesce(primary && primary.away_code, fallback && fallback.away_code),
    home_name: coalesce(primary && primary.home_name, fallback && fallback.home_name),
    away_name: coalesce(primary && primary.away_name, fallback && fallback.away_name),
    score_home: chooseScore(primary && primary.score_home, fallback && fallback.score_home),
    score_away: chooseScore(primary && primary.score_away, fallback && fallback.score_away),
    status: chooseStatus(primary && primary.status, fallback && fallback.status),
    status_raw: coalesce(primary && primary.status_raw, fallback && fallback.status_raw),
    elapsed: chooseElapsed(primary, fallback),
    estimated_elapsed: chooseEstimatedElapsed(primary, fallback),
    last_seen_at: generatedAt
  };

  if (!resolved.status) {
    resolved.status = "UNKNOWN";
  }

  return resolved;
}

function chooseStatus(primaryStatus, fallbackStatus) {
  if (primaryStatus && primaryStatus !== "UNKNOWN") {
    return primaryStatus;
  }

  return fallbackStatus || primaryStatus || "UNKNOWN";
}

function chooseElapsed(primary, fallback) {
  if (primary && primary.elapsed != null) {
    return primary.elapsed;
  }

  if (fallback && fallback.elapsed != null) {
    return fallback.elapsed;
  }

  return null;
}

function chooseEstimatedElapsed(primary, fallback) {
  if (primary && primary.elapsed != null) {
    return primary.estimated_elapsed;
  }

  if (fallback && fallback.elapsed != null) {
    return fallback.estimated_elapsed;
  }

  return null;
}

function chooseScore(primaryValue, fallbackValue) {
  if (primaryValue != null) {
    return primaryValue;
  }

  if (fallbackValue != null) {
    return fallbackValue;
  }

  return null;
}

function buildStableId(item, kickoffIso) {
  const fromItem = firstString(
    item.slug,
    item.id,
    item.match_id,
    item.fixture_id,
    item.game_id
  );

  if (fromItem) {
    return String(fromItem);
  }

  const home = firstString(item.home, item.home_code, item.home_name, "home");
  const away = firstString(item.away, item.away_code, item.away_name, "away");
  const kickoff = kickoffIso || firstString(item.date, item.time_utc, "unknown-time");
  return `${home}-${away}-${kickoff}`.toLowerCase().replace(/\s+/g, "-");
}

function sortMatches(left, right) {
  const leftOrder = left.match_number == null ? Number.MAX_SAFE_INTEGER : left.match_number;
  const rightOrder = right.match_number == null ? Number.MAX_SAFE_INTEGER : right.match_number;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return String(left.id).localeCompare(String(right.id));
}

function sanitizeUpstreamError(error) {
  if (!error) {
    return "Unknown upstream error";
  }

  if (error.name === "AbortError") {
    return `Upstream timeout after ${FETCH_TIMEOUT_MS}ms`;
  }

  return error.message || "Unknown upstream error";
}

function clonePayload(payload, overrides) {
  return {
    meta: {
      ...payload.meta,
      ...overrides,
      generated_at: overrides && overrides.generated_at ? overrides.generated_at : payload.meta.generated_at,
      served_from_cache: overrides && Object.prototype.hasOwnProperty.call(overrides, "served_from_cache")
        ? overrides.served_from_cache
        : payload.meta.served_from_cache,
      cache_stale: overrides && Object.prototype.hasOwnProperty.call(overrides, "cache_stale")
        ? overrides.cache_stale
        : payload.meta.cache_stale,
      sources: overrides && overrides.sources ? overrides.sources : payload.meta.sources
    },
    results: payload.results.map((match) => ({ ...match }))
  };
}

function persistCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.warn("Cache persistence skipped:", error.message);
  }
}

function loadPersistedCache() {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      return;
    }

    const fileContents = fs.readFileSync(CACHE_FILE_PATH, "utf8");
    const payload = JSON.parse(fileContents);

    if (payload && payload.meta && Array.isArray(payload.results)) {
      cacheState.data = payload;
      cacheState.updatedAt = payload.meta.cache_updated_at
        ? Date.parse(payload.meta.cache_updated_at)
        : Date.now();
    }
  } catch (error) {
    console.warn("Unable to load persisted cache:", error.message);
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function toNumberOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    const number = Number(value);
    if (!Number.isNaN(number)) {
      return number;
    }
  }

  return null;
}

function parseMinuteValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    if (typeof value === "number" && !Number.isNaN(value)) {
      return Math.max(0, Math.floor(value));
    }

    if (typeof value === "string") {
      const match = value.match(/(\d{1,3})/);
      if (match) {
        return Math.max(0, Number(match[1]));
      }
    }
  }

  return null;
}

function coalesce(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  return null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createHttpError(statusCode, publicMessage, internalMessage) {
  const error = new Error(internalMessage || publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}
