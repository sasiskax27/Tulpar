// 🖥→ Установка на удалённый сервер по SSH одной кнопкой. Скрипт сам
// определяет дистрибутив (apt / dnf / pacman). sudo спрашивает пароль в терминале.
import { core } from "../ipc";
import { runInTerminal } from "../terminal/sessions";
import { exec, sshCommandLine, type Server } from "../servers/servers";

export interface Recipe {
  id: string;
  icon: string;
  title: string;
  desc: string;
  /** Что спросить перед запуском */
  fields?: { key: string; label: string; placeholder: string; optional?: boolean }[];
  script: (v: Record<string, string>) => string;
}

const PRE = `set -e
if command -v apt-get >/dev/null; then PM=apt; elif command -v dnf >/dev/null; then PM=dnf; elif command -v yum >/dev/null; then PM=yum; elif command -v pacman >/dev/null; then PM=pacman; else echo "Неизвестный дистрибутив"; exit 1; fi
inst() { case $PM in apt) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@";; dnf|yum) $PM install -y "$@";; pacman) pacman -S --noconfirm --needed "$@";; esac; }
[ "$PM" = apt ] && apt-get update -y
`;

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export const RECIPES: Recipe[] = [
  {
    id: "nginx-site",
    icon: "🌐",
    title: "nginx + сайт + HTTPS",
    desc: "ставит nginx, настраивает домен на папку или на порт приложения, получает бесплатный сертификат Let's Encrypt",
    fields: [
      { key: "domain", label: "Домен", placeholder: "mysite.kz" },
      { key: "root", label: "Папка сайта (или пусто)", placeholder: "/var/www/mysite", optional: true },
      { key: "proxy", label: "Или порт приложения", placeholder: "3000", optional: true },
      { key: "email", label: "Email для HTTPS (или пусто — без HTTPS)", placeholder: "me@mail.kz", optional: true },
    ],
    script: (v) => `${PRE}
inst nginx
DOMAIN=${shq(v.domain)}
${v.proxy ? `LOC="location / { proxy_pass http://127.0.0.1:${Number(v.proxy) || 3000}; proxy_set_header Host \\$host; proxy_set_header X-Real-IP \\$remote_addr; proxy_http_version 1.1; proxy_set_header Upgrade \\$http_upgrade; proxy_set_header Connection upgrade; }"` : `ROOT=${shq(v.root || `/var/www/${v.domain}`)}; mkdir -p "$ROOT"; [ -f "$ROOT/index.html" ] || echo '<h1>Сайт работает 🐎 Tulpar</h1>' > "$ROOT/index.html"; LOC="root $ROOT; index index.html; location / { try_files \\$uri \\$uri/ /index.html; }"`}
CONF=/etc/nginx/conf.d/$DOMAIN.conf
echo "server { listen 80; server_name $DOMAIN www.$DOMAIN; $LOC }" > "$CONF"
nginx -t && systemctl enable --now nginx && systemctl reload nginx
command -v ufw >/dev/null && ufw allow 'Nginx Full' || true
${v.email ? `inst certbot python3-certbot-nginx || inst certbot
certbot --nginx -d "$DOMAIN" -m ${shq(v.email)} --agree-tos -n --redirect || echo "HTTPS не получилось: проверьте, что домен указывает на этот сервер"` : ""}
echo "✓ Готово: http://$DOMAIN"
`,
  },
  {
    id: "postgres",
    icon: "🐘",
    title: "PostgreSQL + база",
    desc: "ставит PostgreSQL и создаёт пользователя и базу для приложения",
    fields: [
      { key: "db", label: "Имя базы", placeholder: "app" },
      { key: "user", label: "Пользователь", placeholder: "app" },
      { key: "pass", label: "Пароль", placeholder: "придумайте пароль" },
    ],
    script: (v) => `${PRE}
case $PM in apt) inst postgresql;; dnf|yum) inst postgresql-server; postgresql-setup --initdb || true;; pacman) inst postgresql; [ -d /var/lib/postgres/data/base ] || sudo -u postgres initdb -D /var/lib/postgres/data;; esac
systemctl enable --now postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \\$\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${shq(v.user)}) THEN CREATE ROLE ${v.user.replace(/\W/g, "")} LOGIN PASSWORD ${shq(v.pass)}; END IF; END \\$\\$;
SQL
sudo -u postgres createdb -O ${v.user.replace(/\W/g, "")} ${v.db.replace(/\W/g, "")} 2>/dev/null || true
echo "✓ Готово: postgresql://${v.user}:***@localhost:5432/${v.db}"
`,
  },
  {
    id: "redis",
    icon: "🟥",
    title: "Redis",
    desc: "кэш и очереди, слушает только localhost",
    script: () => `${PRE}
case $PM in apt) inst redis-server; S=redis-server;; *) inst redis; S=redis;; esac
systemctl enable --now $S
echo "✓ Redis работает: redis://localhost:6379"
`,
  },
  {
    id: "docker",
    icon: "🐳",
    title: "Docker",
    desc: "официальный скрипт get.docker.com + docker compose",
    script: () => `set -e
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
[ -n "$SUDO_USER" ] && usermod -aG docker "$SUDO_USER" || true
docker --version && echo "✓ Docker готов (перелогиньтесь, чтобы работать без sudo)"
`,
  },
  {
    id: "node",
    icon: "🟩",
    title: "Node.js LTS + pm2",
    desc: "Node.js и pm2, чтобы приложение работало всегда и само поднималось после перезагрузки",
    script: () => `${PRE}
if [ "$PM" = apt ]; then curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && inst nodejs; elif [ "$PM" = pacman ]; then inst nodejs npm; else curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash - && inst nodejs; fi
npm install -g pm2
[ -n "$SUDO_USER" ] && env PATH=$PATH pm2 startup systemd -u "$SUDO_USER" --hp "$(getent passwd "$SUDO_USER" | cut -d: -f6)" || true
node --version && echo "✓ Node.js и pm2 готовы"
`,
  },
  {
    id: "samba",
    icon: "📂",
    title: "Samba — общая папка",
    desc: "папка на сервере, которая открывается в проводнике Windows как сетевой диск",
    fields: [
      { key: "name", label: "Имя папки в сети", placeholder: "projects" },
      { key: "path", label: "Путь на сервере", placeholder: "/srv/projects" },
    ],
    script: (v) => `${PRE}
inst samba
SHARE=${shq(v.name.replace(/[^\w-]/g, "") || "share")}
DIR=${shq(v.path || "/srv/share")}
U="\${SUDO_USER:-$(whoami)}"
mkdir -p "$DIR" && chown "$U" "$DIR"
grep -q "^\\[$SHARE\\]" /etc/samba/smb.conf || printf '\\n[%s]\\n  path = %s\\n  browseable = yes\\n  read only = no\\n  valid users = %s\\n' "$SHARE" "$DIR" "$U" >> /etc/samba/smb.conf
command -v ufw >/dev/null && ufw allow samba || true
systemctl enable --now smbd 2>/dev/null || systemctl enable --now smb
echo "Сейчас задайте пароль для входа в общую папку (пользователь $U):"
smbpasswd -a "$U"
systemctl restart smbd 2>/dev/null || systemctl restart smb
echo "✓ Готово. В Windows: \\\\\\\\$(hostname -I | cut -d' ' -f1)\\\\$SHARE"
`,
  },
  {
    id: "firewall",
    icon: "🧱",
    title: "Firewall (ufw)",
    desc: "закрыть всё лишнее: открыты только SSH, HTTP и HTTPS",
    script: () => `${PRE}
inst ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable && ufw status
`,
  },
];

/** Залить скрипт на сервер и запустить через sudo в терминале (там можно ввести пароль). */
export async function runRecipe(s: Server, r: Recipe, values: Record<string, string>) {
  const file = `/tmp/tulpar-${r.id}-${Date.now()}.sh`;
  const up = await exec(s, `cat > ${file} && chmod +x ${file}`, r.script(values), 30);
  if (up.code !== 0) throw new Error(up.stderr.trim() || "не удалось загрузить скрипт");
  await runInTerminal(`${sshCommandLine(s).replace(/^ssh /, "ssh -t ")} "sudo bash ${file}; rm -f ${file}"`, `${r.title} → ${s.name}`);
}

export { core };
