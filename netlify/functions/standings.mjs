// Live APDA standings + Maryland's tournament results for the Maryland Debate Society site.
// Source: https://results.apda.online (public). Served at /api/standings, cached for an hour.

const BASE = "https://results.apda.online";
const SCHOOL = /maryland/i;

const strip = (s) => String(s || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const rows = (html) => (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) => [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]));
const pane = (html, id) => { const i = html.indexOf(`id="${id}"`); if (i < 0) return ""; const j = html.indexOf('class="tab-pane', i + 10); return html.slice(i, j < 0 ? undefined : j); };
const num = (s) => parseFloat(String(s).replace(/[^\d.]/g, "")) || 0;
const ord = (n) => { n = parseInt(n, 10); const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const ROUND = { "1st": "Champions", "2nd": "Finalists", "semi-finalist": "Semifinalists", "quarter-finalist": "Quarterfinalists", "octo-finalist": "Octofinalists", "double-octo-finalist": "Double-octofinalists" };

export function parseStandings(home) {
  const coty = rows(pane(home, "coty")).filter((c) => c.length >= 3 && /schools\//.test(c[1] || ""));
  const clubs = coty.length;
  const me = coty.find((c) => SCHOOL.test(strip(c[1])));
  const teams = rows(pane(home, "toty")).filter((c) => c.length >= 4 && SCHOOL.test(strip(c[1])))
    .map((c) => ({ place: strip(c[0]).replace(/\s+/g, ""), team: strip(c[1]), debaters: strip(c[2]), points: num(strip(c[3])) }));
  const speakers = rows(pane(home, "soty")).filter((c) => c.length >= 4 && SCHOOL.test(strip(c[2])))
    .map((c) => ({ place: strip(c[0]).replace(/\s+/g, ""), name: strip(c[1]), points: num(strip(c[3])) }));
  const season = (home.match(/(20\d\d-\d\d)\s*<\/a>\s*<div|id="season[^"]*"[^>]*>\s*(20\d\d-\d\d)/) || [])[1] || "";
  return { club: me ? { place: strip(me[0]), points: num(strip(me[2])), of: clubs } : null, teams, speakers, season };
}

export function parseTournament(html) {
  const lines = [];
  for (const [id, prefix] of [["varsity", ""], ["novice", "Novice "]]) {
    const groups = new Map();
    for (const c of rows(pane(html, id))) {
      if (c.length < 3 || !SCHOOL.test(strip(c[1]))) continue;
      const label = ROUND[strip(c[0]).toLowerCase()] || strip(c[0]);
      const pair = strip(c[2]).replace(/\s+and\s+/, " & ");
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(pair);
    }
    for (const [label, pairs] of groups) {
      const name = prefix ? prefix + label.toLowerCase() : label;
      lines.push(name + ": " + pairs.join("; "));
    }
  }
  for (const [id, label] of [["varsity_speakers", "Speaker awards"], ["novice_speakers", "Novice speakers"]]) {
    const people = rows(pane(html, id)).filter((c) => c.length >= 3 && SCHOOL.test(strip(c[2])))
      .map((c) => { const p = strip(c[0]); const tie = /tie/i.test(p); return strip(c[1]) + " (" + (tie ? "tied " : "") + ord(p) + ")"; });
    if (people.length) lines.push(label + ": " + people.join(", "));
  }
  return lines.join("\n");
}

async function get(path) {
  const r = await fetch(BASE + path, { headers: { "user-agent": "MarylandDebateSociety-site/1.0" } });
  if (!r.ok) throw new Error(path + " returned " + r.status);
  return r.text();
}

export default async () => {
  try {
    const [home, list] = await Promise.all([get("/"), get("/core/tournaments/")]);
    const standings = parseStandings(home);
    const all = rows(list).filter((c) => c.length >= 5).map((c) => ({ id: (c[0].match(/tournaments\/(\d+)/) || [])[1], name: strip(c[1]), date: strip(c[2]), season: strip(c[3]), teams: num(strip(c[4])) }))
      .filter((t) => t.id && /\d\d\/\d\d\/\d{4}/.test(t.date));
    const current = all.length ? all[0].season : "";
    const played = all.filter((t) => t.season === current && t.teams > 0).slice(0, 30);
    const results = [];
    await Promise.all(played.map(async (t) => {
      try {
        const text = parseTournament(await get("/core/tournaments/" + t.id));
        if (!text) return;
        const [m, d, y] = t.date.split("/");
        results.push({ id: t.id, name: t.name, start: `${y}-${m}-${d}`, result: text, link: `${BASE}/core/tournaments/${t.id}` });
      } catch (e) { /* skip one bad page */ }
    }));
    results.sort((a, b) => (a.start < b.start ? -1 : 1));
    return Response.json({ updated: new Date().toISOString(), source: BASE, season: current || standings.season, ...standings, results }, {
      headers: { "netlify-cdn-cache-control": "public, durable, s-maxage=3600, stale-while-revalidate=86400", "cache-control": "public, max-age=300" },
    });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
};

export const config = { path: "/api/standings" };
