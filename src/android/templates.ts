// Шаблоны Android-приложений. Версии проверены вместе:
// AGP 8.12.2 + Gradle 8.14.3 + Kotlin 2.2.10 + Compose BOM 2025.08.00, compileSdk 36, JDK 17+.

export interface AppTemplate {
  id: "compose" | "todo" | "webview";
  icon: string;
  title: string;
  desc: string;
}

export const APP_TEMPLATES: AppTemplate[] = [
  { id: "compose", icon: "✨", title: "Пустое приложение", desc: "Kotlin + Jetpack Compose: экран с кнопкой — основа для чего угодно" },
  { id: "todo", icon: "✅", title: "Список дел", desc: "готовое приложение: добавлять, отмечать и удалять задачи, всё сохраняется" },
  { id: "webview", icon: "🌐", title: "Сайт → приложение", desc: "ваш HTML/CSS/JS из этой папки внутри Android-приложения" },
];

export const AGP = "8.12.2";
export const KOTLIN = "2.2.10";
export const COMPOSE_BOM = "2025.08.00";

interface Ctx {
  title: string;
  appId: string;
  pkgPath: string;
  web: Record<string, string>;
}

const kt = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "\\'");

function rootFiles(c: Ctx, compose: boolean): Record<string, string> {
  return {
    "settings.gradle.kts": `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${kt(c.title.replace(/[\\/:<>"?*|]/g, "").trim() || "app")}"
include(":app")
`,
    "build.gradle.kts": `plugins {
    id("com.android.application") version "${AGP}" apply false
    id("org.jetbrains.kotlin.android") version "${KOTLIN}" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "${KOTLIN}" apply false
}
`,
    "gradle.properties": `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`,
    ".gitignore": `.gradle/
build/
local.properties
keystore.properties
*.keystore
*.jks
.idea/
.kotlin/
`,
    "README.md": `# ${c.title}

Android-приложение, созданное в Tulpar.

- Собрать и поставить на телефон: Tulpar → 📱 Android → «Собрать и запустить»
- Или в терминале: \`./gradlew assembleDebug\` — APK появится в \`app/build/outputs/apk/debug\`
- Файл для Google Play: \`./gradlew bundleRelease\` (нужен ключ подписи, см. keystore.properties)
`,
    "app/build.gradle.kts": `import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")${compose ? '\n    id("org.jetbrains.kotlin.plugin.compose")' : ""}
}

// Ключ подписи для Google Play: keystore.properties рядом с проектом (не попадает в git)
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "${c.appId}"
    compileSdk = 36

    defaultConfig {
        applicationId = "${c.appId}"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        if (keystoreProps.getProperty("storePassword", "").isNotEmpty()) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
${compose ? "\n    buildFeatures {\n        compose = true\n    }\n" : ""}}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
${compose
  ? `    implementation("androidx.activity:activity-compose:1.10.1")
    implementation(platform("androidx.compose:compose-bom:${COMPOSE_BOM}"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")`
  : `    implementation("androidx.activity:activity-ktx:1.10.1")`}
}
`,
    "app/src/main/res/drawable/ic_launcher.xml": `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#2E7DF6" android:pathData="M54,4a50,50 0,1 1,0 100a50,50 0,1 1,0 -100z" />
    <path android:fillColor="#FFFFFF" android:pathData="M34,38h40v8H58v32h-8V46H34z" />
</vector>
`,
    "app/src/main/res/values/strings.xml": `<resources>
    <string name="app_name">${xml(c.title)}</string>
</resources>
`,
  };
}

function manifest(internet: boolean) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${internet ? '    <uses-permission android:name="android.permission.INTERNET" />\n' : ""}
    <application
        android:label="@string/app_name"
        android:icon="@drawable/ic_launcher"
        android:roundIcon="@drawable/ic_launcher"
        android:theme="@android:style/Theme.Material.NoActionBar">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}

const composeHead = (c: Ctx) => `package ${c.appId}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
`;

function composeMain(c: Ctx) {
  return `${composeHead(c)}import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) { App() }
        }
    }
}

@Composable
fun App() {
    var count by rememberSaveable { mutableIntStateOf(0) }
    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("${kt(c.title)}", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(8.dp))
            Text("Сделано в Tulpar", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(32.dp))
            Text("\$count", fontSize = 64.sp)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { count++ }) { Text("Нажми меня") }
        }
    }
}
`;
}

function todoMain(c: Ctx) {
  return `${composeHead(c)}import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

data class Task(val text: String, val done: Boolean)

// Задачи хранятся в SharedPreferences: одна строка на задачу, «1|» — выполнена
private fun load(ctx: Context): List<Task> =
    ctx.getSharedPreferences("tasks", Context.MODE_PRIVATE).getString("list", "")!!
        .lines().filter { it.length > 2 }.map { Task(it.substring(2), it.startsWith("1")) }

private fun save(ctx: Context, list: List<Task>) =
    ctx.getSharedPreferences("tasks", Context.MODE_PRIVATE).edit()
        .putString("list", list.joinToString("\\n") { (if (it.done) "1|" else "0|") + it.text.replace("\\n", " ") }).apply()

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) { TodoApp() }
        }
    }
}

@Composable
fun TodoApp() {
    val ctx = LocalContext.current
    val tasks = remember { mutableStateListOf<Task>().apply { addAll(load(ctx)) } }
    var input by remember { mutableStateOf("") }
    fun changed() = save(ctx, tasks)

    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${kt(c.title)}", style = MaterialTheme.typography.headlineMedium)
            Text("Осталось: \${tasks.count { !it.done }} из \${tasks.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = input, onValueChange = { input = it }, modifier = Modifier.weight(1f), placeholder = { Text("Новая задача") }, singleLine = true)
                Button(onClick = {
                    if (input.isNotBlank()) {
                        tasks.add(0, Task(input.trim(), false))
                        input = ""
                        changed()
                    }
                }) { Text("+") }
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(tasks.toList()) { task ->
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = task.done, onCheckedChange = { on ->
                                val i = tasks.indexOf(task)
                                if (i >= 0) { tasks[i] = task.copy(done = on); changed() }
                            })
                            Text(
                                task.text,
                                modifier = Modifier.weight(1f),
                                textDecoration = if (task.done) TextDecoration.LineThrough else null,
                            )
                            TextButton(onClick = { tasks.remove(task); changed() }) { Text("✕") }
                        }
                    }
                }
            }
        }
    }
}
`;
}

function webviewMain(c: Ctx) {
  return `package ${c.appId}

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = true
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        setContentView(web)
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("file:///android_asset/www/index.html")

        // Кнопка «Назад» листает историю страниц, а не закрывает приложение
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }
}
`;
}

const DEFAULT_PAGE = (title: string) => `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #0f1115; color: #eee; }
    button { font-size: 20px; padding: 12px 24px; border-radius: 12px; border: 0; background: #2e7df6; color: #fff; }
  </style>
</head>
<body>
  <main style="text-align:center">
    <h1>${title}</h1>
    <p>Положите сюда свой index.html — и это станет приложением.</p>
    <button onclick="this.textContent = 'Работает!'">Нажми</button>
  </main>
</body>
</html>
`;

export function TEMPLATE_FILES(id: AppTemplate["id"], c: Ctx): Record<string, string> {
  const compose = id !== "webview";
  const files = rootFiles(c, compose);
  files["app/src/main/AndroidManifest.xml"] = manifest(id === "webview");
  const main = `app/src/main/java/${c.pkgPath}/MainActivity.kt`;
  if (id === "compose") files[main] = composeMain(c);
  if (id === "todo") files[main] = todoMain(c);
  if (id === "webview") {
    files[main] = webviewMain(c);
    const web = Object.keys(c.web).length ? c.web : { "index.html": DEFAULT_PAGE(c.title.replace(/</g, "&lt;")) };
    if (!web["index.html"]) web["index.html"] = DEFAULT_PAGE(c.title.replace(/</g, "&lt;"));
    for (const [name, text] of Object.entries(web)) files[`app/src/main/assets/www/${name}`] = text;
  }
  return files;
}
