# Monolog

**Monolog** is a headless, single-column content aggregator and personal website engine.

It treats the internet as your CMS. Instead of logging into a WordPress admin panel or writing markdown files in a specific folder, you simply live your digital life: write posts on GitHub Discussions, bookmark interesting links on Raindrop, push code to GitLab, or post thoughts on Bluesky.

Monolog fetches this activity via APIs, normalizes it into a single timeline, categorizes it with a zero-JavaScript filtering system, and generates a static HTML site (plus custom RSS feeds) automatically.

---

## 🚀 Quick Start

1.  **Fork this Repository.**
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Configure:** Copy the example config and edit it.
    ```bash
    cp config.example.json config.json
    ```
4.  **Set Secrets:** Create a `.env` file (see [Secrets](#-secrets--environment-variables)).
5.  **Build:**
    ```bash
    node build.js
    ```

---

## 📝 Writing Content (The CMS)

Monolog uses **GitHub Discussions** as its primary authoring tool. To set this up, enable "Discussions" in your GitHub repository settings.

| Content Type | Where to Write | How it appears |
| :--- | :--- | :--- |
| **Article** | Discussion Category: **"General"** | Title + Summary. Click to read full post. Labels become tags. |
| **Note** | Discussion Category: **"Notes"** | Microblog style. Full content shown inline. No title required. |
| **Now Page** | Discussion Category: **"Now"** | The most recent post in this category is pinned to the top of the homepage. |
| **Draft** | Discussion Category: **"Drafts"** | Ignored by the build script. |

---

## ⚙️ Configuration Reference (`config.json`)

The `config.json` file controls everything. Below is the complete documentation for every section.

### `profile`
Controls the header, footer, and SEO meta tags.

| Property | Type | Description |
| :--- | :--- | :--- |
| `name` | string | Displayed in the header and `<title>`. |
| `tagline` | string | Displayed below the name and in meta description. |
| `url` | string | The production URL (used for canonical links/RSS). |
| `email` | string | Displayed in footer. |
| `og_image` | string | Absolute URL to an image used for Twitter/OpenGraph cards. |
| `copyright_start`| string | Year to start the copyright range (e.g., "2023"). |
| `socials` | array | List of links to display in the footer. |

**Example:**
```json
"profile": {
  "name": "John Doe",
  "tagline": "Building the future, one commit at a time.",
  "url": "https://johndoe.com",
  "socials": [
    { "name": "github", "url": "https://github.com/johndoe" },
    { "name": "bluesky", "url": "https://bsky.app/profile/johndoe.bsky.social" }
  ]
}
```

---

### `analytics`
Monolog supports privacy-friendly analytics out of the box.

| Provider | Config Keys | Description |
| :--- | :--- | :--- |
| **plausible** | `enabled` (bool), `domain`, `src` | Injects the Plausible tracking script. |
| **cloudflare** | `enabled` (bool), `token` | Injects the Cloudflare Web Analytics beacon. |

---

### `github` (Source)
The core engine. Fetches Discussions, Issues, and Releases via GraphQL.

**`sources` array options:**
| Property | Required | Description |
| :--- | :--- | :--- |
| `name` | **Yes** | Internal ID used for generating specific RSS feeds later. |
| `owner` | **Yes** | The GitHub username or Organization name. |
| `repos` | **Yes** | Array of repository names to fetch from. |
| `discussions` | No | `true`/`false` (Default: `true`). Fetch blog posts/notes. |
| `releases` | No | `true`/`false` (Default: `true`). Fetch releases/tags. |
| `issues` | No | `true`/`false` (Default: `false`). Fetch issue activity. |

**Other Options:**
*   `groups`: Maps specific repositories to a "Topic" tag in the filter bar. Useful for grouping multiple micro-services under one project name.
*   `tag_overrides`: A dictionary to fix tag casing (e.g., convert the slug "ios" to display "iOS").

**Example:**
```json
"github": {
  "sources": [
    {
      "name": "personal",
      "owner": "johndoe",
      "repos": ["blog"],
      "discussions": true
    },
    {
      "name": "work",
      "owner": "acme-corp",
      "repos": ["backend-api"],
      "discussions": false,
      "releases": true
    }
  ],
  "groups": {
    "Infrastructure": ["johndoe/dotfiles", "backend-api"]
  },
  "tag_overrides": { "api": "API", "css": "CSS" }
}
```

---

### `bluesky` (Source)
Fetches posts from Bluesky as "Notes".

**`sources` array options:**
| Property | Description |
| :--- | :--- |
| `name` | Internal ID for RSS filtering. |
| `handle` | Your Bluesky handle (e.g., `user.bsky.social`). |
| `feed` | *(Optional)* A custom feed URI (e.g., `at://did:plc:...`). If omitted, fetches the user's author feed. |

---

### `mastodon` (Source)
Fetches toots from any Mastodon-compatible instance.

**`sources` array options:**
| Property | Description |
| :--- | :--- |
| `name` | Internal ID for RSS filtering. |
| `instance`| The domain of the instance (e.g., `mastodon.social`). |
| `id` | The **Numeric User ID**. *To find this: Go to your profile page, view source, and search for `rss` or check the API response for your username.* |

---

### `youtube` (Source)
Fetches recent videos.

**`sources` array options:**
| Property | Description |
| :--- | :--- |
| `name` | Internal ID for RSS filtering. |
| `channel_id` | The ID starting with `UC...`. You can find this in the URL of your channel page. |

---

### `raindrop` (Source)
Fetches bookmarks from Raindrop.io collections.

| Property | Description |
| :--- | :--- |
| `collection_id` | The numeric ID of the collection. `0` is "All Bookmarks". |

---

### `gitlab` / `gitea` / `bitbucket` (Sources)
Fetch releases/tags from other git forges.

| Service | Config Keys | Description |
| :--- | :--- | :--- |
| **gitlab** | `instance` (default `gitlab.com`), `id` (Project ID) | Fetch releases for a specific project ID. |
| **gitea** | `instance` (domain), `owner`, `repo` | Fetch releases from a Gitea repo. |
| **bitbucket** | `workspace`, `repo_slug` | Fetch tags from a Bitbucket repo. |

---

### `feeds` (Output)
Define exactly which content goes into which RSS/Atom feed file.

| Property | Description |
| :--- | :--- |
| `type` | `rss` or `atom`. |
| `title` | The title of the feed (defaults to Profile Name if omitted). |
| `sources` | An array of `name` strings defined in your sources above. Use `["*"]` to include everything. |
| `groups` | *(Optional)* Filter items further by requiring them to belong to a specific Group defined in `github.groups`. |

**Example:**
```json
"feeds": {
  // The Firehose: Everything
  "feed.xml": { "type": "rss", "sources": ["*"] },

  // Only items from the 'personal' github source and 'vlog' youtube source
  "feeds/personal.xml": {
    "type": "atom",
    "sources": ["personal", "vlog"],
    "title": "John's Personal Updates"
  }
}
```

---

## 🔑 Secrets & Environment Variables

Create a `.env` file in the root directory for local development. In GitHub Actions, add these to **Settings > Secrets and variables > Actions**.

### Required
*   **`GH_TOKEN`**: A GitHub Personal Access Token (Classic).
    *   **Scopes:** `repo` (if fetching private repos), `public_repo` (if public), `read:discussion`.
    *   *Why?* Even for public repos, the GraphQL API requires authentication to avoid rate limits.

### Optional (Service Dependent)
*   **`RAINDROP_TOKEN`**: Required if using Raindrop. Get a "Test Token" from the Raindrop integration settings.
*   **`GITLAB_TOKEN`**: Required if fetching from private GitLab repositories.
*   **`GITEA_TOKEN`**: Required if fetching from a private Gitea instance.
*   **`BITBUCKET_APP_PASS`**: Required if fetching from private Bitbucket repos (username in config, app password here).

---

## 🤖 Automation (GitHub Actions)

The included workflow (`.github/workflows/deploy.yml`) handles the build.

1.  It runs on a schedule (default: every 4 hours).
2.  It runs when you push config changes to `main`.
3.  It checks out your code, installs Node, runs `build.js`, and uploads the resulting HTML/XML to GitHub Pages.

**To enable:**
1.  Go to your repo **Settings**.
2.  Click **Pages** on the left.
3.  Under **Build and deployment**, set Source to **GitHub Actions**.

---

## 🎨 Theming

Monolog uses CSS Variables defined in `index.template.html`. It utilizes the **OKLCH** color space for perceptually uniform colors.

To customize the look, edit the `:root` block in `index.template.html`:

```css
:root {
    --c-paper: oklch(99% 0 0);       /* Background */
    --c-text: oklch(20% 0 0);        /* Text */
    --c-accent: oklch(45% 0.24 270); /* The main accent color (Purple) */
    --w-content: 42rem;              /* Width of the column */
}
```

Dark mode is automatically handled via media queries. To change dark mode colors, edit the `@media (prefers-color-scheme: dark)` block.

---

## License

Artistic 2 License. You are free to use, modify, and distribute this software under the terms of that license.
