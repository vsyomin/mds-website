// Live APDA schedule for the Maryland Debate Society site.
// Reads https://apda.online/schedule/, keeps the tournament closest to College Park
// for each weekend, and returns it as JSON at /api/schedule (cached for an hour).

const SOURCE = "https://apda.online/schedule/";
const HOME = [38.9897, -76.9378]; // College Park, MD

// [match, short name, city, region, lat, lon]
const SCHOOLS = [
  [/maryland|umd/i, "UMD", "College Park", "Maryland", 38.99, -76.94],
  [/johns hopkins|hopkins/i, "Hopkins", "Baltimore", "Maryland", 39.33, -76.62],
  [/george washington|\bgw\b/i, "GW", "Washington", "D.C.", 38.9, -77.05],
  [/georgetown/i, "Georgetown", "Washington", "D.C.", 38.91, -77.07],
  [/american university|^au\b/i, "American University", "Washington", "D.C.", 38.94, -77.09],
  [/virginia|uva/i, "UVA", "Charlottesville", "Virginia", 38.03, -78.5],
  [/william (&|&amp;|and) mary/i, "William & Mary", "Williamsburg", "Virginia", 37.27, -76.71],
  [/swarthmore/i, "Swarthmore", "Swarthmore", "Pennsylvania", 39.9, -75.35],
  [/drexel/i, "Drexel", "Philadelphia", "Pennsylvania", 39.96, -75.19],
  [/temple/i, "Temple", "Philadelphia", "Pennsylvania", 39.98, -75.16],
  [/penn(sylvania)?\b|upenn/i, "UPenn", "Philadelphia", "Pennsylvania", 39.95, -75.19],
  [/pittsburgh|\bpitt\b/i, "Pitt", "Pittsburgh", "Pennsylvania", 40.44, -79.96],
  [/carnegie mellon|\bcmu\b/i, "CMU", "Pittsburgh", "Pennsylvania", 40.44, -79.94],
  [/princeton/i, "Princeton", "Princeton", "New Jersey", 40.34, -74.65],
  [/rutgers/i, "Rutgers", "New Brunswick", "New Jersey", 40.5, -74.45],
  [/columbia/i, "Columbia", "New York", "New York", 40.81, -73.96],
  [/fordham/i, "Fordham", "New York", "New York", 40.86, -73.89],
  [/\bnyu\b|new york university/i, "NYU", "New York", "New York", 40.73, -74.0],
  [/binghamton/i, "Binghamton", "Binghamton", "New York", 42.09, -75.97],
  [/cornell/i, "Cornell", "Ithaca", "New York", 42.45, -76.48],
  [/yale/i, "Yale", "New Haven", "Connecticut", 41.31, -72.93],
  [/wesleyan/i, "Wesleyan", "Middletown", "Connecticut", 41.56, -72.66],
  [/brown/i, "Brown", "Providence", "Rhode Island", 41.83, -71.4],
  [/harvard/i, "Harvard", "Cambridge", "Massachusetts", 42.37, -71.12],
  [/\bmit\b/i, "MIT", "Cambridge", "Massachusetts", 42.36, -71.09],
  [/tufts/i, "Tufts", "Medford", "Massachusetts", 42.41, -71.12],
  [/boston university|\bbu\b/i, "Boston University", "Boston", "Massachusetts", 42.35, -71.11],
  [/northeastern/i, "Northeastern", "Boston", "Massachusetts", 42.34, -71.09],
  [/brandeis/i, "Brandeis", "Waltham", "Massachusetts", 42.37, -71.26],
  [/bentley/i, "Bentley", "Waltham", "Massachusetts", 42.39, -71.22],
  [/wellesley/i, "Wellesley", "Wellesley", "Massachusetts", 42.29, -71.31],
  [/amherst college/i, "Amherst", "Amherst", "Massachusetts", 42.37, -72.52],
  [/umass|uma\b/i, "UMass Amherst", "Amherst", "Massachusetts", 42.39, -72.53],
  [/williams/i, "Williams", "Williamstown", "Massachusetts", 42.71, -73.2],
  [/smith college/i, "Smith", "Northampton", "Massachusetts", 42.32, -72.64],
  [/bates/i, "Bates", "Lewiston", "Maine", 44.1, -70.2],
  [/dartmouth/i, "Dartmouth", "Hanover", "New Hampshire", 43.7, -72.29],
  [/chicago/i, "UChicago", "Chicago", "Illinois", 41.79, -87.6],
  [/ottawa/i, "Ottawa", "Ottawa", "Canada", 45.42, -75.69],
  [/western/i, "Western", "London, Ontario", "Canada", 43.01, -81.27],
  [/ucla/i, "UCLA", "Los Angeles", "California", 34.07, -118.44],
];

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const ABBR = MONTHS.map((m) => m.slice(0, 3));

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/&nbsp;/g, " ").replace(/&#8211;|&ndash;/g, "–").replace(/\s+/g, " ").trim();
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function miles(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 7918 * Math.asin(Math.sqrt(h));
}

function parseCell(cell) {
  const tags = [...cell.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/g)].map((m) => strip(m[1])).filter(Boolean);
  const head = cell.split(/<br\s*\/?>/i)[0];
  const name = strip(head.replace(/<mark[\s\S]*?<\/mark>/g, ""));
  if (!name) return null;
  const link = (cell.match(/href="([^"]+)"/) || [])[1] || "";
  const sanctioned = !/<em>/.test(head);
  return { name, tags, link, sanctioned };
}

export function parseSchedule(html, todayISO) {
  const season = html.match(/Schedule\s*(\d{4})\s*[-–]\s*(\d{4})/);
  const y1 = season ? +season[1] : new Date().getFullYear();
  const y2 = season ? +season[2] : y1 + 1;
  const out = [];
  const sections = html.split(/<h4[^>]*>/i).slice(1);
  for (const sec of sections) {
    const month = MONTHS.indexOf(strip(sec.split(/<\/h4>/i)[0]).toLowerCase());
    if (month < 0) continue;
    const table = (sec.match(/<table[\s\S]*?<\/table>/i) || [])[0];
    if (!table) continue;
    const year = month >= 7 ? y1 : y2;
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length < 2) continue;
      const dm = strip(cells[0].split(/<br/i)[0]).match(/^(\d{1,2})\s*[–-]\s*(?:([A-Za-z]{3})[a-z]*\s*)?(\d{1,2})/);
      if (!dm) continue;
      const startD = +dm[1];
      let endM = month, endY = year;
      if (dm[2]) { endM = ABBR.indexOf(dm[2].toLowerCase()); if (endM < month) endY = year + 1; }
      const start = iso(year, month, startD), end = iso(endY, endM, +dm[3]);
      if (end < todayISO) continue;
      const options = cells.slice(1).map(parseCell).filter(Boolean).map((t) => {
        const school = SCHOOLS.find((s) => s[0].test(t.name));
        const online = t.tags.some((x) => /online/i.test(x));
        const dist = online ? 5000 : school ? miles(HOME, [school[4], school[5]]) : 3000;
        return { ...t, school, online, dist: t.sanctioned ? dist : dist + 10000 };
      });
      if (!options.length) continue;
      options.sort((a, b) => a.dist - b.dist);
      const p = options[0], s = p.school;
      const tagText = p.tags.filter((x) => !/^online$/i.test(x) && !/^\(/.test(x));
      const home = s && s[1] === "UMD";
      let name = s ? s[1] : p.name;
      if (/nationals/i.test(p.name)) name = (s ? s[1] + " " : "") + "Nationals";
      else if (/northams/i.test(p.name)) name = "NorthAms (" + (s ? s[1] : "") + ")";
      else if (/wudc|usudc/i.test(p.name)) name = p.name.replace(/\s+at\s+/i, " ");
      else if (tagText.some((x) => /^(novice|proams?)$/i.test(x))) name += " " + tagText.find((x) => /^(novice|proams?)$/i.test(x));
      if (/elections/i.test(strip(cells[0]))) name += " (APDA Elections)";
      out.push({
        id: "apda-" + start,
        name,
        start,
        end,
        host: "",
        city: p.online || !s ? "" : s[2],
        region: p.online ? "Online" : s ? s[3] : "",
        format: [p.sanctioned ? "APDA" : "Non-APDA", home ? "Home tournament" : "", ...tagText.filter((x) => !/^(novice|proams?)$/i.test(x))].filter(Boolean).join(" · "),
        status: "Scheduled",
        travelers: "",
        result: "",
        link: p.link || SOURCE,
        live: true,
      });
    }
  }
  return out;
}

const ICS = "https://calendar.google.com/calendar/ical/75c0a7a61b2f214f797f33a1095dda182d1db609bafcad3ddf1878bf42184656%40group.calendar.google.com/public/basic.ics";
const HEADERS = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" };

// APDA's public Google Calendar (the same feed linked from apda.online/schedule).
export function parseICS(text, todayISO) {
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\r/g, "");
  const field = (e, k) => ((e.match(new RegExp("\\n" + k + "[^:\\n]*:([^\\n]*)")) || [])[1] || "").trim();
  const d8 = (v) => v ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : "";
  const minusDay = (iso) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
  const weeks = new Map();
  for (const e of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const summary = field(e, "SUMMARY").replace(/\\,/g, ",").replace(/\;/g, ";");
    const start = d8(field(e, "DTSTART"));
    if (!summary || !start) continue;
    const endRaw = d8(field(e, "DTEND"));
    const end = endRaw && /VALUE=DATE/.test(e.match(/\nDTEND[^\n]*/)?.[0] || "") ? minusDay(endRaw) : (endRaw || start);
    if (end < todayISO) continue;
    const desc = field(e, "DESCRIPTION").replace(/\\n/g, "\n").replace(/\\,/g, ",");
    const tags = ((desc.match(/Tags:\s*([^\n]*)/) || [])[1] || "").split(/[,·]/).map((x) => x.trim()).filter(Boolean);
    const sanctioned = /^\[APDA\]/i.test(summary) || /^APDA Nationals/i.test(summary);
    let name = summary.replace(/^\[[^\]]*\]\s*/, "").trim();
    const online = /\bonline\b/i.test(name) || tags.some((t) => /online/i.test(t));
    name = name.replace(/\s*\bonline\b\s*/i, " ").trim();
    const link = (desc.match(/https?:\/\/\S+/) || [])[0] || SOURCE;
    if (!weeks.has(start)) weeks.set(start, []);
    weeks.get(start).push({ name, start, end, tags, online, sanctioned, link });
  }
  const out = [];
  for (const [start, options] of [...weeks.entries()].sort()) {
    for (const o of options) {
      o.school = SCHOOLS.find((s) => s[0].test(o.name.replace(/\s+(novice|proams?|wgm|bipoc|nationals.*)$/i, "")) || s[0].test(o.name));
      const dist = o.online ? 5000 : o.school ? miles(HOME, [o.school[4], o.school[5]]) : 3000;
      o.dist = o.sanctioned ? dist : dist + 10000;
    }
    options.sort((a, b) => a.dist - b.dist);
    const p = options[0], s = p.school, home = s && s[1] === "UMD";
    let name = p.name;
    if (/nationals/i.test(name)) name = (s ? s[1] + " " : "") + "Nationals";
    else if (s) { const extra = (p.name.match(/\s(novice|proams?|wgm|bipoc)\b/i) || [])[1]; name = s[1] + (extra ? " " + extra.replace(/^proams?$/i, "ProAms").replace(/^novice$/i, "Novice").replace(/^wgm$/i, "WGM").replace(/^bipoc$/i, "BIPOC") : ""); }
    if (/^gw$/i.test(name) && start.slice(5, 7) === "04" && +start.slice(8) <= 7) name += " (APDA Elections)";
    const tagText = p.tags.filter((t) => !/^(online|novice|proams?)$/i.test(t));
    out.push({ id: "apda-" + start, name, start, end: p.end, host: "", city: p.online || !s ? "" : s[2], region: p.online ? "Online" : s ? s[3] : "",
      format: [p.sanctioned ? "APDA" : "Non-APDA", home ? "Home tournament" : "", ...tagText].filter(Boolean).join(" · "), status: "Scheduled", travelers: "", result: "", link: SOURCE });
  }
  return out;
}

export default async () => {
  const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const ok = (tournaments, source) => Response.json({ updated: new Date().toISOString(), source, tournaments }, {
    headers: { "netlify-cdn-cache-control": "public, durable, s-maxage=3600, stale-while-revalidate=86400", "cache-control": "public, max-age=300" } });
  const errors = [];
  try {
    const r = await fetch(ICS, { headers: HEADERS });
    if (!r.ok) throw new Error("calendar returned " + r.status);
    const list = parseICS(await r.text(), today);
    if (list.length) return ok(list, ICS);
    errors.push("calendar was empty");
  } catch (e) { errors.push(String(e.message || e)); }
  try {
    const res = await fetch(SOURCE, { headers: HEADERS });
    if (!res.ok) throw new Error("APDA returned " + res.status);
    return ok(parseSchedule(await res.text(), today), SOURCE);
  } catch (e) { errors.push(String(e.message || e)); }
  return Response.json({ error: errors.join("; "), tournaments: [] }, { status: 502, headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/schedule" };
