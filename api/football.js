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
// API-FOOTBALL İSTEK
// ==========================================

async function apiRequest(path, apiKey) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "x-apisports-key": apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`API-Football HTTP hatası: ${response.status}`);
  }

  const data = await response.json();

  if (
    data.errors &&
    (
      (Array.isArray(data.errors) && data.errors.length > 0) ||
      (!Array.isArray(data.errors) &&
        typeof data.errors === "object" &&
        Object.keys(data.errors).length > 0)
    )
  ) {
    console.error("API errors:", data.errors);

    throw new Error("API-Football veri hatası oluştu.");
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
    .map(item => {
      return {
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
      };
    })
    .sort((a, b) => {
      return (a.time || "").localeCompare(b.time || "");
    });

  return res.status(200).json({
    fixtures
  });
}


// ==========================================
// İKİ TAKIMI ANALİZ ET
// ==========================================

async function analyzeTeams(req, res, apiKey) {
  const homeId = Number(req.query.home);
  const awayId = Number(req.query.away);

  if (!homeId || !awayId) {
    return res.status(400).json({
      error: "Takım ID bilgileri eksik."
    });
  }

  const [home, away] = await Promise.all([
    buildTeamAnalysis(homeId, apiKey),
    buildTeamAnalysis(awayId, apiKey)
  ]);

  return res.status(200).json({
    home,
    away
  });
}


// ==========================================
// TAKIMIN SON 5 MAÇI
// ==========================================

async function buildTeamAnalysis(teamId, apiKey) {
  const data = await apiRequest(
    `/fixtures?team=${teamId}&last=5&timezone=Europe%2FIstanbul`,
    apiKey
  );

  const fixtures = data.response || [];

  if (fixtures.length === 0) {
    return {
      name: "Takım",
      matches: [],
      average: null
    };
  }

  const teamName =
    fixtures[0].teams.home.id === teamId
      ? fixtures[0].teams.home.name
      : fixtures[0].teams.away.name;

  const matches = await Promise.all(
    fixtures.map(fixture =>
      buildMatchStats(fixture, teamId, apiKey)
    )
  );

  return {
    id: teamId,
    name: teamName,
    matches,
    average: calculateAverage(matches)
  };
}


// ==========================================
// TEK MAÇ İSTATİSTİKLERİ
// ==========================================

async function buildMatchStats(fixture, teamId, apiKey) {
  const fixtureId = fixture.fixture.id;

  const statsData = await apiRequest(
    `/fixtures/statistics?fixture=${fixtureId}`,
    apiKey
  );

  const teamStats = (statsData.response || []).find(
    item => Number(item.team.id) === Number(teamId)
  );

  const stats = teamStats?.statistics || [];

  return {
    fixtureId,

    date: fixture.fixture.date,

    home: fixture.teams.home.name,
    away: fixture.teams.away.name,

    score: `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,

    shots: getStat(stats, "Total Shots"),

    shotsOnTarget: getStat(
      stats,
      "Shots on Goal",
      "Shots on Target"
    ),

    corners: getStat(stats, "Corner Kicks"),

    saves: getStat(
      stats,
      "Goalkeeper Saves"
    ),

    isHome:
      Number(fixture.teams.home.id) === Number(teamId)
  };
}


// ==========================================
// İSTATİSTİK BUL
// ==========================================

function getStat(stats, ...names) {
  for (const name of names) {
    const found = stats.find(
      stat =>
        String(stat.type).toLowerCase() ===
        String(name).toLowerCase()
    );

    if (found) {
      return normalizeNumber(found.value);
    }
  }

  return null;
}


// ==========================================
// SAYI TEMİZLE
// ==========================================

function normalizeNumber(value) {
  if (value === null || value === undefined) {
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
// SON 5 ORTALAMA
// ==========================================

function calculateAverage(matches) {
  return {
    shots: average(matches, "shots"),

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

  if (values.length === 0) {
    return null;
  }

  const total = values.reduce(
    (sum, value) => sum + value,
    0
  );

  return Number(
    (total / values.length).toFixed(1)
  );
}


// ==========================================
// SAAT
// ==========================================

function formatTime(dateString) {
  if (!dateString) return "";

  return new Intl.DateTimeFormat(
    "tr-TR",
    {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  ).format(new Date(dateString));
}
