# Site Crawler Screenshot Taker — Authenticated Site Crawler & Screenshot Tool

A Node.js tool that logs into a website, crawls every reachable page automatically, and captures screenshots at desktop, tablet, and mobile viewports. Built for redesign workflows where you need accurate screenshots of every page without manual capture.

---

## Features

- **Auto-login** — fills credentials, submits the form, and carries the session through the entire crawl
- **Full site crawl** — discovers pages by following internal links, no URL list needed
- **Multi-viewport** — captures desktop (1440px), tablet (768px), and mobile (390px) for every page
- **Full-page screenshots** — captures the entire scrollable height, not just the viewport
- **Skip patterns** — regex rules to exclude logout URLs, pagination, admin pages, etc.
- **Resume-safe** — skips files that already exist, so interrupted runs can be continued
- **JSON config** — all options in one file, no hardcoded values in the script

---

## Requirements

- Node.js 16+
- npm

---

## Installation

```bash
git clone https://github.com/jonmadethis/site-crawler-screenshot-taker.git
cd site-crawler-screenshot-taker
npm install
```

---

## Configuration

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

### Full config reference

```json
{
  "startUrl": "https://yoursite.com",
  "outputDir": "./screenshots",
  "maxPages": 200,
  "screenshotDelay": 800,
  "fullPage": true,
  "waitUntil": "networkidle2",

  "viewports": [
    { "name": "desktop", "width": 1440, "height": 900 },
    { "name": "tablet",  "width": 768,  "height": 1024 },
    { "name": "mobile",  "width": 390,  "height": 844 }
  ],

  "skipPatterns": [
    "/logout",
    "/signout",
    "/delete",
    "\\?sort=",
    "\\?page="
  ],

  "allowedDomains": [],

  "login": {
    "enabled": true,
    "url": "https://yoursite.com/login",
    "usernameSelector": "input[name='email']",
    "passwordSelector": "input[name='password']",
    "submitSelector": "button[type='submit']",
    "username": "you@example.com",
    "password": "yourpassword",
    "waitAfterLogin": 2000,
    "successIndicator": null
  }
}
```

| Option | Type | Description |
|---|---|---|
| `startUrl` | string | **Required.** The URL where crawling begins. |
| `outputDir` | string | Where screenshots are saved. Created if it doesn't exist. |
| `maxPages` | number | Safety cap on pages crawled. Increase for large sites. |
| `screenshotDelay` | number | Milliseconds to wait before capturing. Lets animations settle. |
| `fullPage` | boolean | Captures full scrollable height when `true`. |
| `waitUntil` | string | Puppeteer navigation event. `networkidle2` works for most sites. |
| `viewports` | array | List of viewport sizes to capture for each page. |
| `skipPatterns` | array | Regex strings — matching URLs are skipped during crawl. |
| `allowedDomains` | array | Additional domains to follow (e.g. app subdomains, CDNs). |
| `login.enabled` | boolean | Set to `false` for public sites that don't require login. |
| `login.url` | string | Login page URL. Defaults to `startUrl` if not set. |
| `login.usernameSelector` | string | CSS selector for the username/email input. |
| `login.passwordSelector` | string | CSS selector for the password input. |
| `login.submitSelector` | string | CSS selector for the submit button. |
| `login.username` | string | Login credential. |
| `login.password` | string | Login credential. |
| `login.waitAfterLogin` | number | Milliseconds to wait after submitting the login form. |
| `login.successIndicator` | string | Optional CSS selector that only appears when logged in. Used to confirm login worked. |

---

## Usage

```bash
# Uses config.json in the current directory
node capture.js

# Use a specific config file
node capture.js my-config.json
```

### Output

Screenshots are saved to `outputDir` with filenames in this format:

```
sitename__page-path__viewport.png
```

Examples:

```
myapp-com__home__desktop.png
myapp-com__dashboard__mobile.png
myapp-com__settings__profile__tablet.png
```

---

## Login Troubleshooting

**Default selectors** (`input[name="email"]`, `input[name="password"]`, `button[type="submit"]`) cover most standard login forms. If login fails, inspect the form in your browser's DevTools and update the selectors to match.

**SPAs and delayed redirects** — if the app doesn't do a full page navigation after login (common with React/Vue apps), increase `waitAfterLogin` to give the app time to load the authenticated state.

**2FA / OAuth / magic links** — auto-login won't work for these flows. Set `login.enabled: false` and use the cookie import method instead (see below).

### Cookie import (for non-standard login)

If you can't automate the login, you can export cookies from a logged-in browser session and pass them to Puppeteer manually. Log in normally in Chrome, export cookies using a browser extension like [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie), save them to `cookies.json`, and add this block after `browser.newPage()` in the script:

```js
const cookies = JSON.parse(fs.readFileSync('cookies.json', 'utf-8'));
await page.setCookie(...cookies);
```

---

## Security Note

`config.json` contains your login credentials in plain text. Add it to `.gitignore` before committing:

```bash
echo "config.json" >> .gitignore
```

Only `config.example.json` (with placeholder values) should be committed to the repo.

---

## License

MIT
