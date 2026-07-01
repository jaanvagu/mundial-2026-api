const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");

const app = express();

const SERVICE_NAME = "mundial-2026-api";
const PORT = Number(process.env.PORT) || 3000;
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 40;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15000;
const DEFAULT_ALLOWED_ORIGIN = "https://culturarunner.com.co";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 60;
const BACKGROUND_REFRESH_MS = Number(process.env.BACKGROUND_REFRESH_MS) || 60000;
const ALLOW_ALL_ORIGINS = String(process.env.ALLOW_ALL_ORIGINS).toLowerCase() === "true";
const ESPN_ENABLED = process.env.ESPN_ENABLED !== "false";
const ESPN_SCOREBOARD_URL = process.env.ESPN_SCOREBOARD_URL || "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard";
const ESPN_WORLD_CUP_LEAGUE_UID_TOKEN = process.env.ESPN_WORLD_CUP_LEAGUE_UID_TOKEN || "~l:606~";
const CACHE_FILE_PATH = path.join(__dirname, "data", "cache", "results-cache.json");
const FINISHED_RESULTS_FILE_PATH = path.join(__dirname, "data", "cache", "finished-results.json");
const BRACKET_CACHE_FILE_PATH = path.join(__dirname, "data", "cache", "bracket-cache.json");
const ALLOWED_DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500"
];
const configuredOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN);
const ALLOWED_ORIGINS = new Set([...configuredOrigins, ...ALLOWED_DEV_ORIGINS]);
const PUBLIC_RESULTS_PATHS = [
  "/api/results",
  "/api/results/live",
  "/api/results/finished",
  "/api/matches",
  "/api/matches/live",
  "/api/matches/finished"
];

const TEAM_CANONICAL_NAMES = {
  BRA: "Brasil",
  JAP: "Japón",
  CIV: "Costa de Marfil",
  NOR: "Noruega",
  ZAF: "Sudáfrica",
  CAN: "Canadá",
  GER: "Alemania",
  PAR: "Paraguay",
  NED: "Países Bajos",
  MAR: "Marruecos",
  FRA: "Francia",
  SWE: "Suecia",
  MEX: "México",
  ECU: "Ecuador",
  ENG: "Inglaterra",
  COD: "RD Congo",
  ESP: "España",
  AUT: "Austria",
  POR: "Portugal",
  CRO: "Croacia",
  BEL: "Bélgica",
  SEN: "Senegal",
  USA: "Estados Unidos",
  BIH: "Bosnia y Herzegovina",
  AUS: "Australia",
  EGY: "Egipto",
  COL: "Colombia",
  GHA: "Ghana",
  SUI: "Suiza",
  ALG: "Argelia",
  ARG: "Argentina",
  CPV: "Cabo Verde",
  EGI: "Egipto",
  IRN: "Irán",
  NZL: "Nueva Zelanda",
  TUR: "Turquía",
  HAI: "Haití",
  KOR: "Corea del Sur",
  CZE: "Chequia",
  QAT: "Catar",
  SAU: "Arabia Saudita",
  IRQ: "Irak",
  JOR: "Jordania",
  URU: "Uruguay",
  NZ: "Nueva Zelanda",
  PAN: "Panamá",
  CUR: "Curazao",
  TUN: "Túnez",
  ECT: "Ecuador"
};

const TEAM_CANONICAL_NAMES_BY_ALIAS = {
  brazil: "Brasil",
  brasil: "Brasil",
  japan: "Japón",
  japon: "Japón",
  "ivory coast": "Costa de Marfil",
  "cote divoire": "Costa de Marfil",
  "costa de marfil": "Costa de Marfil",
  norway: "Noruega",
  noruega: "Noruega",
  "south africa": "Sudáfrica",
  sudafrica: "Sudáfrica",
  canada: "Canadá",
  alemania: "Alemania",
  germany: "Alemania",
  paraguay: "Paraguay",
  "netherlands": "Países Bajos",
  "paises bajos": "Países Bajos",
  "países bajos": "Países Bajos",
  morocco: "Marruecos",
  marruecos: "Marruecos",
  france: "Francia",
  francia: "Francia",
  sweden: "Suecia",
  suecia: "Suecia",
  mexico: "México",
  méxico: "México",
  ecuador: "Ecuador",
  england: "Inglaterra",
  inglaterra: "Inglaterra",
  "congo dr": "RD Congo",
  "democratic republic of the congo": "RD Congo",
  "rd congo": "RD Congo",
  spain: "España",
  españa: "España",
  austria: "Austria",
  portugal: "Portugal",
  croatia: "Croacia",
  croacia: "Croacia",
  belgium: "Bélgica",
  belgica: "Bélgica",
  "bélgica": "Bélgica",
  senegal: "Senegal",
  "united states": "Estados Unidos",
  "estados unidos": "Estados Unidos",
  bosnia: "Bosnia y Herzegovina",
  "bosnia and herzegovina": "Bosnia y Herzegovina",
  "bosnia y herzegovina": "Bosnia y Herzegovina",
  australia: "Australia",
  egipto: "Egipto",
  egypt: "Egipto",
  colombia: "Colombia",
  ghana: "Ghana",
  switzerland: "Suiza",
  suiza: "Suiza",
  algeria: "Argelia",
  argelia: "Argelia",
  argentina: "Argentina",
  "cape verde": "Cabo Verde",
  "cape verde islands": "Cabo Verde",
  "cabo verde": "Cabo Verde",
  iran: "Irán",
  irán: "Irán",
  "new zealand": "Nueva Zelanda",
  "nueva zelanda": "Nueva Zelanda",
  turkey: "Turquía",
  turquia: "Turquía",
  "turquía": "Turquía",
  haiti: "Haití",
  haiti: "Haití",
  "haití": "Haití",
  korea: "Corea del Sur",
  "south korea": "Corea del Sur",
  "corea del sur": "Corea del Sur",
  czechia: "Chequia",
  "czech republic": "Chequia",
  chequia: "Chequia",
  qatar: "Catar",
  catar: "Catar",
  "saudi arabia": "Arabia Saudita",
  "arabia saudita": "Arabia Saudita",
  iraq: "Irak",
  irak: "Irak",
  jordan: "Jordania",
  jordania: "Jordania",
  uruguay: "Uruguay",
  panama: "Panamá",
  "curacao": "Curazao",
  "curaçao": "Curazao",
  tunisia: "Túnez",
  "tunez": "Túnez",
  "túnez": "Túnez"
};

const cacheState = {
  data: null,
  updatedAt: null,
  refreshPromise: null
};

const bracketCacheState = {
  data: null,
  updatedAt: null,
  refreshPromise: null
};

const finishedCacheState = {
  loaded: false,
  byId: new Map(),
  byMatchNumber: new Map(),
  error: null,
  writeError: null
};

const resultsRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Too many requests"
  },
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json(options.message);
  }
});

loadPersistedCache();
loadFinishedResultsCache();
loadPersistedBracketCache();

app.set("trust proxy", 1);
app.use(express.json());
app.use(cors(buildCorsOptions));
app.options(/.*/, cors(buildCorsOptions));
app.use(PUBLIC_RESULTS_PATHS, resultsRateLimiter, validatePublicOrigin);

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

app.get("/api/results", createResultsHandler(() => true));
app.get("/api/results/live", createResultsHandler((match) => match.status === "LIVE" || match.status === "HALFTIME"));
app.get("/api/results/finished", createResultsHandler((match) => match.status === "FINISHED"));
app.get("/api/bracket", createBracketHandler);

app.get("/api/matches", createResultsHandler(() => true));
app.get("/api/matches/live", createResultsHandler((match) => match.status === "LIVE" || match.status === "HALFTIME"));
app.get("/api/matches/finished", createResultsHandler((match) => match.status === "FINISHED"));

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
  if (ALLOW_ALL_ORIGINS) {
    console.warn("WARNING: ALLOW_ALL_ORIGINS is enabled. CORS and origin checks are relaxed for debugging.");
  } else {
    console.log("CORS restricted mode enabled.");
  }

  setInterval(() => {
    getResultsPayload().catch((error) => {
      console.warn("Background refresh failed:", sanitizeUpstreamError(error));
    });
  }, BACKGROUND_REFRESH_MS);
});

function buildCorsOptions(req, callback) {
  const origin = req.header("Origin");

  if (ALLOW_ALL_ORIGINS) {
    callback(null, createCorsOptions(origin || true));
    return;
  }

  if (!origin) {
    callback(null, createCorsOptions(true));
    return;
  }

  const allowed = ALLOWED_ORIGINS.has(origin);
  callback(null, createCorsOptions(allowed));
}

function createCorsOptions(originValue) {
  return {
    origin: originValue,
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    optionsSuccessStatus: 204
  };
}

function validatePublicOrigin(req, res, next) {
  if (ALLOW_ALL_ORIGINS) {
    next();
    return;
  }

  const origin = req.header("Origin");
  const referer = req.header("Referer");

  if (!origin && !referer) {
    next();
    return;
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({
      ok: false,
      error: "Forbidden origin"
    });
    return;
  }

  if (!origin && referer && !refererMatchesAllowedOrigin(referer)) {
    res.status(403).json({
      ok: false,
      error: "Forbidden origin"
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
        results: payload.results
          .filter(filterFn)
          .map(toPublicMatch)
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

async function createBracketHandler(_req, res) {
  try {
    const payload = await getBracketPayload();
    res.json(payload);
  } catch (error) {
    const statusCode = error && error.statusCode ? error.statusCode : 500;
    res.status(statusCode).json({
      ok: false,
      error: error && error.publicMessage ? error.publicMessage : "Unexpected error"
    });
  }
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

function getBracketPayload() {
  const now = Date.now();
  const cacheAgeMs = bracketCacheState.updatedAt ? now - bracketCacheState.updatedAt : Number.POSITIVE_INFINITY;

  if (bracketCacheState.data && cacheAgeMs < CACHE_TTL_SECONDS * 1000) {
    return cloneBracketPayload(bracketCacheState.data, {
      served_from_cache: true,
      cache_stale: false
    });
  }

  if (bracketCacheState.refreshPromise) {
    return bracketCacheState.refreshPromise;
  }

  bracketCacheState.refreshPromise = refreshBracket()
    .finally(() => {
      bracketCacheState.refreshPromise = null;
    });

  return bracketCacheState.refreshPromise;
}

async function refreshResults() {
  const generatedAt = new Date().toISOString();
  const [espnSource, worldcupSource] = await Promise.all([
    fetchEspnRelevantMatches([], generatedAt),
    fetchWorldCup26(generatedAt)
  ]);

  let whenIsKickoffSource = {
    matches: [],
    meta: {
      ok: true,
      count: 0,
      error: null
    }
  };

  let baseResults = [];

  if (espnSource.meta.ok && espnSource.matches.length > 0) {
    baseResults = espnSource.matches;
    if (worldcupSource.meta.ok && worldcupSource.matches.length > 0) {
      baseResults = mergeSourceResults(baseResults, worldcupSource.matches, generatedAt);
    }
  } else {
    if (worldcupSource.meta.ok && worldcupSource.matches.length > 0) {
      baseResults = worldcupSource.matches;
    } else {
      whenIsKickoffSource = await fetchWhenIsKickoff(generatedAt);
      if (whenIsKickoffSource.meta.ok && whenIsKickoffSource.matches.length > 0) {
        baseResults = whenIsKickoffSource.matches;
      }
    }
  }

  const frozenResults = applyFinishedResultsCache(baseResults);
  const enrichedResults = espnSource.matches.length > 0
    ? enrichMatchesWithEspn(frozenResults, espnSource.matches, generatedAt)
    : frozenResults;
  const uniqueResults = dedupeMatches(enrichedResults);
  persistFinishedMatches(uniqueResults);
  const sourcesMeta = {
    worldcup26: worldcupSource.meta,
    wheniskickoff: whenIsKickoffSource.meta,
    espn: espnSource.meta
  };

  if (uniqueResults.length === 0) {
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

  const publicResults = uniqueResults.map(toPublicMatch);
  const payload = {
    meta: {
      generated_at: generatedAt,
      served_from_cache: false,
      cache_updated_at: generatedAt,
      cache_stale: false,
      refresh_interval_seconds: CACHE_TTL_SECONDS,
      sources: sourcesMeta,
      finished_cache: {
        count: finishedCacheState.byId.size,
        path: FINISHED_RESULTS_FILE_PATH,
        loaded: finishedCacheState.loaded,
        error: finishedCacheState.error,
        write_error: finishedCacheState.writeError
      }
    },
    results: publicResults
  };

  cacheState.data = payload;
  cacheState.updatedAt = Date.now();
  persistCache(payload);
  const bracketPayload = buildBracketPayload(uniqueResults, generatedAt);
  bracketCacheState.data = bracketPayload;
  bracketCacheState.updatedAt = Date.now();
  persistBracketCache(bracketPayload);

  return payload;
}

async function refreshBracket() {
  const resultsPayload = await getResultsPayload();
  const generatedAt = new Date().toISOString();
  const bracketPayload = buildBracketPayload(resultsPayload.results, generatedAt);
  bracketCacheState.data = bracketPayload;
  bracketCacheState.updatedAt = Date.now();
  persistBracketCache(bracketPayload);
  return bracketPayload;
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

async function fetchEspnRelevantMatches(baseMatches, generatedAt) {
  if (!ESPN_ENABLED) {
    return {
      matches: [],
      meta: {
        ok: true,
        count: 0,
        error: null
      }
    };
  }

  const relevantDates = getRelevantEspnDates(baseMatches, generatedAt);

  try {
    const payloads = await Promise.all(relevantDates.map((date) => fetchEspnScoreboardByDate(date)));
    const matches = payloads.flatMap((payload) => normalizeEspnMatches(payload, generatedAt)).filter(Boolean);

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

async function fetchEspnScoreboardByDate(date) {
  const url = new URL(ESPN_SCOREBOARD_URL);
  url.searchParams.set("dates", date);
  url.searchParams.set("limit", "200");
  return fetchJsonWithTimeout(url.toString());
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
    item.utc_date,
    item.local_date
  );
  const statusRaw = firstString(
    item.status,
    item.match_status,
    item.state,
    item.live_status,
    item.stage_status,
    item.time_elapsed,
    item.finished
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
    match_number: toNumberOrNull(item.num, item.match_number, item.matchday_number, item.id_match, item.id),
    home_code: firstString(item.home, item.home_code, item.home_team_code, item.home_short),
    away_code: firstString(item.away, item.away_code, item.away_team_code, item.away_short),
    home_name: firstString(item.home_name, item.homeTeam, item.home_team, item.team_home_name, item.home_team_name_en),
    away_name: firstString(item.away_name, item.awayTeam, item.away_team, item.team_away_name, item.away_team_name_en),
    score_home: scores.home,
    score_away: scores.away,
    home_penalty_score: toNumberOrNull(item.home_penalty_score, item.home_penalties, item.home_penalty, item.penalty_score_home),
    away_penalty_score: toNumberOrNull(item.away_penalty_score, item.away_penalties, item.away_penalty, item.penalty_score_away),
    status,
    status_raw: statusRaw || null,
    elapsed: explicitElapsed ?? estimated.elapsed,
    estimated_elapsed: explicitElapsed != null ? false : estimated.estimated_elapsed,
    last_seen_at: generatedAt,
    kickoff_utc: kickoff || null
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
    home_penalty_score: toNumberOrNull(item.home_penalty_score, item.home_penalties, item.penalty_score_home),
    away_penalty_score: toNumberOrNull(item.away_penalty_score, item.away_penalties, item.penalty_score_away),
    status,
    status_raw: statusRaw || null,
    elapsed: explicitElapsed ?? estimated.elapsed,
    estimated_elapsed: explicitElapsed != null ? false : estimated.estimated_elapsed,
    last_seen_at: generatedAt,
    kickoff_utc: kickoff || null
  };
}

function normalizeEspnMatches(payload, generatedAt) {
  const events = Array.isArray(payload && payload.events) ? payload.events : [];

  return events
    .filter(isEspnWorldCupEvent)
    .map((event) => normalizeEspnEvent(event, generatedAt))
    .filter(Boolean);
}

function isEspnWorldCupEvent(event) {
  return String(event && event.uid ? event.uid : "").includes(ESPN_WORLD_CUP_LEAGUE_UID_TOKEN);
}

function normalizeEspnEvent(event, generatedAt) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const competition = Array.isArray(event.competitions) ? event.competitions[0] : null;
  const competitors = Array.isArray(competition && competition.competitors) ? competition.competitors : [];
  const home = competitors.find((competitor) => competitor.homeAway === "home") || competitors[0];
  const away = competitors.find((competitor) => competitor.homeAway === "away") || competitors[1];

  if (!home || !away) {
    return null;
  }

  const competitionStatus = competition && competition.status ? competition.status : event.status || {};
  const statusType = competitionStatus.type || {};
  const displayClock = firstString(competitionStatus.displayClock, statusType.shortDetail, statusType.detail);
  const parsedClock = parseEspnDisplayClock(displayClock);
  const normalizedStatus = normalizeEspnStatus(statusType, displayClock, toNumberOrNull(competitionStatus.period));
  const elapsed = shouldUseEspnElapsed(normalizedStatus.status) ? (normalizedStatus.elapsedOverride != null ? normalizedStatus.elapsedOverride : parsedClock) : null;
  const estimatedElapsed = shouldUseEspnElapsed(normalizedStatus.status) && elapsed != null ? false : null;
  const events = normalizeEspnEvents(competition && competition.details, competitors);

  return {
    espn_id: firstString(event.id, competition && competition.id),
    uid: firstString(event.uid, competition && competition.uid),
    kickoff_utc: firstString(event.date, competition && competition.date, competition && competition.startDate),
    home_name: firstString(home.team && home.team.displayName, home.team && home.team.name),
    away_name: firstString(away.team && away.team.displayName, away.team && away.team.name),
    home_code: firstString(home.team && home.team.abbreviation),
    away_code: firstString(away.team && away.team.abbreviation),
    score_home: toNumberOrNull(home.score),
    score_away: toNumberOrNull(away.score),
    status: normalizedStatus.status,
    status_raw: getEspnStatusRaw(normalizedStatus.status, displayClock, statusType),
    elapsed,
    estimated_elapsed: estimatedElapsed,
    display_clock: shouldUseEspnElapsed(normalizedStatus.status) && displayClock !== "0'" ? displayClock || null : null,
    clock_source: elapsed != null ? "espn" : null,
    period: toNumberOrNull(competitionStatus.period),
    last_seen_at: generatedAt,
    events
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

  if (["TRUE", "FINISHED_TRUE"].includes(compactValue)) {
    return "FINISHED";
  }

  if (["FALSE", "LIVE_FALSE"].includes(compactValue) && fallbackStatus) {
    return fallbackStatus;
  }

  if (["HT", "HALF_TIME", "HALFTIME", "BREAK"].includes(compactValue)) {
    return "HALFTIME";
  }

  if (["FINISHED", "FT", "FULL_TIME", "ENDED", "COMPLETED", "FINISHED", "FINISH"].includes(compactValue)) {
    return "FINISHED";
  }

  if (["SCHEDULED", "NS", "NOT_STARTED", "NOTSTARTED", "UPCOMING", "TIMED"].includes(compactValue)) {
    return "SCHEDULED";
  }

  return fallbackStatus || "UNKNOWN";
}

function mergeSourceResults(primaryMatches, fallbackMatches, generatedAt) {
  const fallbackMapById = new Map();
  const fallbackMapByMatchNumber = new Map();
  const fallbackMapByTeams = new Map();

  for (const match of fallbackMatches) {
    fallbackMapById.set(match.id, match);
    if (match.match_number != null) {
      fallbackMapByMatchNumber.set(match.match_number, match);
    }
    const teamSignature = buildTeamSignature(match);
    if (teamSignature) {
      fallbackMapByTeams.set(teamSignature, match);
    }
  }

  const merged = [];
  const seenFallbackIds = new Set();

  for (const primary of primaryMatches) {
    const teamSignature = buildTeamSignature(primary);
    const fallback = (primary.match_number != null ? fallbackMapByMatchNumber.get(primary.match_number) : null)
      || fallbackMapById.get(primary.id)
      || (teamSignature ? fallbackMapByTeams.get(teamSignature) : null);
    const resolved = mergeMatch(primary, fallback, generatedAt);
    merged.push(resolved);
    if (fallback) {
      seenFallbackIds.add(fallback.id);
    }
  }

  for (const fallback of fallbackMatches) {
    if (!seenFallbackIds.has(fallback.id)) {
      merged.push(mergeMatch(null, fallback, generatedAt));
    }
  }

  return merged.sort(sortMatches);
}

function mergeMatch(primary, fallback, generatedAt) {
  if (primary && fallback && !sameFixtureIdentity(primary, fallback)) {
    return mergeMatch(null, fallback, generatedAt);
  }

  const base = primary || fallback;
  const resolved = {
    id: coalesce(fallback && fallback.id, primary && primary.id, base.id),
    match_number: coalesce(fallback && fallback.match_number, primary && primary.match_number),
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
    last_seen_at: generatedAt,
    kickoff_utc: coalesce(fallback && fallback.kickoff_utc, primary && primary.kickoff_utc)
  };

  if (!resolved.status) {
    resolved.status = "UNKNOWN";
  }

  return resolved;
}

function enrichMatchesWithEspn(matches, espnMatches, generatedAt) {
  if (!Array.isArray(espnMatches) || espnMatches.length === 0) {
    return matches;
  }
  const usedEspnIds = new Set();

  return matches.map((match) => {
    const espnMatch = findMatchingEspnMatch(match, espnMatches, usedEspnIds);
    if (!espnMatch) {
      return match;
    }

    const orientation = getEspnOrientation(match, espnMatch);
    const espnScoreHome = orientation === "reversed" ? espnMatch.score_away : espnMatch.score_home;
    const espnScoreAway = orientation === "reversed" ? espnMatch.score_home : espnMatch.score_away;
    const hasUsableScores = espnScoreHome != null && espnScoreAway != null;
    const hasUsableClock = espnMatch.elapsed != null;
    const authoritativeStatus = espnMatch.status === "LIVE" || espnMatch.status === "HALFTIME" || espnMatch.status === "FINISHED";

    if (!authoritativeStatus && !hasUsableScores && !hasUsableClock) {
      return match;
    }

    if (espnMatch.espn_id) {
      usedEspnIds.add(espnMatch.espn_id);
    }

    return {
      ...match,
      home_code: match.home_code || espnMatch.home_code || null,
      away_code: match.away_code || espnMatch.away_code || null,
      home_name: match.home_name || espnMatch.home_name || null,
      away_name: match.away_name || espnMatch.away_name || null,
      score_home: hasUsableScores ? espnScoreHome : match.score_home,
      score_away: hasUsableScores ? espnScoreAway : match.score_away,
      status: authoritativeStatus ? espnMatch.status : match.status,
      status_raw: authoritativeStatus ? espnMatch.status_raw : match.status_raw,
      elapsed: hasUsableClock ? espnMatch.elapsed : match.elapsed,
      estimated_elapsed: hasUsableClock ? false : match.estimated_elapsed,
      last_seen_at: generatedAt,
      espn_id: espnMatch.espn_id || null,
      clock_source: hasUsableClock ? "espn" : match.clock_source,
      display_clock: hasUsableClock ? (espnMatch.display_clock || match.display_clock || null) : (match.display_clock || null),
      events: espnMatch.events || match.events
    };
  });
}

function findMatchingEspnMatch(match, espnMatches, usedEspnIds) {
  const candidates = espnMatches.filter((espnMatch) => {
    if (usedEspnIds.has(espnMatch.espn_id)) {
      return false;
    }

    if (!kickoffApproximatelyMatches(match.kickoff_utc, espnMatch.kickoff_utc)) {
      return false;
    }

    if (matchHasUnknownTeams(match)) {
      return true;
    }

    const sameOrientation = matchesByTeamsOrCodes(match, espnMatch);
    const reversedOrientation = matchesByTeamsOrCodes(match, espnMatch, true);
    return sameOrientation || reversedOrientation;
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftDiff = getKickoffDifferenceMs(match.kickoff_utc, left.kickoff_utc);
    const rightDiff = getKickoffDifferenceMs(match.kickoff_utc, right.kickoff_utc);
    return leftDiff - rightDiff;
  });

  return candidates[0];
}

function matchHasUnknownTeams(match) {
  return !firstString(match.home_code, match.home_name) || !firstString(match.away_code, match.away_name);
}

function getEspnOrientation(match, espnMatch) {
  const sameHome = teamTokenEquals(match.home_name, espnMatch.home_name) || teamTokenEquals(match.home_code, espnMatch.home_code);
  const sameAway = teamTokenEquals(match.away_name, espnMatch.away_name) || teamTokenEquals(match.away_code, espnMatch.away_code);

  if (sameHome && sameAway) {
    return "same";
  }

  const reversedHome = teamTokenEquals(match.home_name, espnMatch.away_name) || teamTokenEquals(match.home_code, espnMatch.away_code);
  const reversedAway = teamTokenEquals(match.away_name, espnMatch.home_name) || teamTokenEquals(match.away_code, espnMatch.home_code);

  if (reversedHome && reversedAway) {
    return "reversed";
  }

  return "same";
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

function normalizeEspnStatus(statusType, displayClock, period) {
  const state = firstString(statusType && statusType.state);
  const description = firstString(statusType && statusType.description, statusType && statusType.name, displayClock);
  const normalizedState = state ? state.toLowerCase() : "";
  const normalizedDescription = description ? description.toLowerCase() : "";
  const normalizedClock = String(displayClock || "").toUpperCase();
  const normalizedName = String(statusType && statusType.name ? statusType.name : "").toUpperCase();

  if (
    normalizedName === "STATUS_HALFTIME"
    || normalizedClock === "HT"
    || normalizedDescription === "halftime"
    || normalizedDescription === "half time"
  ) {
    return {
      status: "HALFTIME",
      elapsedOverride: 45,
      estimated_elapsed: false
    };
  }

  if (normalizedState === "pre" || normalizedDescription.includes("scheduled")) {
    return {
      status: "SCHEDULED",
      elapsedOverride: null,
      estimated_elapsed: null
    };
  }

  if (normalizedState === "in") {
    if (
      normalizedName === "STATUS_FIRST_HALF"
      || normalizedName === "STATUS_SECOND_HALF"
      || period === 1
      || period === 2
      || parseEspnDisplayClock(displayClock) != null
    ) {
      return {
        status: "LIVE",
        elapsedOverride: null,
        estimated_elapsed: false
      };
    }
  }

  if (normalizedState === "post" || statusType.completed || normalizedDescription.includes("final") || normalizedClock === "FT") {
    return {
      status: "FINISHED",
      elapsedOverride: 90,
      estimated_elapsed: false
    };
  }

  return {
    status: "UNKNOWN",
    elapsedOverride: null,
    estimated_elapsed: null
  };
}

function shouldUseEspnElapsed(status) {
  return status === "LIVE" || status === "HALFTIME" || status === "FINISHED";
}

function parseEspnDisplayClock(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const compact = value.trim().toUpperCase();
  if (compact === "HT" || compact === "0'") {
    if (compact === "0'") {
      return null;
    }
    return 45;
  }

  if (compact === "FT") {
    return 90;
  }

  const normalized = compact.replace(/\s+/g, "");
  const plusMatch = normalized.match(/^(\d{1,3})'?[\+](\d{1,2})'?$/);
  if (plusMatch) {
    return Number(plusMatch[1]) + Number(plusMatch[2]);
  }

  const plainMatch = normalized.match(/^(\d{1,3})'?$/);
  if (plainMatch) {
    return Number(plainMatch[1]);
  }

  return null;
}

function getEspnStatusRaw(status, displayClock, statusType) {
  if ((status === "LIVE" || status === "HALFTIME") && displayClock) {
    return displayClock;
  }

  if (status === "FINISHED" && (displayClock === "FT" || String(displayClock || "").toUpperCase() === "FT")) {
    return "FT";
  }

  return firstString(statusType && statusType.detail, statusType && statusType.description, statusType && statusType.name, displayClock);
}

function normalizeEspnEvents(details, competitors) {
  if (!Array.isArray(details) || details.length === 0) {
    return undefined;
  }

  const competitorsByTeamId = new Map(
    (Array.isArray(competitors) ? competitors : [])
      .filter((competitor) => competitor && competitor.team && competitor.team.id)
      .map((competitor) => [String(competitor.team.id), competitor])
  );

  const events = details
    .filter((detail) => detail && (detail.scoringPlay === true || firstString(detail.type && detail.type.text) === "Goal"))
    .map((detail) => {
      const athlete = Array.isArray(detail.athletesInvolved) ? detail.athletesInvolved[0] : null;
      const competitor = detail.team && detail.team.id ? competitorsByTeamId.get(String(detail.team.id)) : null;

      return {
        type: "GOAL",
        minute: firstString(detail.clock && detail.clock.displayValue),
        team_code: firstString(competitor && competitor.team && competitor.team.abbreviation),
        player: firstString(athlete && athlete.displayName),
        short_player: firstString(athlete && athlete.shortName),
        score_value: toNumberOrNull(detail.scoreValue),
        penalty: detail.penaltyKick === true,
        own_goal: detail.ownGoal === true
      };
    });

  return events.length > 0 ? events : undefined;
}

function getRelevantEspnDates(matches, generatedAt) {
  const nowMs = Date.parse(generatedAt);
  const dates = new Set([
    formatUtcDateYYYYMMDD(nowMs - 24 * 60 * 60 * 1000),
    formatUtcDateYYYYMMDD(nowMs),
    formatUtcDateYYYYMMDD(nowMs + 24 * 60 * 60 * 1000)
  ]);

  for (const match of matches) {
    const kickoffMs = match.kickoff_utc ? Date.parse(match.kickoff_utc) : Number.NaN;
    if (Number.isNaN(kickoffMs)) {
      continue;
    }

    const diffMinutes = (nowMs - kickoffMs) / 60000;
    if (diffMinutes >= -15 && diffMinutes <= 140) {
      dates.add(formatUtcDateYYYYMMDD(kickoffMs));
      dates.add(formatUtcDateYYYYMMDD(kickoffMs - 24 * 60 * 60 * 1000));
    }
  }

  return Array.from(dates).sort();
}

function formatUtcDateYYYYMMDD(value) {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function toPublicMatch(match) {
  const {
    kickoff_utc: _kickoffUtc,
    ...publicMatch
  } = match;

  publicMatch.home_name = canonicalTeamName(publicMatch.home_name, publicMatch.home_code);
  publicMatch.away_name = canonicalTeamName(publicMatch.away_name, publicMatch.away_code);

  return publicMatch;
}

function applyFinishedResultsCache(matches) {
  return matches.map((match) => {
    const persisted = findPersistedFinishedMatch(match);
    if (!persisted) {
      return match;
    }

    if (!isCompatibleFinishedSnapshot(match, persisted)) {
      return match;
    }

    const currentQuality = getFinishedSnapshotQuality(match);
    const persistedQuality = getFinishedSnapshotQuality(persisted);
    const shouldPreferPersisted = persistedQuality >= currentQuality;
    const preferred = shouldPreferPersisted ? persisted : match;

    return {
      ...match,
      ...preferred,
      id: match.id || persisted.id,
      match_number: match.match_number != null ? match.match_number : persisted.match_number,
      home_code: match.home_code || persisted.home_code,
      away_code: match.away_code || persisted.away_code,
      home_name: canonicalTeamName(match.home_name || persisted.home_name, match.home_code || persisted.home_code),
      away_name: canonicalTeamName(match.away_name || persisted.away_name, match.away_code || persisted.away_code),
      kickoff_utc: match.kickoff_utc || persisted.kickoff_utc || null
    };
  });
}

function findPersistedFinishedMatch(match) {
  if (match.id && finishedCacheState.byId.has(match.id)) {
    const candidate = finishedCacheState.byId.get(match.id);
    if (isCompatibleFinishedSnapshot(match, candidate)) {
      return candidate;
    }
  }

  if (match.match_number != null && finishedCacheState.byMatchNumber.has(match.match_number)) {
    const candidate = finishedCacheState.byMatchNumber.get(match.match_number);
    if (isCompatibleFinishedSnapshot(match, candidate)) {
      return candidate;
    }
  }

  return null;
}

function isPersistedFinishedMatch(match) {
  return Boolean(findPersistedFinishedMatch(match));
}

function dedupeMatches(matches) {
  const byId = new Map();
  const byMatchNumber = new Map();

  for (const match of matches) {
    const existingById = match.id ? byId.get(match.id) : null;
    const existingByNumber = match.match_number != null ? byMatchNumber.get(match.match_number) : null;
    const preferred = choosePreferredMatch(existingById || existingByNumber, match);

    if (preferred.id) {
      byId.set(preferred.id, preferred);
    }
    if (preferred.match_number != null) {
      byMatchNumber.set(preferred.match_number, preferred);
    }
  }

  const unique = new Set();
  return Array.from(byId.values())
    .concat(Array.from(byMatchNumber.values()))
    .filter((match) => {
      const key = `${match.id}::${match.match_number ?? "null"}`;
      if (unique.has(key)) {
        return false;
      }
      unique.add(key);
      return true;
    })
    .sort(sortMatches);
}

function choosePreferredMatch(left, right) {
  if (!left) {
    return right;
  }

  const leftScore = getMatchCompletenessScore(left);
  const rightScore = getMatchCompletenessScore(right);
  return rightScore >= leftScore ? right : left;
}

function getMatchCompletenessScore(match) {
  let score = 0;
  if (match.score_home != null && match.score_away != null) score += 4;
  if (match.status && match.status !== "UNKNOWN") score += 3;
  if (match.elapsed != null) score += 2;
  if (match.home_name && match.away_name) score += 2;
  if (match.home_code && match.away_code) score += 1;
  return score;
}

function persistFinishedMatches(matches) {
  try {
    const persisted = new Map();

    for (const existing of finishedCacheState.byId.values()) {
      if (isSafeToPersistFinished(existing)) {
        persisted.set(existing.id, existing);
      }
    }

    for (const match of matches) {
      if (match.status !== "FINISHED") {
        continue;
      }

      if (!isSafeToPersistFinished(match)) {
        continue;
      }

      const snapshot = createFinishedSnapshot(match);
      if (snapshot.id) {
        const current = persisted.get(snapshot.id);
        if (!current || getFinishedSnapshotQuality(snapshot) >= getFinishedSnapshotQuality(current)) {
          persisted.set(snapshot.id, snapshot);
        }
      }
    }

    const deduped = dedupeMatches(Array.from(persisted.values()).map((match) => ({ ...match })));
    finishedCacheState.byId = new Map();
    finishedCacheState.byMatchNumber = new Map();

    for (const match of deduped) {
      if (match.id) {
        finishedCacheState.byId.set(match.id, match);
      }
      if (match.match_number != null) {
        finishedCacheState.byMatchNumber.set(match.match_number, match);
      }
    }

    fs.mkdirSync(path.dirname(FINISHED_RESULTS_FILE_PATH), { recursive: true });
    fs.writeFileSync(
      FINISHED_RESULTS_FILE_PATH,
      JSON.stringify({ results: Array.from(finishedCacheState.byId.values()) }, null, 2),
      "utf8"
    );
    finishedCacheState.loaded = true;
    finishedCacheState.error = null;
    finishedCacheState.writeError = null;
  } catch (error) {
    finishedCacheState.writeError = error.message;
    console.warn("Finished results persistence skipped:", error.message);
  }
}

function createFinishedSnapshot(match) {
  const penalties = isPenaltyShootoutMatch(match);
  const extraTime = isExtraTimeMatch(match) || penalties;
  const penaltyScore = extractPenaltyScore(match);
  const homeName = canonicalTeamName(match.home_name, match.home_code);
  const awayName = canonicalTeamName(match.away_name, match.away_code);

  return {
    id: match.id,
    match_number: match.match_number ?? null,
    home_code: match.home_code ?? null,
    away_code: match.away_code ?? null,
    home_name: homeName,
    away_name: awayName,
    score_home: match.score_home ?? null,
    score_away: match.score_away ?? null,
    status: match.status,
    status_raw: match.status_raw ?? null,
    elapsed: match.elapsed ?? null,
    estimated_elapsed: match.estimated_elapsed ?? null,
    last_seen_at: match.last_seen_at ?? null,
    espn_id: match.espn_id ?? null,
    clock_source: match.clock_source ?? null,
    display_clock: match.display_clock ?? null,
    extra_time: extraTime,
    penalties,
    penalty_score_home: penaltyScore.home,
    penalty_score_away: penaltyScore.away,
    penalty_winner: inferPenaltyWinner(penaltyScore),
    kickoff_utc: match.kickoff_utc ?? null
  };
}

function isCompatibleFinishedSnapshot(currentMatch, persistedMatch) {
  if (!persistedMatch) {
    return false;
  }

  if (currentMatch.id && persistedMatch.id && currentMatch.id !== persistedMatch.id) {
    return false;
  }

  if (currentMatch.match_number != null && persistedMatch.match_number != null && currentMatch.match_number !== persistedMatch.match_number) {
    return false;
  }

  if (!kickoffApproximatelyMatches(currentMatch.kickoff_utc, persistedMatch.kickoff_utc)) {
    return false;
  }

  if (!currentMatch.home_name && !currentMatch.away_name && !currentMatch.home_code && !currentMatch.away_code) {
    return true;
  }

  return matchesByTeamsOrCodes(currentMatch, persistedMatch) || matchesByTeamsOrCodes(currentMatch, persistedMatch, true);
}

function isSafeToPersistFinished(match) {
  if (!match.id) {
    return false;
  }

  if (!match.home_name || !match.away_name) {
    return false;
  }

  if (match.score_home == null || match.score_away == null) {
    return false;
  }

  return true;
}

function getFinishedSnapshotQuality(match) {
  let score = 0;

  if (match.score_home != null && match.score_away != null) score += 5;
  if (match.status === "FINISHED") score += 3;
  if (match.espn_id) score += 2;
  if (match.clock_source === "espn") score += 1;
  if (match.extra_time) score += 1;
  if (match.penalties) score += 1;
  if (match.home_code && match.away_code) score += 1;
  if (match.home_name && match.away_name) score += 1;

  return score;
}

function isExtraTimeMatch(match) {
  const raw = String(match && match.status_raw ? match.status_raw : "").toUpperCase();
  const displayClock = String(match && match.display_clock ? match.display_clock : "").toUpperCase();
  return raw.includes("ET") || raw.includes("AET") || raw.includes("EXTRA") || raw.includes("PENS") || displayClock.includes("120");
}

function isPenaltyShootoutMatch(match) {
  const raw = String(match && match.status_raw ? match.status_raw : "").toUpperCase();
  return raw.includes("PENS") || raw.includes("PEN") || raw.includes("PENAL");
}

function extractPenaltyScore(match) {
  return {
    home: toNumberOrNull(
      match && match.home_penalty_score,
      match && match.penalty_score_home,
      match && match.home_penalties,
      match && match.penalties_home
    ),
    away: toNumberOrNull(
      match && match.away_penalty_score,
      match && match.penalty_score_away,
      match && match.away_penalties,
      match && match.penalties_away
    )
  };
}

function inferPenaltyWinner(penaltyScore) {
  if (!penaltyScore || penaltyScore.home == null || penaltyScore.away == null) {
    return null;
  }

  if (penaltyScore.home === penaltyScore.away) {
    return null;
  }

  return penaltyScore.home > penaltyScore.away ? "home" : "away";
}

function buildStableId(item, kickoffIso) {
  const home = firstString(item.home, item.home_code, item.home_name, item.home_team_name_en, "home");
  const away = firstString(item.away, item.away_code, item.away_name, item.away_team_name_en, "away");
  const kickoff = kickoffIso || firstString(item.date, item.time_utc, item.local_date, "unknown-time");

  if (home !== "home" && away !== "away") {
    return `${home}-${away}-${kickoff}`
      .toLowerCase()
      .replace(/[^\w-]+/g, "-")
      .replace(/-+/g, "-");
  }

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

  return `${home}-${away}-${kickoff}`.toLowerCase().replace(/[^\w-]+/g, "-").replace(/-+/g, "-");
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

function cloneBracketPayload(payload, overrides) {
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
        : payload.meta.cache_stale
    },
    stages: payload.stages.map((stage) => ({
      ...stage,
      matches: stage.matches.map((match) => ({ ...match }))
    }))
  };
}

function buildBracketPayload(results, generatedAt) {
  const resultMap = new Map();
  for (const match of Array.isArray(results) ? results : []) {
    if (match && match.match_number != null) {
      resultMap.set(match.match_number, match);
    }
  }

  const nodeMap = new Map();
  const stages = [
    buildBracketStage("r32", "R32", [
      { match_number: 76, label: "Brazil vs Japan" },
      { match_number: 78, label: "Ivory Coast vs Norway" },
      { match_number: 73, label: "South Africa vs Canada" },
      { match_number: 74, label: "Germany vs Paraguay" },
      { match_number: 75, label: "Netherlands vs Morocco" },
      { match_number: 77, label: "France vs Sweden" },
      { match_number: 79, label: "Mexico vs Ecuador" },
      { match_number: 80, label: "England vs Congo DR" },
      { match_number: 83, label: "Spain vs Austria" },
      { match_number: 84, label: "Portugal vs Croatia" },
      { match_number: 82, label: "Belgium vs Senegal" },
      { match_number: 81, label: "United States vs Bosnia" },
      { match_number: 88, label: "Australia vs Egypt" },
      { match_number: 87, label: "Colombia vs Ghana" },
      { match_number: 85, label: "Switzerland vs Algeria" },
      { match_number: 86, label: "Argentina vs Cape Verde" }
    ], resultMap, nodeMap),
    buildBracketStage("r16", "R16", [
      { match_number: 89, source_match_numbers: [76, 78] },
      { match_number: 90, source_match_numbers: [73, 74] },
      { match_number: 91, source_match_numbers: [75, 77] },
      { match_number: 92, source_match_numbers: [79, 80] },
      { match_number: 93, source_match_numbers: [83, 84] },
      { match_number: 94, source_match_numbers: [82, 81] },
      { match_number: 95, source_match_numbers: [88, 87] },
      { match_number: 96, source_match_numbers: [85, 86] }
    ], resultMap, nodeMap),
    buildBracketStage("qf", "QF", [
      { match_number: 97, source_match_numbers: [89, 90] },
      { match_number: 98, source_match_numbers: [91, 92] },
      { match_number: 99, source_match_numbers: [93, 94] },
      { match_number: 100, source_match_numbers: [95, 96] }
    ], resultMap, nodeMap),
    buildBracketStage("sf", "SF", [
      { match_number: 101, source_match_numbers: [97, 98] },
      { match_number: 102, source_match_numbers: [99, 100] }
    ], resultMap, nodeMap),
    buildBracketStage("third", "3rd", [
      { match_number: 103, source_match_numbers: [101, 102], placement: "THIRD_PLACE" }
    ], resultMap, nodeMap),
    buildBracketStage("final", "F", [
      { match_number: 104, source_match_numbers: [101, 102], placement: "FINAL" }
    ], resultMap, nodeMap)
  ];

  return {
    meta: {
      generated_at: generatedAt,
      served_from_cache: false,
      cache_updated_at: generatedAt,
      cache_stale: false,
      refresh_interval_seconds: CACHE_TTL_SECONDS
    },
    stages
  };
}

function buildBracketStage(key, label, slots, resultMap, nodeMap) {
  return {
    key,
    label,
    matches: slots.map((slot, index) => {
      const match = buildBracketMatch(slot, resultMap, index, nodeMap);
      if (match.match_number != null) {
        nodeMap.set(match.match_number, match);
      }
      return match;
    })
  };
}

function buildBracketMatch(slot, resultMap, orderIndex, nodeMap) {
  const current = slot.match_number != null ? resultMap.get(slot.match_number) : null;
  const sourceMatches = Array.isArray(slot.source_match_numbers)
    ? slot.source_match_numbers.map((number) => resultMap.get(number) || (nodeMap && nodeMap.get(number)) || null).filter(Boolean)
    : [];
  const status = current ? normalizeStatus(current.status, "PENDING") : resolveBracketStatus(sourceMatches);
  const winnerSide = current ? resolveWinnerSide(current) : resolveBracketWinnerSide(sourceMatches);
  const participants = resolveBracketParticipants(current, sourceMatches, slot);
  const winnerTeam = current ? resolveWinnerTeam(current, winnerSide) : resolveBracketWinnerTeam(sourceMatches, winnerSide);
  const currentMatchNumber = slot.match_number != null
    ? slot.match_number
    : (current && current.match_number != null ? current.match_number : null);
  const extraTime = current ? Boolean(current.extra_time || current.penalties) : resolveBracketExtraTime(sourceMatches);
  const penalties = current ? Boolean(current.penalties) : resolveBracketPenalties(sourceMatches);
  const penaltyScore = current ? extractPenaltyScore(current) : resolveBracketPenaltyScore(sourceMatches);

  return {
    id: slot.id || (current && current.id) || `M${currentMatchNumber || orderIndex + 1}`,
    match_number: currentMatchNumber,
    slot_index: orderIndex + 1,
    source_match_numbers: slot.source_match_numbers || null,
    placement: slot.placement || null,
    home: participants.home,
    away: participants.away,
    score_home: current && current.score_home != null ? current.score_home : null,
    score_away: current && current.score_away != null ? current.score_away : null,
    status,
    winner_side: winnerSide,
    advance_home: winnerSide === "home",
    advance_away: winnerSide === "away",
    winner: winnerTeam,
    extra_time: extraTime,
    penalties,
    penalty_score_home: penaltyScore.home,
    penalty_score_away: penaltyScore.away,
    penalty_winner: current && current.penalty_winner ? current.penalty_winner : inferPenaltyWinner(penaltyScore),
    pending_sources: current ? [] : (slot.source_match_numbers || []).map((number) => `M${number}`),
    next_match_number: resolveNextMatchNumber(currentMatchNumber)
  };
}

function resolveBracketParticipants(current, sourceMatches, slot) {
  if (current && current.home_name && current.away_name) {
    return {
      home: { code: current.home_code || null, name: canonicalTeamName(current.home_name, current.home_code) },
      away: { code: current.away_code || null, name: canonicalTeamName(current.away_name, current.away_code) }
    };
  }

  const homeSource = sourceMatches[0] || null;
  const awaySource = sourceMatches[1] || null;
  return {
    home: resolveBracketParticipant(homeSource, "home", slot),
    away: resolveBracketParticipant(awaySource, "away", slot)
  };
}

function resolveBracketParticipant(match, side, slot) {
  if (!match) {
    return { code: null, name: null };
  }

  if (slot && slot.placement === "THIRD_PLACE") {
    return resolveBracketLoserParticipant(match, side);
  }

  if (match.winner && match.winner.code) {
    return { code: match.winner.code, name: canonicalTeamName(match.winner.name, match.winner.code) };
  }

  if (match.status === "FINISHED") {
    const winnerSide = resolveWinnerSide(match);
    if (winnerSide === "away") {
      return { code: match.away_code || null, name: canonicalTeamName(match.away_name, match.away_code) };
    }
    return { code: match.home_code || null, name: canonicalTeamName(match.home_name, match.home_code) };
  }

  if (side === "away") {
    return { code: match.away_code || null, name: canonicalTeamName(match.away_name, match.away_code) };
  }

  return { code: match.home_code || null, name: canonicalTeamName(match.home_name, match.home_code) };
}

function resolveBracketLoserParticipant(match, side) {
  if (!match) {
    return { code: null, name: null };
  }

  if (match.status === "FINISHED") {
    const winnerSide = resolveWinnerSide(match);
    if (winnerSide === "home") {
      return { code: match.away_code || null, name: canonicalTeamName(match.away_name, match.away_code) };
    }
    if (winnerSide === "away") {
      return { code: match.home_code || null, name: canonicalTeamName(match.home_name, match.home_code) };
    }
  }

  if (side === "away") {
    return { code: match.home_code || null, name: canonicalTeamName(match.home_name, match.home_code) };
  }

  return { code: match.away_code || null, name: canonicalTeamName(match.away_name, match.away_code) };
}

function resolveBracketStatus(sourceMatches) {
  const matches = Array.isArray(sourceMatches) ? sourceMatches : [];
  if (matches.some((match) => normalizeStatus(match.status, "PENDING") === "FINISHED")) {
    return "FINISHED";
  }
  if (matches.some((match) => {
    const status = normalizeStatus(match.status, "PENDING");
    return status === "LIVE" || status === "HALFTIME";
  })) {
    return "LIVE";
  }
  return "PENDING";
}

function resolveBracketWinnerSide(sourceMatches) {
  const current = Array.isArray(sourceMatches) ? sourceMatches.find((match) => resolveWinnerSide(match)) : null;
  return current ? resolveWinnerSide(current) : null;
}

function resolveBracketWinnerTeam(sourceMatches, winnerSide) {
  if (!winnerSide || !Array.isArray(sourceMatches)) {
    return null;
  }

  const source = winnerSide === "away" ? (sourceMatches[1] || sourceMatches[0] || null) : (sourceMatches[0] || sourceMatches[1] || null);
  if (!source) {
    return null;
  }

  if (source.winner && source.winner.code) {
    return { code: source.winner.code, name: source.winner.name || source.winner.code };
  }

  return winnerSide === "away"
    ? { code: source.away_code || null, name: source.away_name || null }
    : { code: source.home_code || null, name: source.home_name || null };
}

function resolveBracketExtraTime(sourceMatches) {
  return Array.isArray(sourceMatches) ? sourceMatches.some((match) => Boolean(match && (match.extra_time || match.penalties))) : false;
}

function resolveBracketPenalties(sourceMatches) {
  return Array.isArray(sourceMatches) ? sourceMatches.some((match) => Boolean(match && match.penalties)) : false;
}

function resolveBracketPenaltyScore(sourceMatches) {
  const candidate = Array.isArray(sourceMatches) ? sourceMatches.find((match) => match && (match.penalty_score_home != null || match.penalty_score_away != null)) : null;
  if (!candidate) {
    return { home: null, away: null };
  }
  return {
    home: candidate.penalty_score_home != null ? candidate.penalty_score_home : null,
    away: candidate.penalty_score_away != null ? candidate.penalty_score_away : null
  };
}

function resolveWinnerSide(match) {
  if (!match) {
    return null;
  }

  if (match.penalties && match.penalty_winner) {
    return match.penalty_winner;
  }

  if (match.score_home == null || match.score_away == null) {
    return null;
  }

  if (match.score_home > match.score_away) {
    return "home";
  }

  if (match.score_away > match.score_home) {
    return "away";
  }

  return null;
}

function resolveWinnerTeam(match, winnerSide) {
  if (!match || !winnerSide) {
    return null;
  }

  if (winnerSide === "home") {
    return {
      code: match.home_code || null,
      name: match.home_name || null
    };
  }

  if (winnerSide === "away") {
    return {
      code: match.away_code || null,
      name: match.away_name || null
    };
  }

  return null;
}

function resolveNextMatchNumber(matchNumber) {
  if (matchNumber == null) {
    return null;
  }

  const nextMap = {
    M73: 90, M74: 90, M75: 91, M76: 89, M77: 91, M78: 89, M79: 92, M80: 92,
    M81: 94, M82: 94, M83: 93, M84: 93, M85: 96, M86: 96, M87: 95, M88: 95,
    M89: 97, M90: 97, M91: 98, M92: 98, M93: 99, M94: 99, M95: 100, M96: 100,
    M97: 101, M98: 101, M99: 102, M100: 102, M101: 104, M102: 104
  };

  return nextMap[`M${matchNumber}`] || null;
}

function persistCache(payload) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.warn("Cache persistence skipped:", error.message);
  }
}

function persistBracketCache(payload) {
  try {
    fs.mkdirSync(path.dirname(BRACKET_CACHE_FILE_PATH), { recursive: true });
    fs.writeFileSync(BRACKET_CACHE_FILE_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.warn("Bracket cache persistence skipped:", error.message);
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

function loadPersistedBracketCache() {
  try {
    if (!fs.existsSync(BRACKET_CACHE_FILE_PATH)) {
      return;
    }

    const fileContents = fs.readFileSync(BRACKET_CACHE_FILE_PATH, "utf8");
    const payload = JSON.parse(fileContents);

    if (payload && payload.meta && Array.isArray(payload.stages)) {
      bracketCacheState.data = payload;
      bracketCacheState.updatedAt = payload.meta.cache_updated_at
        ? Date.parse(payload.meta.cache_updated_at)
        : Date.now();
    }
  } catch (error) {
    console.warn("Unable to load persisted bracket cache:", error.message);
  }
}

function loadFinishedResultsCache() {
  try {
    if (!fs.existsSync(FINISHED_RESULTS_FILE_PATH)) {
      finishedCacheState.loaded = true;
      finishedCacheState.error = null;
      return;
    }

    const fileContents = fs.readFileSync(FINISHED_RESULTS_FILE_PATH, "utf8");
    const payload = JSON.parse(fileContents);
    const results = Array.isArray(payload) ? payload : Array.isArray(payload && payload.results) ? payload.results : [];
    const deduped = dedupeMatches(results);

    finishedCacheState.byId = new Map();
    finishedCacheState.byMatchNumber = new Map();

    for (const match of deduped) {
      if (match.id) {
        finishedCacheState.byId.set(match.id, match);
      }
      if (match.match_number != null) {
        finishedCacheState.byMatchNumber.set(match.match_number, match);
      }
    }

    finishedCacheState.loaded = true;
    finishedCacheState.error = null;
  } catch (error) {
    finishedCacheState.loaded = false;
    finishedCacheState.error = error.message;
    console.warn("Unable to load finished results cache:", error.message);
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

function parseAllowedOrigins(value) {
  return String(value)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function refererMatchesAllowedOrigin(referer) {
  return Array.from(ALLOWED_ORIGINS).some((origin) => referer.startsWith(origin));
}

function buildTeamSignature(match) {
  const home = normalizeTeamToken(match.home_name || match.home_code);
  const away = normalizeTeamToken(match.away_name || match.away_code);

  if (!home || !away) {
    return null;
  }

  return `${home}__${away}`;
}

function buildCodeSignature(match) {
  const home = normalizeTeamToken(match.home_code);
  const away = normalizeTeamToken(match.away_code);

  if (!home || !away) {
    return null;
  }

  return `${home}__${away}`;
}

function buildReversedTeamSignature(match) {
  const home = normalizeTeamToken(match.away_name || match.away_code);
  const away = normalizeTeamToken(match.home_name || match.home_code);

  if (!home || !away) {
    return null;
  }

  return `${home}__${away}`;
}

function buildReversedCodeSignature(match) {
  const home = normalizeTeamToken(match.away_code);
  const away = normalizeTeamToken(match.home_code);

  if (!home || !away) {
    return null;
  }

  return `${home}__${away}`;
}

function sameFixtureIdentity(left, right) {
  if (!left || !right) {
    return true;
  }

  const sameCodes = teamTokenEquals(left.home_code, right.home_code) && teamTokenEquals(left.away_code, right.away_code);
  const sameNames = teamTokenEquals(left.home_name, right.home_name) && teamTokenEquals(left.away_name, right.away_name);
  const reversedCodes = teamTokenEquals(left.home_code, right.away_code) && teamTokenEquals(left.away_code, right.home_code);
  const reversedNames = teamTokenEquals(left.home_name, right.away_name) && teamTokenEquals(left.away_name, right.home_name);

  if (sameCodes || sameNames || reversedCodes || reversedNames) {
    return true;
  }

  return false;
}

function matchesByTeamsOrCodes(match, candidate, reversed = false) {
  const matchHomeName = reversed ? match.away_name : match.home_name;
  const matchAwayName = reversed ? match.home_name : match.away_name;
  const matchHomeCode = reversed ? match.away_code : match.home_code;
  const matchAwayCode = reversed ? match.home_code : match.away_code;

  const namesMatch = teamTokenEquals(matchHomeName, candidate.home_name) && teamTokenEquals(matchAwayName, candidate.away_name);
  const codesMatch = teamTokenEquals(matchHomeCode, candidate.home_code) && teamTokenEquals(matchAwayCode, candidate.away_code);

  return namesMatch || codesMatch;
}

function kickoffApproximatelyMatches(leftKickoff, rightKickoff) {
  const diff = getKickoffDifferenceMs(leftKickoff, rightKickoff);
  return Number.isFinite(diff) && diff <= 60 * 60 * 1000;
}

function getKickoffDifferenceMs(leftKickoff, rightKickoff) {
  const leftMs = leftKickoff ? Date.parse(leftKickoff) : Number.NaN;
  const rightMs = rightKickoff ? Date.parse(rightKickoff) : Number.NaN;

  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(leftMs - rightMs);
}

function normalizeTeamToken(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const canonical = applyTeamAlias(value);

  return canonical
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function applyTeamAlias(value) {
  const normalized = String(value).trim().toLowerCase();
  const aliases = new Map([
    ["usa", "united states"],
    ["united states of america", "united states"],
    ["uru", "uruguay"],
    ["ury", "uruguay"],
    ["cpv", "cape verde"],
    ["cape verde islands", "cape verde"],
    ["south korea", "korea republic"],
    ["czechia", "czech republic"],
    ["ivory coast", "cote divoire"],
    ["côte d’ivoire", "cote divoire"],
    ["côte d'ivoire", "cote divoire"],
    ["dr congo", "democratic republic of the congo"],
    ["congo dr", "democratic republic of the congo"],
    ["curacao", "curaçao"]
  ]);

  return aliases.get(normalized) || normalized;
}

function canonicalTeamName(name, code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (TEAM_CANONICAL_NAMES[normalizedCode]) {
    return TEAM_CANONICAL_NAMES[normalizedCode];
  }

  const normalizedAlias = normalizeTeamAliasKey(name);
  if (normalizedAlias && TEAM_CANONICAL_NAMES_BY_ALIAS[normalizedAlias]) {
    return TEAM_CANONICAL_NAMES_BY_ALIAS[normalizedAlias];
  }

  return firstString(name) || null;
}

function normalizeTeamAliasKey(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamTokenEquals(left, right) {
  const leftToken = normalizeTeamToken(left);
  const rightToken = normalizeTeamToken(right);
  return Boolean(leftToken && rightToken && leftToken === rightToken);
}

function createHttpError(statusCode, publicMessage, internalMessage) {
  const error = new Error(internalMessage || publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}
