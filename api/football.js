const API_BASE = "https://v3.football.api-sports.io";

module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.API_FOOTBALL_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "API_FOOTBALL_KEY tanımlı değil."
      });
    }

    const { action } = req.query;

    if (action === "fixtures") {
      return await getFixtures(req, res, apiKey);
    }

    if (action === "analyze") {
      return await analyzeTeams(req, res, apiKey);
    }

    return res.status(400).json({
      error: "Geçersiz işlem."
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || "Sunucu hatası."
    });
  }
};


// ==========================================
// API-FOOTBALL
// ==========================================

async function apiRequest(path, apiKey) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "x-apisports-key": apiKey
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `API-Football HTTP ${response.status}`
    );
  }

  if (data.errors) {
    const hasErrors =
      Array.isArray(data.errors)
        ? data.errors.length > 0
        : Object.keys(data.errors).length > 0;

    if (hasErrors) {
      const message =
        typeof data.errors === "object"
          ? JSON.stringify(data.errors)
          : String(data.errors);

      throw new Error(
        `API-Football: ${message}`
      );
    }
  }

  return data;
}


// ==========================================
// GÜNÜN MAÇLARI
// ==========================================

async function getFixtures(req, res, apiKey) {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({
      error: "Tarih eksik."
    });
  }

  const data = await apiRequest(
    `/fixtures?date=${encodeURIComponent(date)}&timezone=Europe%2FIstanbul`,
    apiKey
  );

  const fixtures = (data.response || [])
    .map(item => ({
      fixtureId: item.fixture.id,

      league: [
        item.league?.country,
        item.league?.name
      ]
        .filter(Boolean)
        .join(" • "),

      time: formatTime(item.fixture.date),

      homeId: item.teams.home.id,
      home: item.teams.home.name,

      awayId: item.teams.away.id,
      away: item.teams.away.name,

      status: item.fixture.status.short
    }))
    .sort((a, b) =>
      (a.time || "").localeCompare(b.time || "")
    );

  res.setHeader(
    "Cache-Control",
    "s-maxage=60, stale-while-revalidate=300"
  );

  return res.status(200).json({
    fixtures
  });
}


// ==========================================
// ANALİZ
// ==========================================

async function analyzeTeams(req, res, apiKey) {
  const homeId = Number(req.query.home);
  const awayId = Number(req.query.away);

  if (!homeId || !awayId) {
    return res.status(400).json({
      error: "Takım ID bilgileri eksik."
    });
  }

  // İki takımın son 5 maçını çek.
  // Yalnızca 2 API isteği.
  const [homeData, awayData] = await Promise.all([
    apiRequest(
      `/fixtures?team=${homeId}&last=5&timezone=Europe%2FIstanbul`,
      apiKey
    ),

    apiRequest(
      `/fixtures?team=${awayId}&last=5&timezone=Europe%2FIstanbul`,
      apiKey
    )
  ]);

  const homeFixtures = homeData.response || [];
  const awayFixtures = awayData.response || [];

  // İki takımın maç ID'lerini birleştir.
  // Aynı maç iki listede varsa tek kez al.
  const fixtureIds = [
    ...new Set([
      ...homeFixtures.map(x => x.fixture.id),
      ...awayFixtures.map(x => x.fixture.id)
    ])
  ];

  let detailedFixtures = [];

  if (fixtureIds.length > 0) {
    const ids = fixtureIds.join("-");

    // Bütün maç detaylarını TEK API isteğinde al.
    const details = await apiRequest(
      `/fixtures?ids=${ids}&timezone=Europe%2FIstanbul`,
      apiKey
    );

    detailedFixtures = details.response || [];
  }

  const detailsMap = new Map();

  detailedFixtures.forEach(item => {
    detailsMap.set(
      Number(item.fixture.id),
      item
    );
  });

  const home = buildTeamAnalysis(
    homeId,
    homeFixtures,
    detailsMap
  );

  const away = buildTeamAnalysis(
    awayId,
    awayFixtures,
    detailsMap
  );

  res.setHeader(
    "Cache-Control",
    "s-maxage=300, stale-while-revalidate=3600"
  );

  return res.status(200).json({
    home,
    away
  });
}


// ==========================================
// TAKIM ANALİZİ
// ==========================================

function buildTeamAnalysis(
  teamId,
  fixtures,
  detailsMap
) {
  if (!fixtures.length) {
    return {
      id: teamId,
      name: "Takım",
      matches: [],
      average: null
    };
  }

  const first = fixtures[0];

  const teamName =
    Number(first.teams.home.id) === Number(teamId)
      ? first.teams.home.name
      : first.teams.away.name;

  const matches = fixtures.map(baseFixture => {
    const fixtureId =
      Number(baseFixture.fixture.id);

    const detailed =
      detailsMap.get(fixtureId) ||
      baseFixture;

    return buildMatchStats(
      detailed,
      teamId
    );
  });

  return {
    id: teamId,
    name: teamName,
    matches,
    average: calculateAverage(matches)
  };
}


// ==========================================
// MAÇ İSTATİSTİĞİ
// ==========================================

function buildMatchStats(fixture, teamId) {
  const statistics =
    fixture.statistics || [];

  const teamStats =
    statistics.find(
      item =>
        Number(item.team?.id) ===
        Number(teamId)
    );

  const stats =
    teamStats?.statistics || [];

  return {
    fixtureId: fixture.fixture.id,

    date: fixture.fixture.date,

    home: fixture.teams.home.name,

    away: fixture.teams.away.name,

    score:
      `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,

    shots: getStat(
      stats,
      "Total Shots"
    ),

    shotsOnTarget: getStat(
      stats,
      "Shots on Goal",
      "Shots on Target"
    ),

    corners: getStat(
      stats,
      "Corner Kicks"
    ),

    saves: getStat(
      stats,
      "Goalkeeper Saves"
    ),

    isHome:
      Number(fixture.teams.home.id) ===
      Number(teamId)
  };
}


// ==========================================
// İSTATİSTİK BUL
// ==========================================

function getStat(stats, ...names) {
  for (const name of names) {
    const found = stats.find(
      stat =>
        String(stat.type)
          .toLowerCase()
          .trim() ===
        String(name)
          .toLowerCase()
          .trim()
    );

    if (found) {
      return normalizeNumber(
        found.value
      );
    }
  }

  return null;
}


// ==========================================
// SAYI TEMİZLE
// ==========================================

function normalizeNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (typeof value === "number") {
    return value;
  }

  const cleaned = String(value)
    .replace("%", "")
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : null;
}


// ==========================================
// ORTALAMA
// ==========================================

function calculateAverage(matches) {
  return {
    shots: average(
      matches,
      "shots"
    ),

    shotsOnTarget: average(
      matches,
      "shotsOnTarget"
    ),

    corners: average(
      matches,
      "corners"
    ),

    saves: average(
      matches,
      "saves"
    )
  };
}


function average(items, key) {
  const values = items
    .map(item => item[key])
    .filter(
      value =>
        typeof value === "number" &&
        Number.isFinite(value)
    );

  if (!values.length) {
    return null;
  }

  const total = values.reduce(
    (sum, value) =>
      sum + value,
    0
  );

  return Number(
    (total / values.length)
      .toFixed(1)
  );
}


// ==========================================
// SAAT
// ==========================================

function formatTime(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "tr-TR",
    {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  ).format(
    new Date(dateString)
  );
}
