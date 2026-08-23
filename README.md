# IdleBoost

**The all-in-one desktop manager for warming and growing Steam accounts, powered by ArchiSteamFarm.**

IdleBoost is a Windows desktop application that gives you a clean, modern control center for running a Steam bot farm. It wraps [ArchiSteamFarm (ASF)](https://github.com/JustArchiNET/ArchiSteamFarm) and adds a friendly dashboard, a smart warming engine, item storage, automation, and detailed account analytics — so you can manage dozens or hundreds of Steam accounts without touching a single config file.

[![Platform](https://img.shields.io/badge/platform-Windows-blue)](#)
[![Built with](https://img.shields.io/badge/built%20with-Electron-47848F)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)
[![ASF](https://img.shields.io/badge/powered%20by-ArchiSteamFarm-66c0f4)](https://github.com/JustArchiNET/ArchiSteamFarm)

---

## What IdleBoost does

Warming a Steam account means making it look real and established: playing games to build playtime, farming trading cards, redeeming free games, and completing a profile. Doing this by hand for many accounts is slow and error-prone. IdleBoost automates the whole process and keeps every account healthy, organized, and monitored from one place.

### Warming engine

The heart of IdleBoost. Start the engine and it rotates through your accounts automatically:

- Each bot farms its **trading cards first**.
- When a bot runs out of cards, it **idles on its owned games** to build playtime (up to 32 games at once).
- You control how many accounts run simultaneously and how long each one stays online.
- Sessions are randomized and spread over time so traffic looks natural.

A live panel shows every active session with a countdown and a blue-to-orange progress bar.

### Item storage and transfers

Designate any account as a **storage account** to hold items for the whole farm:

- Paste the account's Steam **trade link** once — it is saved locally and reused.
- Transfer items from all active bots into storage in one click. Transfers are spread out with random delays.
- Storage accounts stay offline and only come online to accept trades, then confirm them automatically.

### Automation

- **Free games redemption** — automatically claims free games as they appear on Steam, with smart limits so Steam is never flooded.
- **Achievement manager** — unlocks achievements across each account's library, one game at a time, at a pace you choose.

### Account analytics

A local database keeps a history for every account so you can see real growth over time:

- Total **hours farmed** across all games.
- **Wallet balance** for each account, kept even while the account is offline.
- Games owned and playtime per account.

### Steam profile setup

Give each account a believable identity in one step: a random avatar, a country, and a public profile.

### Ban checker

Check every account against the Steam Web API for VAC, community, and economy bans, so you always know the health of your farm.

### Discord notifications

Connect a Discord webhook and get real-time alerts for what your farm is doing — warming sessions, redeemed games, profile updates, item transfers, trading-card drops, and updates.

### Proxy support

Import a list of proxies in bulk and IdleBoost assigns one to each bot automatically, keeping traffic separated per account.

### Bulk importers

Add accounts in seconds by pasting a list, and import two-factor `.maFile` authenticators so trades and confirmations are handled automatically.

### Live console

Watch the full ASF output in real time, color-coded by source, for easy troubleshooting.

---

## Getting started

IdleBoost is a portable app — no installation required.

1. Download the latest release (`IdleBoost.exe`).
2. Run it. ArchiSteamFarm is bundled and starts automatically.
3. Import your accounts from the **Importers** section.
4. Press **Start** on the dashboard to begin warming.

### Requirements

- Windows 10 or newer (64-bit).
- Your Steam account credentials (and `.maFile` authenticators if you use two-factor).

---

## A note on safety

IdleBoost builds on ArchiSteamFarm, a mature and widely used open-source project. Automated account activity can be against Steam's terms of service, and accounts used this way may be limited or banned. IdleBoost is provided for educational purposes. Use it responsibly and at your own risk.

---

## Support the project

IdleBoost is free and developed in my spare time. If it helps you, consider donating some Steam skins to help my bot farm grow.

[![Donate Skins](https://img.shields.io/badge/Donate_Steam_Skins-1b2838?style=for-the-badge&logo=steam&logoColor=66c0f4)](https://steamcommunity.com/tradeoffer/new/?partner=184539136&token=-gLggeA0)

**Send a trade offer here:** [steamcommunity.com/tradeoffer/new/?partner=184539136&token=-gLggeA0](https://steamcommunity.com/tradeoffer/new/?partner=184539136&token=-gLggeA0)

Every skin, no matter how small, keeps the project alive. Thank you.

---

## License

IdleBoost is released under the MIT License. ArchiSteamFarm and its plugins belong to their respective owners.
