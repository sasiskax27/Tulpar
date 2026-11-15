// 🎧 Музыка в редакторе: свои mp3 с компьютера или ссылка на Spotify,
// YouTube, SoundCloud, Яндекс Музыку — играет в маленьком плеере.
import { createSignal } from "solid-js";
import { core, baseName } from "../ipc";
import { unlock } from "./achievements";

export interface Track {
  title: string;
  /** локальный файл */
  path?: string;
  /** встраиваемый плеер */
  embed?: string;
  kind: "file" | "spotify" | "youtube" | "soundcloud" | "yandex";
}

const KEY = "tulpar.music";

export const PRESETS: Track[] = [
  { title: "Lofi Girl — beats to relax/study", embed: "https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1", kind: "youtube" },
  { title: "Synthwave radio", embed: "https://www.youtube.com/embed/4xDzrJKXOOY?autoplay=1", kind: "youtube" },
  { title: "Spotify: lofi beats", embed: "https://open.spotify.com/embed/playlist/37i9dQZF1DWWQRwui0ExPn", kind: "spotify" },
  { title: "Spotify: Deep Focus", embed: "https://open.spotify.com/embed/playlist/37i9dQZF1DWZeKCadgRdKQ", kind: "spotify" },
];

/** Ссылка из адресной строки → адрес встраиваемого плеера. */
export function embedFromLink(link: string): Track | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "open.spotify.com") {
    const m = /\/(?:intl-\w+\/)?(track|album|playlist|artist|episode|show)\/(\w+)/.exec(u.pathname);
    if (m) return { title: `Spotify: ${m[1]}`, embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: "spotify" };
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtu.be") {
    const list = u.searchParams.get("list");
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") ?? /\/(?:live|shorts|embed)\/([\w-]+)/.exec(u.pathname)?.[1];
    if (id) return { title: "YouTube", embed: `https://www.youtube.com/embed/${id}?autoplay=1${list ? `&list=${list}` : ""}`, kind: "youtube" };
    if (list) return { title: "YouTube: плейлист", embed: `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1`, kind: "youtube" };
  }
  if (host === "soundcloud.com") {
    return { title: `SoundCloud: ${u.pathname.split("/").filter(Boolean).join(" — ")}`, embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.href)}&auto_play=true&visual=false`, kind: "soundcloud" };
  }
  if (host === "music.yandex.ru" || host === "music.yandex.kz" || host === "music.yandex.com") {
    const tr = /\/album\/(\d+)\/track\/(\d+)/.exec(u.pathname);
    if (tr) return { title: "Яндекс Музыка", embed: `https://music.yandex.ru/iframe/album/${tr[1]}/track/${tr[2]}`, kind: "yandex" };
    const al = /\/album\/(\d+)/.exec(u.pathname);
    if (al) return { title: "Яндекс Музыка: альбом", embed: `https://music.yandex.ru/iframe/album/${al[1]}`, kind: "yandex" };
    const pl = /\/users\/([^/]+)\/playlists\/(\d+)/.exec(u.pathname);
    if (pl) return { title: "Яндекс Музыка: плейлист", embed: `https://music.yandex.ru/iframe/playlist/${pl[1]}/${pl[2]}`, kind: "yandex" };
  }
  return null;
}

function load(): Track[] {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

const [playlist, setPlaylist] = createSignal<Track[]>(load());
const [current, setCurrent] = createSignal<Track | null>(null);
const [playerOpen, setPlayerOpen] = createSignal(false);
const [minimized, setMinimized] = createSignal(false);
export { playlist, current, playerOpen, minimized, setMinimized, setPlayerOpen };

function save(list: Track[]) {
  setPlaylist(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ничего */
  }
}

export function addTrack(t: Track) {
  if (!playlist().some((x) => (x.path ?? x.embed) === (t.path ?? t.embed))) save([...playlist(), t]);
}

export function removeTrack(t: Track) {
  save(playlist().filter((x) => x !== t));
  if (current() === t) setCurrent(null);
}

export function addFiles(paths: string[]) {
  for (const p of paths) addTrack({ title: baseName(p).replace(/\.\w+$/, ""), path: p, kind: "file" });
}

let blobUrl: string | null = null;
export async function fileUrl(t: Track): Promise<string> {
  const d = await core.imageRead(t.path!);
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  const bin = atob(d.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  blobUrl = URL.createObjectURL(new Blob([bytes], { type: d.mime }));
  return blobUrl;
}

export function play(t: Track) {
  setCurrent(t);
  setPlayerOpen(true);
  unlock("dj");
}

export function next(step = 1) {
  const list = playlist().filter((t) => t.kind === "file");
  const cur = current();
  if (!list.length) return;
  const i = cur ? list.indexOf(cur) : -1;
  play(list[(i + step + list.length) % list.length]);
}

export function stopMusic() {
  setCurrent(null);
  setPlayerOpen(false);
}
