# LoopStack

**A Mac app for people who use open-source Loop.** It reads your own Nightscout and shows what your glucose, your meals and Loop did, in plain words. Then it helps you take that to your care team.

![LoopStack dashboard](desktop/screenshots/dashboard.png)

> **LoopStack is not a medical device and gives no medical advice.** It describes what already happened in your data. It never tells you what to dose and never changes your pump, your pod or your Loop settings on its own. Talk to your care team before you change any setting. LoopStack is an independent project: it is not made by, endorsed by or affiliated with LoopKit, Tidepool, Dexcom, Insulet or Nightscout.

## What it does

- **Dashboard you arrange yourself.** Glucose now, daily trend heads-ups, a day tracker, what Loop did hour by hour, favorite foods, and more. Move, resize and save layouts.
- **Favorite foods.** Every time you had each favorite: how far out of 70–180 it went on each side (caution buffer, high or low, dangerously high or low) and whether it trends high or low, and the absorption time you entered against how long glucose actually took to come back.
- **Care-team review.** A one-page packet in the AGP order clinicians already read, with Trends and your own Notes since the last visit. Save it as a PDF or email it from your own mail app. Pick a report style your clinician already knows.
- **Suggestions.** When LoopStack's measured readings point at a setting or a food's absorption time, it shows the evidence and its confidence. Track one to watch it build. Nothing reaches Loop without you reviewing it and confirming it in Loop itself.
- **Your Loop build (optional).** Connect your LoopWorkspace fork on GitHub to see your build, how long it has left, and the community features in it, with on/off switches.
- **Ask & build (optional).** Ask questions about your own data in plain language with your own Anthropic API key. Answers are observations, never dosing advice.

Everything stays on your Mac. Your Nightscout token, GitHub token and API key are kept in the macOS keychain. LoopStack has no server and collects nothing.

## Get started

You need a Mac with Apple silicon (M1 or later) and a Nightscout site that your Loop uploads to.

1. **Get the app.** Download `LoopStack.dmg` from the [latest release](../../releases/latest), open it and drag LoopStack to Applications. Or [build it yourself](#build-from-source).
2. **Open it the first time.** The app isn't notarized by Apple yet, so macOS stops the first launch. Open **System Settings → Privacy & Security**, scroll down to the LoopStack message and choose **Open Anyway**. You only do this once.
3. **Try it with sample data.** LoopStack opens on a synthetic patient, so you can look around before connecting anything.
4. **Connect your Nightscout.** Go to **Settings → Your data** and enter your Nightscout address and a read-only access token. LoopStack reads the last 30 days.

Then read **[How to use LoopStack](HOW-TO-USE.md)**.

**Rather have an AI assistant set it up?** Paste the prompt in **[SETUP-WITH-AI.md](SETUP-WITH-AI.md)** into Claude Code or another coding assistant. It builds the app, checks it, and walks you through connecting your data.

## Build from source

You need Node.js 20 or later and Git.

```bash
git clone https://github.com/Rdeboer180/LoopStack.git
cd LoopStack
npm install
npm --prefix desktop install
npm run desktop:dist
open desktop/release/mac-arm64/LoopStack.app
```

Other commands:

| Command | What it does |
|---|---|
| `npm run desktop:dev` then `npm run desktop:app` | Run with live reload while you change the code |
| `npm run desktop:test` | Run the desktop tests |
| `npm run desktop:web` | Build a browser-only demo with sample data into `desktop/dist-web` |

## How it stays safe

The rules every screen follows are in [PRODUCT.md](PRODUCT.md). In short:

- **Observations, never instructions.** LoopStack says what happened, never what to dose.
- **Nothing writes to your device.** The only way anything reaches Loop is through your own build: you review the change, confirm it, and Loop shows it as a proposal you accept in Loop's own settings, under Loop's guardrails. Safety limits (glucose safety limit, max basal, max bolus) are never suggested.
- **No language model writes settings.** Suggested values come only from LoopStack's measured engines, at their top confidence grade, and never more than a 20% step.

## Repository map

| Path | What's there |
|---|---|
| `desktop/` | The Mac app (Electron + React). Start here. |
| `src/` | The phone prototype and the shared measurement engines the desktop app reuses |
| `docs/` | Design and product documentation |
| `PRODUCT.md`, `DESIGN.md` | Product and clinical-safety rules; visual rules |

## Feedback

Found a bug or have an idea? [Open an issue](../../issues). Please don't post your Nightscout address, tokens or health data in an issue.
