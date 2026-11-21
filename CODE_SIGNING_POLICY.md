# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

> Status: the application to the SignPath Foundation program is pending. Until it is approved, Windows installers are not signed.

## What is signed

Only the Windows installer (`Tulpar_<version>_x64-setup.exe`) and the `tulpar.exe` it contains, built by GitHub Actions from this public repository ([`.github/workflows/release.yml`](.github/workflows/release.yml)) from a `v*` tag on the `main` branch. Nothing built on a personal computer is ever signed.

## Team roles

- Committers and reviewers: [sasiskax27](https://github.com/sasiskax27)
- Approvers: [sasiskax27](https://github.com/sasiskax27)

Every signing request is approved manually. All team members use multi-factor authentication on GitHub and SignPath.

## Privacy policy

Tulpar does not collect telemetry and does not send any data about you or your code anywhere on its own.

It connects to the internet only:

- to check for updates on GitHub (`api.github.com`, every 12 hours; can be turned off in Settings → "Check for updates");
- to services that you explicitly turn on yourself: an AI provider you configure (Ollama, OpenAI, Anthropic, OpenRouter, OpenCode), GitHub Copilot, Git remotes, Open VSX (themes), and package registries (npm, PyPI, crates.io and others) when you search for libraries.

What these services do with the data is governed by their own privacy policies.
