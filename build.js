const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // npm install node-fetch@2
const MarkdownIt = require('markdown-it');
const RSS = require('rss');
require('dotenv').config();

const md = new MarkdownIt({ html: true, linkify: true });
const config = require('./config.json');

const slugify = txt => txt.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// --- STATE ---
let githubStatus = null;
let nowPost = null;

// --- TAG MAPPING ---
const tagDisplayMap = {
    'notes': 'Notes', 'commits': 'Commits', 'bluesky': 'Bluesky',
    'video': 'Video', 'bookmark': 'Reading', 'social': 'Social'
};
if (config.github?.tag_overrides) {
    Object.assign(tagDisplayMap, config.github.tag_overrides);
}

// --- FETCHERS ---

async function fetchGitHub() {
  if (!config.github?.sources) return [];
  console.log('Fetching GitHub...');
  const allData = [];

  const query = `query($owner: String!, $name: String!) {
      viewer { status { emoji, message, indicatesLimitedAvailability } }
      repository(owner: $owner, name: $name) {
        discussions(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { title, url, createdAt, body, author { login }, category { name }, labels(first: 3) { nodes { name } }, comments { totalCount }, reactions { totalCount } } }
        issues(first: 10, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { title, url, createdAt, body, author { login }, labels(first: 3) { nodes { name } }, comments { totalCount }, reactions { totalCount } } }
        releases(first: 5, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { tagName, url, publishedAt, description, name } }
      }
    }`;

  for (const source of config.github.sources) {
    const enableDiscussions = source.discussions !== false;
    const enableIssues = source.issues === true;
    const enableReleases = source.releases !== false;

    for (const repo of source.repos) {
      try {
        const res = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { 'Authorization': `bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { owner: source.owner, name: repo } })
        });
        const json = await res.json();
        if (!json.data) continue;

        // Capture Status
        if (!githubStatus && json.data.viewer?.status) githubStatus = json.data.viewer.status;

        const { discussions, issues, releases } = json.data.repository;
        const repoSlug = slugify(repo);
        if (!tagDisplayMap[repoSlug]) tagDisplayMap[repoSlug] = repo;

        // Helper to add items
        const pushItem = (item, type, tags) => {
            // Add Group Tags
            const groups = [];
            const fullName = `${source.owner}/${repo}`;
            if (config.github.groups) {
                for (const [gName, rList] of Object.entries(config.github.groups)) {
                    if (rList.includes(fullName) || rList.includes(repo)) {
                        const gSlug = slugify(gName);
                        groups.push(gSlug);
                        if (!tagDisplayMap[gSlug]) tagDisplayMap[gSlug] = gName;
                    }
                }
            }

            allData.push({
                sourceName: source.name,
                type: type, service: 'github', owner: source.owner, repo: repo,
                date: new Date(item.createdAt || item.publishedAt),
                title: item.title || item.name || item.tagName,
                url: item.url,
                body: item.body || item.description || "",
                tags: [...new Set([...tags, ...groups])],
                metrics: { comments: item.comments?.totalCount || 0, reactions: item.reactions?.totalCount || 0 }
            });
        };

        if (enableDiscussions && discussions) {
            discussions.nodes.forEach(d => {
                if (d.category.name.toLowerCase() === 'now') {
                    const date = new Date(d.createdAt);
                    if (!nowPost || date > nowPost.date) nowPost = { body: d.body, date: date, url: d.url };
                    return;
                }
                if (d.category.name.toLowerCase() === 'drafts') return;
                const isNote = d.category.name.toLowerCase() === 'notes';
                const tags = [repoSlug];
                d.labels.nodes.forEach(l => tags.push(slugify(l.name).substring(0,3)));
                pushItem(d, isNote ? 'note' : 'article', tags);
            });
        }

        if (enableIssues && issues) {
            issues.nodes.forEach(i => {
                const tags = [repoSlug, 'issue'];
                i.labels.nodes.forEach(l => tags.push(slugify(l.name).substring(0,3)));
                pushItem(i, 'article', tags);
            });
        }

        if (enableReleases && releases) {
            releases.nodes.forEach(r => pushItem(r, 'release', ['commits', repoSlug]));
        }
      } catch (e) { console.error(`GH Error ${repo}:`, e.message); }
    }
  }
  return allData;
}

async function fetchBluesky() {
  if (!config.bluesky?.sources) return [];
  console.log('Fetching Bluesky...');
  const allData = [];
  for (const source of config.bluesky.sources) {
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${source.handle}&filter=posts_no_replies&limit=20`);
      const json = await res.json();
      if (!json.feed) continue;
      json.feed.forEach(item => {
        const post = item.post;
        let imageUrl = post.embed?.images?.[0]?.fullsize || null;
        allData.push({
          sourceName: source.name,
          type: 'note', service: 'bluesky',
          date: new Date(post.record.createdAt),
          body: post.record.text,
          url: `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`,
          image: imageUrl,
          tags: ['notes'],
          metrics: { replies: post.replyCount, reposts: post.repostCount, likes: post.likeCount }
        });
      });
    } catch (e) { console.error(`Bluesky Error ${source.handle}:`, e.message); }
  }
  return allData;
}

async function fetchMastodon() {
    if (!config.mastodon?.sources) return [];
    console.log('Fetching Mastodon...');
    const allData = [];
    for (const source of config.mastodon.sources) {
        try {
            const res = await fetch(`https://${source.instance}/api/v1/accounts/${source.id}/statuses?exclude_replies=true&limit=20`);
            const json = await res.json();
            if (!Array.isArray(json)) continue;
            json.forEach(post => {
                let imageUrl = post.media_attachments?.[0]?.url || null;
                allData.push({
                    sourceName: source.name,
                    type: 'note', service: 'mastodon',
                    date: new Date(post.created_at),
                    body: post.content.replace(/<[^>]*>?/gm, ''), // Strip HTML
                    url: post.url,
                    image: imageUrl,
                    tags: ['notes'],
                    metrics: { replies: post.replies_count, reposts: post.reblogs_count, likes: post.favourites_count }
                });
            });
        } catch (e) { console.error(`Mastodon Error:`, e.message); }
    }
    return allData;
}

async function fetchLemmy() {
    if (!config.lemmy?.sources) return [];
    console.log('Fetching Lemmy...');
    const allData = [];
    for (const source of config.lemmy.sources) {
        try {
            const res = await fetch(`https://${source.instance}/api/v3/user?username=${source.username}&limit=10`);
            const json = await res.json();
            if (json.person_view && json.person_view.posts) {
                json.person_view.posts.forEach(p => {
                    allData.push({
                        sourceName: source.name,
                        type: 'note', service: 'lemmy',
                        date: new Date(p.post.published),
                        body: p.post.body || p.post.name,
                        url: p.post.ap_id,
                        tags: ['social'],
                        metrics: { likes: p.counts.score, replies: p.counts.comments }
                    });
                });
            }
        } catch (e) { console.error('Lemmy Error:', e.message); }
    }
    return allData;
}

async function fetchRaindrop() {
    // Requires RAINDROP_TOKEN in .env
    if (!config.raindrop?.collection_id || !process.env.RAINDROP_TOKEN) return [];
    console.log('Fetching Raindrop...');
    try {
        const res = await fetch(`https://api.raindrop.io/rest/v1/raindrops/${config.raindrop.collection_id}`, {
            headers: { 'Authorization': `Bearer ${process.env.RAINDROP_TOKEN}` }
        });
        const json = await res.json();
        if (!json.items) return [];
        return json.items.map(item => ({
            sourceName: config.raindrop.name || 'bookmarks',
            type: 'bookmark', service: 'raindrop',
            date: new Date(item.created),
            title: item.title, url: item.link,
            body: item.note || "",
            tags: ['bookmark', ...item.tags]
        }));
    } catch (e) {
        console.error('Raindrop Error:', e.message);
        return [];
    }
}

async function fetchYouTube() {
  if (!config.youtube?.sources) return [];
  console.log('Fetching YouTube...');
  const allData = [];
  for (const source of config.youtube.sources) {
      try {
          const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${source.channel_id}`);
          const text = await res.text();
          const entries = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];
          entries.forEach(entry => {
              const title = entry.match(/<title>(.*?)<\/title>/)[1];
              const url = entry.match(/<link rel="alternate" href="(.*?)"/)[1];
              const date = entry.match(/<published>(.*?)<\/published>/)[1];
              const thumb = entry.match(/<media:thumbnail url="(.*?)"/)?.[1];

              allData.push({
                  sourceName: source.name,
                  type: 'video', service: 'youtube',
                  date: new Date(date), title: title, url: url, body: "", image: thumb,
                  tags: ['video']
              });
          });
      } catch (e) { console.error('YT Error:', e.message); }
  }
  return allData;
}

async function fetchGitLab() {
    if (!config.gitlab?.sources) return [];
    console.log('Fetching GitLab...');
    const allData = [];
    for (const source of config.gitlab.sources) {
        try {
            // Fetches releases for a specific project ID
            // Requires GITLAB_TOKEN if private, public otherwise
            const headers = process.env.GITLAB_TOKEN ? { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN } : {};
            const res = await fetch(`https://${config.gitlab.instance || 'gitlab.com'}/api/v4/projects/${source.id}/releases`, { headers });
            const json = await res.json();
            if(!Array.isArray(json)) continue;

            json.forEach(r => {
                allData.push({
                    sourceName: source.name,
                    type: 'release', service: 'gitlab',
                    owner: 'gitlab', repo: source.id, // Use ID as repo identifier
                    date: new Date(r.released_at),
                    title: r.name,
                    version: r.tag_name,
                    url: r._links.self,
                    body: r.description || "",
                    tags: ['commits']
                });
            });
        } catch (e) { console.error('GitLab Error:', e.message); }
    }
    return allData;
}

async function fetchGitea() {
    if (!config.gitea?.sources) return [];
    console.log('Fetching Gitea...');
    const allData = [];
    for (const source of config.gitea.sources) {
        try {
            const res = await fetch(`https://${config.gitea.instance}/api/v1/repos/${source.owner}/${source.repo}/releases?limit=5`);
            const json = await res.json();
            if(!Array.isArray(json)) continue;
            json.forEach(r => {
                allData.push({
                    sourceName: source.name,
                    type: 'release', service: 'gitea',
                    owner: source.owner, repo: source.repo,
                    date: new Date(r.published_at),
                    version: r.tag_name,
                    url: r.html_url,
                    body: r.body || "",
                    tags: ['commits', slugify(source.repo)]
                });
            });
        } catch (e) { console.error('Gitea Error:', e.message); }
    }
    return allData;
}

async function fetchBitbucket() {
    if (!config.bitbucket?.sources) return [];
    console.log('Fetching Bitbucket...');
    const allData = [];
    for (const source of config.bitbucket.sources) {
        try {
            // Uses simple tag fetching
            const res = await fetch(`https://api.bitbucket.org/2.0/repositories/${source.workspace}/${source.repo_slug}/refs/tags?sort=-target.date`);
            const json = await res.json();
            if(!json.values) continue;

            json.values.slice(0, 5).forEach(tag => {
                allData.push({
                    sourceName: source.name,
                    type: 'release', service: 'bitbucket',
                    owner: source.workspace, repo: source.repo_slug,
                    date: new Date(tag.target.date),
                    version: tag.name,
                    url: tag.links.html.href,
                    body: tag.message || "Tag release",
                    tags: ['commits', slugify(source.repo_slug)]
                });
            });
        } catch (e) { console.error('Bitbucket Error:', e.message); }
    }
    return allData;
}

// --- RENDERERS ---

function renderContent(item) {
  const dateStr = item.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const tagClasses = item.tags.map(t => `tag-${t}`).join(' ');

  // VIDEO
  if (item.type === 'video') {
      return `<article class="entry ${tagClasses}"><div class="note-media"><a href="${item.url}"><img src="${item.image}" alt="${item.title}"></a></div><div class="note-meta"><time>${dateStr}</time><span>&middot;</span><a href="${item.url}" class="note-link">YouTube ↗</a></div></article>`;
  }

  // BOOKMARK
  if (item.type === 'bookmark') {
      return `<article class="entry ${tagClasses}"><div class="entry-row"><a href="${item.url}" class="entry-title">🔖 ${item.title}</a><span class="dots"></span><time class="entry-date">${dateStr}</time></div><span class="entry-summary">${item.body || "Saved to Raindrop.io"}</span></article>`;
  }

  // NOTE
  if (item.type === 'note') {
    const content = md.render(item.body);
    // Determine label based on service
    let sourceLabel = 'Note';
    if (item.service === 'bluesky') sourceLabel = 'Bluesky';
    if (item.service === 'mastodon') sourceLabel = 'Mastodon';
    if (item.service === 'lemmy') sourceLabel = 'Lemmy';

    return `
      <article class="entry ${tagClasses}">
          <div class="note-text">${content}</div>
          ${item.image ? `<div class="note-media"><img src="${item.image}" loading="lazy" alt="Attachment"></div>` : ''}
          <div class="note-meta">
              <time>${dateStr}</time>
              <span>&middot;</span>
              ${item.metrics?.replies > 0 ? `<a href="${item.url}" class="meta-stat" title="${item.metrics.replies} Replies"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke-linecap="round" stroke-linejoin="round"></path></svg> ${item.metrics.replies}</a>` : ''}
              ${item.metrics?.reposts > 0 ? `<a href="${item.url}" class="meta-stat" title="${item.metrics.reposts} Reposts"><svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" stroke-linecap="round" stroke-linejoin="round"></path></svg> ${item.metrics.reposts}</a>` : ''}
              ${item.metrics?.likes > 0 ? `<a href="${item.url}" class="meta-stat" title="${item.metrics.likes} Likes"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke-linecap="round" stroke-linejoin="round"></path></svg> ${item.metrics.likes}</a>` : ''}
              <span>&middot;</span>
              <a href="${item.url}" class="note-link">${sourceLabel} ↗</a>
          </div>
      </article>`;
  }

  // RELEASE
  if (item.type === 'release') {
    return `<article class="entry ${tagClasses}"><div class="entry-row"><span><a href="${item.url}" class="rel-repo">${item.owner}/${item.repo}</a><span class="rel-version">${item.version}</span></span><span class="dots"></span><time class="entry-date">${dateStr}</time></div><code class="rel-msg">${item.body.split('\n')[0]}</code></article>`;
  }

  // ARTICLE
  const rawBody = item.body.split('\n').filter(line => line.length > 0 && !line.startsWith('#'))[0] || "";
  const summary = md.render(rawBody).replace(/<[^>]*>?/gm, '');
  return `<article class="entry ${tagClasses}"><div class="entry-row"><a href="${item.url}" class="entry-title">${item.title}</a><span class="dots"></span><div class="meta-group">${item.metrics?.comments > 0 ? `<a href="${item.url}#comments" class="meta-stat" title="${item.metrics.comments} Comments"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke-linecap="round" stroke-linejoin="round"></path></svg>${item.metrics.comments}</a>` : ''}${item.metrics?.reactions > 0 ? `<a href="${item.url}" class="meta-stat" title="${item.metrics.reactions} Reactions"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke-linecap="round" stroke-linejoin="round"></path></svg>${item.metrics.reactions}</a>` : ''}<time class="entry-date">${dateStr}</time></div></div><span class="entry-summary">${summary}</span></article>`;
}

// --- CORE GENERATORS (Reuse existing logic) ---
// (Included in abbreviated form below for completeness)

function generateHead() {
    const p = config.profile;
    const a = config.analytics || {};
    let head = `<title>${p.name}</title><meta name="description" content="${p.tagline}">`;
    // ... (SEO meta tags) ...
    if (config.feeds) {
        Object.keys(config.feeds).forEach(filename => {
            const f = config.feeds[filename];
            const mime = f.type === 'atom' ? 'application/atom+xml' : 'application/rss+xml';
            head += `<link rel="alternate" type="${mime}" title="${filename}" href="/${filename}" />`;
        });
    }
    if (a.plausible?.enabled) head += `<script defer data-domain="${a.plausible.domain}" src="${a.plausible.src}"></script>`;
    if (a.cloudflare?.enabled) head += `<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${a.cloudflare.token}"}'></script>`;
    return head;
}

function generateDynamicStyles(uniqueTags) {
  let css = '';
  uniqueTags.forEach(tag => {
    const id = `f-${tag}`; const cls = `tag-${tag}`;
    css += `body:has(#${id}:checked) label[for="${id}"] { color: var(--c-text); font-weight: 800; }\n`;
    css += `body:has(#${id}:checked) label[for="${id}"]::before, body:has(#${id}:checked) label[for="${id}"]::after { opacity: 1; }\n`;
    css += `body:has(#${id}:checked) .entry.${cls} { opacity: 1; filter: none; }\n`;
  });
  return css;
}

function generateFilterHTML(uniqueTags) {
  // ... Same logic as previous: sort by type, repo, topic ...
  const types = ['notes', 'commits', 'video', 'bookmark'];
  // ... (filtering and sorting logic) ...
  return uniqueTags.map(t => `<label for="f-${t}" class="filter-tag">${tagDisplayMap[t] || t}</label>`).join('');
}

function generateFeeds(allContent) {
    if (!config.feeds) return;
    const p = config.profile;
    Object.entries(config.feeds).forEach(([filename, settings]) => {
        const feedItems = allContent.filter(item => {
            if (settings.sources.includes('*')) return true;
            return settings.sources.includes(item.sourceName);
        }).slice(0, 20);

        const feed = new RSS({ title: settings.title || p.name, description: p.tagline, feed_url: `${p.url}/${filename}`, site_url: p.url, author: p.name });
        feedItems.forEach(item => {
            feed.item({ title: item.title || 'Note', description: item.body, url: item.url, date: item.date, guid: item.url });
        });

        const dir = path.dirname(filename);
        if (!fs.existsSync(dir)){ fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(filename, feed.xml({indent: true}));
        console.log(`Generated ${filename}`);
    });
}

function renderStatus() {
    if (!githubStatus) return '';
    const busyClass = githubStatus.indicatesLimitedAvailability ? 'status-busy' : '';
    return `<div class="gh-status ${busyClass}"><span class="status-emoji">${githubStatus.emoji || '💭'}</span><span class="status-text">${githubStatus.message}</span></div>`;
}

function renderNow() {
    if (!nowPost) return '';
    const content = md.render(nowPost.body);
    return `<section class="now-section"><div class="now-label">NOW</div><div class="now-content">${content}</div><div class="now-meta">Updated ${nowPost.date.toLocaleDateString()}</div></section>`;
}

// --- MAIN ---

async function build() {
  const results = await Promise.allSettled([
      fetchGitHub(), fetchBluesky(), fetchMastodon(), fetchLemmy(), fetchYouTube(), fetchRaindrop(), fetchGitLab(), fetchGitea(), fetchBitbucket()
  ]);

  // Flatten results from settled promises
  const allContent = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => b.date - a.date);

  console.log(`Total items: ${allContent.length}`);

  const uniqueTags = new Set();
  allContent.forEach(item => item.tags.forEach(t => uniqueTags.add(t)));
  const sortedTags = Array.from(uniqueTags);

  const dynamicCSS = generateDynamicStyles(sortedTags);
  const filterHTML = generateFilterHTML(sortedTags);
  const inputsHTML = sortedTags.map(t => `<input type="checkbox" class="filter-check" id="f-${t}">`).join('');
  const headHTML = generateHead();
  const statusHTML = renderStatus();
  const nowHTML = renderNow();

  const byYear = {};
  allContent.forEach(item => {
    const year = item.date.getFullYear();
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(item);
  });

  let contentHTML = '';
  Object.keys(byYear).sort((a, b) => b - a).forEach(year => {
    contentHTML += `<section class="year-block"><h2 class="year-title">${year}</h2>`;
    byYear[year].forEach(item => contentHTML += renderContent(item));
    contentHTML += `</section>`;
  });

  let socialsHTML = '';
  if (config.profile.socials) socialsHTML = config.profile.socials.map(s => `<a href="${s.url}">${s.name}</a>`).join('\n');
  const yearRange = `${config.profile.copyright_start}–${new Date().getFullYear()}`;

  const template = fs.readFileSync('index.template.html', 'utf8');
  let finalHTML = template
    .replace('<!-- INJECT_HEAD -->', headHTML)
    .replace(/<!-- CONFIG_NAME -->/g, config.profile.name)
    .replace(/<!-- CONFIG_TAGLINE -->/g, config.profile.tagline)
    .replace(/<!-- CONFIG_YEAR_RANGE -->/g, yearRange)
    .replace('<!-- INJECT_SOCIALS -->', socialsHTML)
    .replace('<!-- INJECT_CSS -->', dynamicCSS)
    .replace('<!-- INJECT_FILTERS -->', inputsHTML)
    .replace('<!-- INJECT_FILTER_LIST -->', filterHTML)
    .replace('<!-- INJECT_STATUS -->', statusHTML)
    .replace('<!-- INJECT_NOW -->', nowHTML)
    .replace('<!-- INJECT_CONTENT -->', contentHTML);

  fs.writeFileSync('index.html', finalHTML);
  generateFeeds(allContent);
  console.log("Build complete.");
}

build();
