// Son 5 Radar - API-Football Vercel serverless handler
// Gunun maclari: 10 ust lig + UEFA Sampiyonlar/Avrupa/Konferans Ligi.
// Son 5 analizi: tum resmi ULKE LIGLERI + bu 3 UEFA turnuvasi.
// Hazirlik maclari, yerel kupalar ve Super Kupalar harictir.

const API_BASE = 'https://v3.football.api-sports.io';

const DOMESTIC_LEAGUE_IDS = new Set([
  39,  // England Premier League
  140, // Spain La Liga
  78,  // Germany Bundesliga
  135, // Italy Serie A
  61,  // France Ligue 1
  88,  // Netherlands Eredivisie
  94,  // Portugal Primeira Liga
  144, // Belgium Pro League
  179, // Scotland Premiership
  203  // Turkey Super Lig
]);
const UEFA_COMPETITION_IDS = new Set([2, 3, 848]);
const ALLOWED_LEAGUE_IDS = new Set([
  ...DOMESTIC_LEAGUE_IDS,
  ...UEFA_COMPETITION_IDS
]);

// Isitilmis Vercel instance'lari arasinda metadata cache tutulur.
// Promise saklamak ayni lig icin eszamanli mukerrer istekleri de engeller.
const leagueTypeCache = new Map();

module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API_FOOTBALL_KEY tanımlı değil.' });
    }
    const { action } = req.query;
    if (action === 'fixtures') return getFixtures(req, res, apiKey);
    if (action === 'analyze') return analyzeTeams(req, res, apiKey);
    return res.status(400).json({ error: 'Geçersiz işlem.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Sunucu hatası.' });
  }
};

async function apiRequest(path, apiKey) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-apisports-key': apiKey }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`API-Football HTTP ${response.status}`);
  const errors = data.errors;
  if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
    throw new Error(`API-Football: ${JSON.stringify(errors)}`);
  }
  return data;
}

async function getFixtures(req, res, apiKey) {
  const { date } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    return res.status(400).json({ error: 'Geçerli tarih gerekli.' });
  }
  const data = await apiRequest(
    `/fixtures?date=${encodeURIComponent(date)}&timezone=Europe%2FIstanbul`, apiKey
  );
  const fixtures = (data.response || [])
    .filter(item => ALLOWED_LEAGUE_IDS.has(Number(item.league?.id)))
    .map(item => ({
      fixtureId: item.fixture.id,
      leagueId: item.league.id,
      league: [item.league?.country, item.league?.name].filter(Boolean).join(' • '),
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
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ fixtures, total: fixtures.length });
}

function isFriendly(item) {
  return /friendl|hazırlık/i.test(String(item.league?.name || ''));
}

function isCompleted(item) {
  return ['FT', 'AET', 'PEN'].includes(item.fixture?.status?.short);
}

async function isEligibleFixture(item, apiKey) {
  const leagueId = Number(item.league?.id);
  if (!leagueId || !isCompleted(item) || isFriendly(item)) return false;
  if (UEFA_COMPETITION_IDS.has(leagueId)) return true;
  if (DOMESTIC_LEAGUE_IDS.has(leagueId)) return true;

  // 10 lig haricinden UEFA'ya katilan bir takimin kendi lig maci da sayilir.
  // Ancak ulke kupasi veya Super Kupa dahil edilmez.
  if (item.league?.type === 'League') return true;
  if (item.league?.type === 'Cup') return false;

  if (!leagueTypeCache.has(leagueId)) {
    const promise = apiRequest(`/leagues?id=${leagueId}`, apiKey)
      .then(data => {
        const record = (data.response || [])
          .find(entry => Number(entry.league?.id) === leagueId);
        return record?.league?.type === 'League' &&
          !/friendl|hazırlık/i.test(String(record.league?.name || ''));
      })
      .catch(error => {
        leagueTypeCache.delete(leagueId);
        throw error;
      });
    leagueTypeCache.set(leagueId, promise);
  }
  return leagueTypeCache.get(leagueId);
}

async function getEligibleLastFive(teamId, apiKey) {
  let eligible = [];
  // Kupa/hazirlik maclari ilk 5'e giriyorsa daha geriye gidilir.
  for (const limit of [15, 30, 50]) {
    const data = await apiRequest(
      `/fixtures?team=${teamId}&last=${limit}&timezone=Europe%2FIstanbul`, apiKey
    );
    const candidates = data.response || [];
    const checks = await Promise.all(
      candidates.map(fixture => isEligibleFixture(fixture, apiKey))
    );
    eligible = candidates
      .filter((fixture, index) => checks[index])
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
      .slice(0, 5);
    if (eligible.length >= 5 || candidates.length < limit) break;
  }
  // Yeterli resmi mac bulunmazsa uydurma sonuc yerine mevcut maclar doner.
  return eligible;
}

async function analyzeTeams(req, res, apiKey) {
  const homeId = Number(req.query.home);
  const awayId = Number(req.query.away);
  if (!homeId || !awayId) {
    return res.status(400).json({ error: 'Takım ID bilgileri eksik.' });
  }
  const [homeFixtures, awayFixtures] = await Promise.all([
    getEligibleLastFive(homeId, apiKey),
    getEligibleLastFive(awayId, apiKey)
  ]);
  const ids = [...new Set([
    ...homeFixtures.map(item => Number(item.fixture.id)),
    ...awayFixtures.map(item => Number(item.fixture.id))
  ])];
  const detailsMap = new Map();
  // /fixtures?ids toplu istegi en fazla 20 mac icin kullanilir.
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20).join('-');
    const detailData = await apiRequest(
      `/fixtures?ids=${chunk}&timezone=Europe%2FIstanbul`, apiKey
    );
    for (const fixture of (detailData.response || [])) {
      detailsMap.set(Number(fixture.fixture.id), fixture);
    }
  }
  const home = buildTeamAnalysis(homeId, homeFixtures, detailsMap);
  const away = buildTeamAnalysis(awayId, awayFixtures, detailsMap);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({ home, away });
}

function buildTeamAnalysis(teamId, fixtures, detailsMap) {
  if (!fixtures.length) {
    return { id: teamId, name: 'Takım', matches: [], average: null };
  }
  const first = fixtures[0];
  const isHome = Number(first.teams.home.id) === Number(teamId);
  const matches = fixtures.map(base => buildMatchStats(
    detailsMap.get(Number(base.fixture.id)) || base, teamId
  ));
  return {
    id: teamId,
    name: isHome ? first.teams.home.name : first.teams.away.name,
    logo: isHome ? first.teams.home.logo : first.teams.away.logo,
    matches,
    average: calculateAverage(matches)
  };
}

function buildMatchStats(fixture, teamId) {
  const teamStats = (fixture.statistics || [])
    .find(item => Number(item.team?.id) === Number(teamId));
  const stats = teamStats?.statistics || [];
  return {
    fixtureId: fixture.fixture.id,
    date: fixture.fixture.date,
    league: fixture.league?.name || '',
    leagueId: fixture.league?.id || null,
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    homeLogo: fixture.teams.home.logo,
    awayLogo: fixture.teams.away.logo,
    score: `${fixture.goals?.home ?? '-'}-${fixture.goals?.away ?? '-'}`,
    shots: getStat(stats, 'Total Shots'),
    shotsOnTarget: getStat(stats, 'Shots on Goal', 'Shots on Target'),
    corners: getStat(stats, 'Corner Kicks'),
    saves: getStat(stats, 'Goalkeeper Saves'),
    isHome: Number(fixture.teams.home.id) === Number(teamId)
  };
}

function getStat(stats, ...names) {
  for (const name of names) {
    const found = stats.find(stat =>
      String(stat.type).toLowerCase().trim() === String(name).toLowerCase().trim()
    );
    if (found) return normalizeNumber(found.value);
  }
  return null;
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const number = Number(String(value).replace('%', '').trim());
  return Number.isFinite(number) ? number : null;
}

function calculateAverage(matches) {
  return {
    shots: average(matches, 'shots'),
    shotsOnTarget: average(matches, 'shotsOnTarget'),
    corners: average(matches, 'corners'),
    saves: average(matches, 'saves')
  };
}

function average(items, key) {
  const values = items.map(item => item[key])
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function formatTime(dateString) {
  if (!dateString) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(dateString));
}
