# Chrome Web Store release

Everything the Chrome Web Store developer console asks for, ready to paste. The same zip and texts work for Microsoft Edge Add-ons.

## 1. Build the package

```bash
pnpm release:extension
```

It builds the extension and writes `release/stacksketch-extension-<version>.zip`, with `manifest.json` at the root of the zip. Upload that file. For an update, raise `version` in `apps/extension/public/manifest.json` (and `apps/extension/package.json`) first: the store rejects a version it has already seen.

## 2. Store listing tab

**Name:** Stacksketch (taken from the manifest)

**Summary** (from the manifest, 128 of 132 characters):

> Check your page against the Figma design, see why z-index fails, and send the Stacksketch workbench's API requests without CORS.

**Category:** Developer Tools

**Language:** English

**Description:**

```text
Stacksketch is the companion extension for the Stacksketch workbench (https://stacksketch.netlify.app), a free, open-source tool for the contract between frontend and backend.

SEND API REQUESTS WITHOUT CORS
The workbench's API client sends requests to your real API, checks every response against your API contract, and runs whole collections in order. A web page can only read answers from APIs that allow it (CORS), and most backends under development don't. With this extension installed, pick "Extension" in the API client and requests go out from the extension instead:
• localhost and 127.0.0.1 work straight away
• any other host asks for your permission once, the first time you send to it
• your browser's cookies are never attached; only the headers you write are sent

DESIGN QA ON THE LIVE PAGE
• Lay a Figma frame export over your page with opacity, difference blending, @2x/@3x scale and arrow-key nudging, or lock it to an element
• Measure: hover for an element's size and type; click one and hover another to see the gap between them
• Check font size, line height, weight and letter spacing against the design's values
• Pin numbered comments, each with a screenshot, and download a Markdown QA report

WHY IS MY MODAL BEHIND THE HEADER?
The stacking inspector scans the page and shows every stacking context as an exploded 3D stack with its z-index. Click one to see why it starts a context ("it has a transform"), and click two to see which paints on top and why.

PRIVATE BY DESIGN
No account, no analytics, no tracking, no remote code. It runs only on localhost, the Stacksketch workbench, and sites you turn it on for. Images, comments, reports and responses stay in your browser.

Open source under the MIT licence.
```

**Graphic assets** (all in this folder):

| Field | File |
| --- | --- |
| Store icon (128×128) | `apps/extension/public/icons/icon-128.png` |
| Screenshots (1280×800, upload in this order) | `screenshot-1-api-client.png`, `screenshot-2-contract-check.png`, `screenshot-3-stacking.png`, `screenshot-4-measure.png`, `screenshot-5-qa-overlay.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |

The marquee promo tile (1400×560) is optional; leave it empty.

**Additional fields:**

- Official URL: none (it needs a verified domain in Search Console; skip it)
- Homepage URL: `https://stacksketch.netlify.app`
- Support URL: `https://stacksketch.netlify.app` (or the GitHub repo's issues page, if the repo is public)
- Mature content: No

## 3. Privacy tab

**Single purpose:**

```text
Stacksketch is a developer companion for the Stacksketch workbench: it helps frontend and backend developers check the page they are building, by overlaying the design and inspecting layout and stacking on the live page, and by sending the workbench API client's requests to their own APIs without CORS restrictions.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `sidePanel` | The tools (design overlay, measuring, comments, stacking inspector) are shown in Chrome's side panel next to the page being checked. |
| `storage` | Remembers which sites the user turned Stacksketch on for. Nothing else is stored, and nothing is synced or sent anywhere. |
| `scripting` | Registers the content script only on the sites the user turned Stacksketch on for (localhost and the workbench by default), so it doesn't run anywhere else, and starts it on tabs that were open before. |
| `activeTab` | Lets the side panel work on the tab the user is looking at when they open it, including taking a screenshot of the visible tab for a QA comment. |
| `tabs` | Reads the active tab's URL to show whether Stacksketch is on for that site, and sends messages to the content script in that tab. |
| Host permission: `http://localhost/*`, `http://127.0.0.1/*` | Developers check pages and APIs running on their own machine. The content script runs there, and the API client's requests to local servers are sent without CORS. |
| Host permission: `https://stacksketch.netlify.app/*` | The Stacksketch workbench. A small bridge script runs there to pass the API client's requests to the extension. |
| Optional host permissions: `http://*/*`, `https://*/*` | Never granted at install. Requested one host at a time, only when the user clicks "Turn on for this site" in the side panel or "Allow <host>" in the API client, so they can check their own staging site or send requests to their own API. |

**Remote code:** No, I am not using remote code. (Everything is bundled in the package, fonts included.)

**Data usage:** tick **none** of the data types. The extension reads page layout and styles in the browser to measure and inspect, and sends API requests the user writes to the URLs they type, but it doesn't collect or transmit any user data to the developer or anyone else.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://stacksketch.netlify.app/privacy.html` (from `apps/web/public/privacy.html`; it must be deployed before you submit)

## 4. Distribution tab

- Payments: Free
- Visibility: Public (or Unlisted to try the store install first; anyone with the link can install it)
- Regions: All regions

## 5. Test instructions (for the reviewer)

```text
No account or login is needed.

Side panel tools: open any page on http://localhost (or turn Stacksketch on for any site from the panel), click the Stacksketch toolbar button, and use the Overlay, Measure, Comments and Stacking tabs. On Stacking, click "Scan the page".

API requests: open https://stacksketch.netlify.app, pick "API client" in the sidebar, and choose "Extension" under "Send with" (it shows "Extension connected"). Send a request to any URL: for a host other than localhost, the extension asks for permission once, in a small window, before sending.
```

## Before you submit

1. Deploy the workbench so `https://stacksketch.netlify.app/privacy.html` loads.
2. Run `pnpm release:extension` and upload `release/stacksketch-extension-0.7.0.zip`.
3. Fill the four tabs from this page, then **Submit for review**. Reviews usually take a few days; broad optional host permissions can make it longer.
