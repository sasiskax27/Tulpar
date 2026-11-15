// 🛡 Проверка зависимостей на известные уязвимости по открытой базе OSV.dev
// (Google). Отправляются только названия и версии пакетов.
import { core } from "../ipc";
import { detectManagers, installedDeps, type Registry } from "../packages/packages";

const ECOSYSTEM: Partial<Record<Registry, string>> = {
  npm: "npm", pypi: "PyPI", crates: "crates.io", go: "Go", maven: "Maven", nuget: "NuGet", pub: "Pub", packagist: "Packagist", rubygems: "RubyGems",
};

export interface Vuln {
  pkg: string;
  version: string;
  ecosystem: string;
  manager: string;
  id: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  fixed?: string;
  url: string;
}

/** «^1.2.3», «~=1.2», «>=1.0,<2» → «1.2.3» (первая точная версия). */
export function cleanVersion(v: string): string | null {
  const m = /(\d+(?:\.\d+){0,3}(?:[-+][\w.]+)?)/.exec(v);
  return m ? m[1] : null;
}

function severityOf(v: { database_specific?: { severity?: string }; severity?: { type: string; score: string }[] }): Vuln["severity"] {
  const s = (v.database_specific?.severity ?? "").toLowerCase();
  if (s === "critical" || s === "high" || s === "low") return s;
  if (s === "moderate" || s === "medium") return "medium";
  const cvss = v.severity?.find((x) => x.type.startsWith("CVSS"))?.score ?? "";
  const num = Number(/(\d+(\.\d+)?)$/.exec(cvss)?.[1] ?? NaN);
  if (!Number.isNaN(num)) return num >= 9 ? "critical" : num >= 7 ? "high" : num >= 4 ? "medium" : "low";
  return "unknown";
}

export async function scanDependencies(): Promise<{ vulns: Vuln[]; checked: number }> {
  const managers = await detectManagers();
  const queries: { pkg: string; version: string; ecosystem: string; manager: string }[] = [];
  for (const m of managers) {
    const eco = ECOSYSTEM[m.registry];
    if (!eco) continue;
    for (const d of await installedDeps(m).catch(() => [])) {
      const v = cleanVersion(d.version);
      if (v) queries.push({ pkg: d.name, version: v, ecosystem: eco, manager: m.id });
    }
  }
  if (!queries.length) return { vulns: [], checked: 0 };
  const res = await core.httpRequest({
    method: "POST",
    url: "https://api.osv.dev/v1/querybatch",
    headers: [["Content-Type", "application/json"]],
    body: JSON.stringify({ queries: queries.map((q) => ({ package: { name: q.pkg, ecosystem: q.ecosystem }, version: q.version })) }),
    timeoutSecs: 40,
  });
  if (res.status !== 200) throw new Error(`OSV.dev ответил ${res.status}`);
  const batch = JSON.parse(res.body) as { results: { vulns?: { id: string }[] }[] };
  const ids = new Map<string, number[]>();
  batch.results.forEach((r, i) => r.vulns?.forEach((v) => ids.set(v.id, [...(ids.get(v.id) ?? []), i])));
  const vulns: Vuln[] = [];
  // Подробности — по каждой уязвимости (их обычно немного)
  for (const [id, idx] of [...ids].slice(0, 60)) {
    const d = await core.httpRequest({ method: "GET", url: `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, headers: [], body: null, timeoutSecs: 20 }).catch(() => null);
    const v = d && d.status === 200 ? JSON.parse(d.body) : { id };
    for (const i of idx) {
      const q = queries[i];
      const aff = (v.affected ?? []).find((a: { package?: { name?: string } }) => a.package?.name?.toLowerCase() === q.pkg.toLowerCase()) ?? v.affected?.[0];
      const fixed = aff?.ranges?.flatMap((r: { events?: { fixed?: string }[] }) => r.events ?? []).map((e: { fixed?: string }) => e.fixed).filter(Boolean).pop();
      const cve = (v.aliases ?? []).find((a: string) => a.startsWith("CVE-"));
      vulns.push({
        pkg: q.pkg, version: q.version, ecosystem: q.ecosystem, manager: q.manager,
        id: cve ?? v.id, summary: v.summary ?? (v.details ?? "").split("\n")[0] ?? "", severity: severityOf(v), fixed,
        url: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`,
      });
    }
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  vulns.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { vulns, checked: queries.length };
}

export function updateCommand(v: Vuln): string | null {
  if (!v.fixed) return null;
  switch (v.manager) {
    case "npm": return `npm install ${v.pkg}@${v.fixed}`;
    case "pnpm": return `pnpm add ${v.pkg}@${v.fixed}`;
    case "yarn": return `yarn add ${v.pkg}@${v.fixed}`;
    case "bun": return `bun add ${v.pkg}@${v.fixed}`;
    case "pip": return `pip install "${v.pkg}>=${v.fixed}"`;
    case "uv": return `uv add "${v.pkg}>=${v.fixed}"`;
    case "poetry": return `poetry add "${v.pkg}>=${v.fixed}"`;
    case "cargo": return `cargo update -p ${v.pkg} --precise ${v.fixed}`;
    case "go": return `go get ${v.pkg}@v${v.fixed.replace(/^v/, "")}`;
    case "composer": return `composer require ${v.pkg}:^${v.fixed}`;
    case "dotnet": return `dotnet add package ${v.pkg} --version ${v.fixed}`;
    default: return null;
  }
}
