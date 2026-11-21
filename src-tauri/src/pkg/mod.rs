//! Поиск библиотек в реестрах пакетов: npm, PyPI, crates.io, Maven Central,
//! NuGet, Go, pub.dev, Packagist, RubyGems. Только чтение открытых API —
//! установка идёт штатной командой языка в терминале (npm install, pip install…).

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Pkg {
    name: String,
    version: String,
    description: String,
    downloads: Option<u64>,
    /// Для Maven: «group:artifact»
    id: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // crates.io требует понятный User-Agent
        .user_agent(concat!("Tulpar/", env!("CARGO_PKG_VERSION"), " (https://github.com/sasiskax27/Tulpar)"))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())
}

async fn get(url: &str, query: &[(&str, &str)]) -> Result<Option<Value>, String> {
    let r = client()?.get(url).query(query).send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            "нет связи с реестром пакетов".to_string()
        } else {
            e.to_string()
        }
    })?;
    if r.status().as_u16() == 404 {
        return Ok(None);
    }
    if !r.status().is_success() {
        return Err(format!("реестр ответил {}", r.status().as_u16()));
    }
    r.json().await.map(Some).map_err(|e| e.to_string())
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

/// Популярные пакеты для реестров без поиска (PyPI, Go): совпадение по подстроке.
const PYPI_POPULAR: &[&str] = &[
    "requests", "numpy", "pandas", "matplotlib", "scipy", "flask", "django", "fastapi", "uvicorn", "pydantic",
    "sqlalchemy", "pytest", "black", "ruff", "mypy", "pillow", "opencv-python", "scikit-learn", "torch", "torchvision",
    "tensorflow", "keras", "transformers", "openai", "anthropic", "langchain", "httpx", "aiohttp", "beautifulsoup4",
    "lxml", "selenium", "playwright", "scrapy", "rich", "typer", "click", "tqdm", "python-dotenv", "pyyaml", "toml",
    "jinja2", "celery", "redis", "psycopg2-binary", "pymongo", "boto3", "pygame", "pyqt6", "pyside6", "kivy",
    "customtkinter", "tkinter-tooltip", "streamlit", "gradio", "plotly", "seaborn", "jupyter", "notebook", "ipython",
    "sympy", "networkx", "pyinstaller", "nuitka", "cryptography", "bcrypt", "pyjwt", "passlib", "aiogram",
    "python-telegram-bot", "discord.py", "telethon", "pytelegrambotapi", "vk-api", "pyautogui", "pynput", "keyboard",
    "mouse", "psutil", "schedule", "apscheduler", "loguru", "arrow", "pendulum", "faker", "polars", "pyarrow",
    "openpyxl", "xlsxwriter", "python-docx", "reportlab", "pypdf", "pdfplumber", "moviepy", "pydub", "librosa",
    "sounddevice", "pyaudio", "speechrecognition", "gtts", "pyttsx3", "qrcode", "websockets", "socketio",
    "python-socketio", "grpcio", "protobuf", "marshmallow", "alembic", "peewee", "tortoise-orm", "starlette",
    "gunicorn", "waitress", "sanic", "tornado", "bottle", "pyramid", "numba", "cython", "dask", "xgboost",
    "lightgbm", "catboost", "statsmodels", "nltk", "spacy", "gensim", "ollama", "tiktoken", "sentence-transformers",
];
const GO_POPULAR: &[&str] = &[
    "github.com/gin-gonic/gin", "github.com/labstack/echo/v4", "github.com/gofiber/fiber/v2", "github.com/go-chi/chi/v5",
    "github.com/gorilla/mux", "github.com/gorilla/websocket", "gorm.io/gorm", "gorm.io/driver/postgres",
    "gorm.io/driver/sqlite", "github.com/jmoiron/sqlx", "github.com/jackc/pgx/v5", "github.com/go-sql-driver/mysql",
    "github.com/mattn/go-sqlite3", "github.com/redis/go-redis/v9", "go.mongodb.org/mongo-driver/mongo",
    "github.com/spf13/cobra", "github.com/spf13/viper", "github.com/urfave/cli/v2", "github.com/joho/godotenv",
    "github.com/sirupsen/logrus", "go.uber.org/zap", "github.com/rs/zerolog", "github.com/stretchr/testify",
    "github.com/google/uuid", "github.com/golang-jwt/jwt/v5", "golang.org/x/crypto", "golang.org/x/sync",
    "github.com/charmbracelet/bubbletea", "github.com/charmbracelet/lipgloss", "github.com/fatih/color",
    "github.com/go-telegram-bot-api/telegram-bot-api/v5", "github.com/bwmarrin/discordgo", "google.golang.org/grpc",
    "google.golang.org/protobuf", "github.com/prometheus/client_golang", "github.com/go-playground/validator/v10",
];

async fn pypi(q: &str) -> Result<Vec<Pkg>, String> {
    let norm = q.trim().to_lowercase().replace('_', "-");
    let mut out = Vec::new();
    if let Some(v) = get(&format!("https://pypi.org/pypi/{norm}/json"), &[]).await? {
        out.push(Pkg {
            name: s(&v["info"]["name"]),
            version: s(&v["info"]["version"]),
            description: s(&v["info"]["summary"]),
            ..Default::default()
        });
    }
    for p in PYPI_POPULAR.iter().filter(|p| norm.is_empty() || p.contains(norm.as_str())) {
        if out.iter().any(|o| o.name.to_lowercase() == *p) {
            continue;
        }
        out.push(Pkg { name: (*p).to_string(), ..Default::default() });
    }
    Ok(out.into_iter().take(40).collect())
}

async fn golang(q: &str) -> Result<Vec<Pkg>, String> {
    let q = q.trim();
    let mut out = Vec::new();
    // Полный путь модуля — спрашиваем прокси Go о последней версии
    if q.contains('.') && q.contains('/') {
        let escaped: String = q.chars().map(|c| if c.is_ascii_uppercase() { format!("!{}", c.to_ascii_lowercase()) } else { c.to_string() }).collect();
        if let Some(v) = get(&format!("https://proxy.golang.org/{escaped}/@latest"), &[]).await? {
            out.push(Pkg { name: q.to_string(), version: s(&v["Version"]), ..Default::default() });
        }
    }
    let lower = q.to_lowercase();
    for p in GO_POPULAR.iter().filter(|p| lower.is_empty() || p.contains(lower.as_str())) {
        if out.iter().all(|o| o.name != *p) {
            out.push(Pkg { name: (*p).to_string(), ..Default::default() });
        }
    }
    Ok(out)
}

/// registry: npm | pypi | crates | maven | nuget | go | pub | packagist | rubygems
#[tauri::command]
pub async fn pkg_search(registry: String, query: String) -> Result<Vec<Pkg>, String> {
    let q = query.trim();
    let list: Vec<Pkg> = match registry.as_str() {
        "npm" => {
            let text = if q.is_empty() { "keywords:popular" } else { q };
            let v = get("https://registry.npmjs.org/-/v1/search", &[("text", text), ("size", "30")]).await?.unwrap_or_default();
            v["objects"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|o| Pkg {
                            name: s(&o["package"]["name"]),
                            version: s(&o["package"]["version"]),
                            description: s(&o["package"]["description"]),
                            downloads: o["downloads"]["weekly"].as_u64(),
                            ..Default::default()
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "pypi" => pypi(q).await?,
        "crates" => {
            let mut params = vec![("per_page", "30")];
            if q.is_empty() {
                params.push(("sort", "downloads"));
            } else {
                params.push(("q", q));
            }
            let v = get("https://crates.io/api/v1/crates", &params).await?.unwrap_or_default();
            v["crates"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|c| Pkg {
                            name: s(&c["name"]),
                            version: c["max_stable_version"].as_str().or(c["newest_version"].as_str()).unwrap_or("").to_string(),
                            description: s(&c["description"]),
                            downloads: c["downloads"].as_u64(),
                            ..Default::default()
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "maven" => {
            if q.is_empty() {
                return Ok(Vec::new());
            }
            let v = get("https://search.maven.org/solrsearch/select", &[("q", q), ("rows", "30"), ("wt", "json")])
                .await?
                .unwrap_or_default();
            v["response"]["docs"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|d| Pkg {
                            name: s(&d["a"]),
                            id: format!("{}:{}", s(&d["g"]), s(&d["a"])),
                            version: s(&d["latestVersion"]),
                            description: s(&d["g"]),
                            ..Default::default()
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "nuget" => {
            let v = get("https://azuresearch-usnc.nuget.org/query", &[("q", q), ("take", "30"), ("prerelease", "false")])
                .await?
                .unwrap_or_default();
            v["data"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|d| Pkg {
                            name: s(&d["id"]),
                            version: s(&d["version"]),
                            description: s(&d["description"]),
                            downloads: d["totalDownloads"].as_u64(),
                            ..Default::default()
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "go" => golang(q).await?,
        "pub" => {
            let v = get("https://pub.dev/api/search", &[("q", if q.is_empty() { "flutter" } else { q })]).await?.unwrap_or_default();
            v["packages"]
                .as_array()
                .map(|a| a.iter().take(30).map(|p| Pkg { name: s(&p["package"]), ..Default::default() }).collect())
                .unwrap_or_default()
        }
        "packagist" => {
            let v = get("https://packagist.org/search.json", &[("q", q), ("per_page", "30")]).await?.unwrap_or_default();
            v["results"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|p| Pkg {
                            name: s(&p["name"]),
                            description: s(&p["description"]),
                            downloads: p["downloads"].as_u64(),
                            ..Default::default()
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "rubygems" => {
            if q.is_empty() {
                return Ok(Vec::new());
            }
            let v = get("https://rubygems.org/api/v1/search.json", &[("query", q)]).await?.unwrap_or_default();
            v.as_array()
                .map(|a| {
                    a.iter()
                        .take(30)
                        .map(|g| Pkg {
                            name: s(&g["name"]),
                            version: s(&g["version"]),
                            description: s(&g["info"]),
                            downloads: g["downloads"].as_u64(),
                            ..Default::default()
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        other => return Err(format!("неизвестный реестр: {other}")),
    };
    Ok(list)
}
