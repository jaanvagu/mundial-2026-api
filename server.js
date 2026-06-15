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
const ALLOW_ALL_ORIGINS = String(process.env.ALLOW_ALL_ORIGINS).toLowerCase() === "true";
const ESPN_ENABLED = process.env.ESPN_ENABLED !== "false";
const ESPN_SCOREBOARD_URL = process.env.ESPN_SCOREBOARD_URL || "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard";
const ESPN_WORLD_CUP_LEAGUE_UID_TOKEN = process.env.ESPN_WORLD_CUP_LEAGUE_UID_TOKEN || "~l:606~";
const CACHE_FILE_PATH = path.join(__dirname, "data", "cache", "results-cache.json");
const FINISHED_RESULTS_FILE_PATH = path.join(__dirname, "data", "cache", "finished-results.json");
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

const cacheState = {
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
  const frozenResults = applyFinishedResultsCache(mergedResults);
  const espnSource = await fetchEspnRelevantMatches(
    frozenResults.filter((match) => match.status !== "FINISHED"),
    generatedAt
  );
  const enrichedResults = enrichMatchesWithEspn(frozenResults, espnSource.matches, generatedAt);
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
  const normalizedStatus = normalizeEspnStatus(statusType, displayClock);
  const elapsed = shouldUseEspnElapsed(normalizedStatus.status) ? (normalizedStatus.elapsedOverride != null ? normalizedStatus.elapsedOverride : parsedClock) : null;
  const estimatedElapsed = shouldUseEspnElapsed(normalizedStatus.status) && elapsed != null ? false : null;

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
    status_raw: firstString(statusType.detail, statusType.description, statusType.name, competitionStatus.displayClock),
    elapsed,
    estimated_elapsed: estimatedElapsed,
    display_clock: displayClock || null,
    clock_source: "espn",
    period: toNumberOrNull(competitionStatus.period),
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
    const fallback = (teamSignature ? fallbackMapByTeams.get(teamSignature) : null)
      || fallbackMapById.get(primary.id)
      || (primary.match_number != null ? fallbackMapByMatchNumber.get(primary.match_number) : null);
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
    if (match.status === "FINISHED" && isPersistedFinishedMatch(match)) {
      return match;
    }

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
      score_home: hasUsableScores ? espnScoreHome : match.score_home,
      score_away: hasUsableScores ? espnScoreAway : match.score_away,
      status: authoritativeStatus ? espnMatch.status : match.status,
      status_raw: authoritativeStatus ? espnMatch.status_raw : match.status_raw,
      elapsed: hasUsableClock ? espnMatch.elapsed : match.elapsed,
      estimated_elapsed: hasUsableClock ? false : match.estimated_elapsed,
      last_seen_at: generatedAt,
      espn_id: espnMatch.espn_id || null,
      clock_source: hasUsableClock ? "espn" : match.clock_source,
      display_clock: espnMatch.display_clock || match.display_clock || null
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

function normalizeEspnStatus(statusType, displayClock) {
  const state = firstString(statusType && statusType.state);
  const description = firstString(statusType && statusType.description, statusType && statusType.name, displayClock);
  const normalizedState = state ? state.toLowerCase() : "";
  const normalizedDescription = description ? description.toLowerCase() : "";

  if (normalizedState === "pre" || normalizedDescription.includes("scheduled")) {
    return {
      status: "SCHEDULED",
      elapsedOverride: null,
      estimated_elapsed: null
    };
  }

  if (normalizedDescription.includes("half") || String(displayClock || "").toUpperCase() === "HT") {
    return {
      status: "HALFTIME",
      elapsedOverride: 45,
      estimated_elapsed: false
    };
  }

  if (normalizedState === "in") {
    return {
      status: "LIVE",
      elapsedOverride: null,
      estimated_elapsed: false
    };
  }

  if (normalizedState === "post" || statusType.completed || normalizedDescription.includes("final") || String(displayClock || "").toUpperCase() === "FT") {
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
  if (compact === "HT") {
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

function getRelevantEspnDates(matches, generatedAt) {
  const nowMs = Date.parse(generatedAt);
  const dates = new Set([formatUtcDateYYYYMMDD(nowMs)]);

  for (const match of matches) {
    const kickoffMs = match.kickoff_utc ? Date.parse(match.kickoff_utc) : Number.NaN;
    if (Number.isNaN(kickoffMs)) {
      continue;
    }

    const diffMinutes = (nowMs - kickoffMs) / 60000;
    if (diffMinutes >= -15 && diffMinutes <= 140) {
      dates.add(formatUtcDateYYYYMMDD(kickoffMs));
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

  return publicMatch;
}

function applyFinishedResultsCache(matches) {
  return matches.map((match) => {
    const persisted = findPersistedFinishedMatch(match);
    if (!persisted) {
      return match;
    }

    return {
      ...match,
      ...persisted,
      id: persisted.id || match.id,
      match_number: persisted.match_number != null ? persisted.match_number : match.match_number,
      home_code: persisted.home_code || match.home_code,
      away_code: persisted.away_code || match.away_code,
      home_name: persisted.home_name || match.home_name,
      away_name: persisted.away_name || match.away_name,
      kickoff_utc: match.kickoff_utc || persisted.kickoff_utc || null
    };
  });
}

function findPersistedFinishedMatch(match) {
  if (match.id && finishedCacheState.byId.has(match.id)) {
    return finishedCacheState.byId.get(match.id);
  }

  if (match.match_number != null && finishedCacheState.byMatchNumber.has(match.match_number)) {
    return finishedCacheState.byMatchNumber.get(match.match_number);
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
    const persisted = new Map(finishedCacheState.byId);

    for (const match of matches) {
      if (match.status !== "FINISHED") {
        continue;
      }

      const snapshot = createFinishedSnapshot(match);
      if (snapshot.id) {
        persisted.set(snapshot.id, snapshot);
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
  return {
    id: match.id,
    match_number: match.match_number ?? null,
    home_code: match.home_code ?? null,
    away_code: match.away_code ?? null,
    home_name: match.home_name ?? null,
    away_name: match.away_name ?? null,
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
    kickoff_utc: match.kickoff_utc ?? null
  };
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
  return Number.isFinite(diff) && diff <= 12 * 60 * 60 * 1000;
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
