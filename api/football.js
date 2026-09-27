const API_BASE = "https://v3.football.api-sports.io";


// ======================================================
// SADECE KULLANACAĞIMIZ 40 LİG
// 37 yerel lig + ŞL + Avrupa Ligi + Konferans Ligi
// ======================================================

const ALLOWED_LEAGUE_IDS = new Set([
  140, // İspanya La Liga
  39,  // İngiltere Premier League
  40,  // İngiltere Championship
  135, // İtalya Serie A
  61,  // Fransa Ligue 1
  62,  // Fransa Ligue 2
  78,  // Almanya Bundesliga
  79,  // Almanya 2. Bundesliga
  80,  // Almanya 3. Liga
  94,  // Portekiz Primeira Liga
  203, // Türkiye Süper Lig
  244, // Finlandiya Veikkausliiga
  219, // Avusturya 2. Liga
  119, // Danimarka Superliga
  114, // İsveç Superettan
  103, // Norveç Eliteserien
  218, // Avusturya Bundesliga
  88,  // Hollanda Eredivisie
  89,  // Hollanda Eerste Divisie
  180, // İskoçya Championship
  106, // Polonya Ekstraklasa
  63,  // Fransa National
  144, // Belçika Pro League
  357, // İrlanda Premier Division
  408, // Kuzey İrlanda Premiership
  120, // Danimarka 1st Division
  235, // Rusya Premier League
  113, // İsveç Allsvenskan
  41,  // İngiltere League One
  42,  // İngiltere League Two
  179, // İskoçya Premiership
  207, // İsviçre Super League
  141, // İspanya Segunda División
  197, // Yunanistan Super League
  169, // Çin Super League
  253, // MLS
  43,  // İngiltere National League

  // UEFA
  2,   // Champions League
  3,   // Europa League
  848  // Conference League
]);


// ======================================================
// ANA HANDLER
// ======================================================

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


// ======================================================
// API-FOOTBALL İSTEK
// ======================================================

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


// ======================================================
// GÜNÜN MAÇLARI
// SADECE 40 LİGLİK WHITELIST
// ======================================================

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

  const allFixtures = data.response || [];

  // SADECE BİZİM LİGLER
  const filteredFixtures = allFixtures.filter(item => {
    const leagueId = Number(item.league?.id);

    return ALLOWED_LEAGUE_IDS.has(leagueId);
  });

  const fixtures = filteredFixtures
    .map(item => ({
      fixtureId: item.fixture.id,

      leagueId: item.league.id,

      league: [
        item.league?.country,
        item.league?.name
      ]
        .filter(Boolean)
        .join(" • "),

      leagueLogo: item.league?.logo || null,

      time: formatTime(item.fixture.date),

      homeId: item.teams.home.id,
      home: item.teams.home.name,
      homeLogo: item.teams.home.logo,

      awayId: item.teams.away.id,
      away: item.teams.away.name,
      awayLogo: item.teams.away.logo,

      status: item.fixture.status.short
    }))
    .sort((a, b) => {
      return (a.time || "").localeCompare(
        b.time || ""
      );
    });

  res.setHeader(
    "Cache-Control",
    "s-maxage=60, stale-while-revalidate=300"
  );

  return res.status(200).json({
    fixtures,
    total: fixtures.length
  });
}


// ======================================================
// ANALİZ
// ======================================================

async function analyzeTeams(req, res, apiKey) {
  const homeId = Number(req.query.home);
  const awayId = Number(req.query.away);

  if (!homeId || !awayId) {
    return res.status(400).json({
      error: "Takım ID bilgileri eksik."
    });
  }

  // İki takımın son 5 maçını çekiyoruz.
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

  const homeFixtures =
    homeData.response || [];

  const awayFixtures =
    awayData.response || [];

  // İki takımın geçmiş maç ID'lerini birleştir.
  // Aynı fixture iki kez varsa tek kalır.
  const fixtureIds = [
    ...new Set([
      ...homeFixtures.map(
        x => Number(x.fixture.id)
      ),

      ...awayFixtures.map(
        x => Number(x.fixture.id)
      )
    ])
  ];

  let detailedFixtures = [];

  if (fixtureIds.length > 0) {
    const ids =
      fixtureIds.join("-");

    const details =
      await apiRequest(
        `/fixtures?ids=${ids}&timezone=Europe%2FIstanbul`,
        apiKey
      );

    detailedFixtures =
      details.response || [];
  }

  const detailsMap =
    new Map();

  detailedFixtures.forEach(item => {
    detailsMap.set(
      Number(item.fixture.id),
      item
    );
  });

  const home =
    buildTeamAnalysis(
      homeId,
      homeFixtures,
      detailsMap
    );

  const away =
    buildTeamAnalysis(
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


// ======================================================
// TAKIM ANALİZİ
// ======================================================

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

  const first =
    fixtures[0];

  const teamName =
    Number(first.teams.home.id) === Number(teamId)
      ? first.teams.home.name
      : first.teams.away.name;

  const teamLogo =
    Number(first.teams.home.id) === Number(teamId)
      ? first.teams.home.logo
      : first.teams.away.logo;

  const matches =
    fixtures.map(baseFixture => {
      const fixtureId =
        Number(
          baseFixture.fixture.id
        );

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
    logo: teamLogo,
    matches,
    average:
      calculateAverage(matches)
  };
}


// ======================================================
// TEK MAÇ İSTATİSTİĞİ
// ======================================================

function buildMatchStats(
  fixture,
  teamId
) {
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
    fixtureId:
      fixture.fixture.id,

    date:
      fixture.fixture.date,

    league:
      fixture.league?.name || "",

    leagueId:
      fixture.league?.id || null,

    home:
      fixture.teams.home.name,

    away:
      fixture.teams.away.name,

    homeLogo:
      fixture.teams.home.logo,

    awayLogo:
      fixture.teams.away.logo,

    score:
      `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,

    shots:
      getStat(
        stats,
        "Total Shots"
      ),

    shotsOnTarget:
      getStat(
        stats,
        "Shots on Goal",
        "Shots on Target"
      ),

    corners:
      getStat(
        stats,
        "Corner Kicks"
      ),

    saves:
      getStat(
        stats,
        "Goalkeeper Saves"
      ),

    isHome:
      Number(
        fixture.teams.home.id
      ) === Number(teamId)
  };
}


// ======================================================
// İSTATİSTİK BUL
// ======================================================

function getStat(
  stats,
  ...names
) {
  for (const name of names) {
    const found =
      stats.find(
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


// ======================================================
// SAYI TEMİZLE
// ======================================================

function normalizeNumber(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "number"
  ) {
    return value;
  }

  const cleaned =
    String(value)
      .replace("%", "")
      .trim();

  const number =
    Number(cleaned);

  return Number.isFinite(number)
    ? number
    : null;
}


// ======================================================
// SON 5 ORTALAMA
// ======================================================

function calculateAverage(matches) {
  return {
    shots:
      average(
        matches,
        "shots"
      ),

    shotsOnTarget:
      average(
        matches,
        "shotsOnTarget"
      ),

    corners:
      average(
        matches,
        "corners"
      ),

    saves:
      average(
        matches,
        "saves"
      )
  };
}


function average(
  items,
  key
) {
  const values =
    items
      .map(item => item[key])
      .filter(
        value =>
          typeof value ===
            "number" &&
          Number.isFinite(value)
      );

  if (!values.length) {
    return null;
  }

  const total =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  return Number(
    (
      total /
      values.length
    ).toFixed(1)
  );
}


// ======================================================
// SAAT
// ======================================================

function formatTime(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "tr-TR",
    {
      timeZone:
        "Europe/Istanbul",

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false
    }
  ).format(
    new Date(dateString)
  );
}
