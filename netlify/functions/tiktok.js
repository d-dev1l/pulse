// netlify/functions/tiktok.js
// TikTok scraper using tiktok82.p.rapidapi.com (datauniverse, updated daily)
//
// Required env var in Netlify dashboard:
//  
//
// Endpoint: /.netlify/functions/tiktok

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '';
const RAPIDAPI_HOST = 'tiktok82.p.rapidapi.com';

// Hashtags to pull trending videos from
const HASHTAGS = [
  'ai', 'tech', 'viral', 'trending', 'innovation',
  'lifehack', 'future', 'startup', 'mindfulness', 'science'
];

const CAT_WORDS = {
  AI:            ['ai','gpt','chatgpt','openai','llm','robot','neural','tech','automation'],
  Technology:    ['tech','app','software','code','saas','dev','digital','phone','iphone'],
  Finance:       ['crypto','bitcoin','money','invest','stock','rich','finance','trading','passive'],
  Gaming:        ['game','gaming','twitch','steam','ps5','xbox','minecraft','fortnite'],
  Entertainment: ['movie','music','netflix','funny','celebrity','dance','song','artist'],
  Food:          ['food','recipe','cook','eat','meal','diet','vegan','chef','restaurant'],
  Science:       ['science','health','sleep','research','study','space','climate','mental','brain'],
  Sports:        ['sport','nba','nfl','soccer','football','basketball','gym','fitness','workout'],
};

function detectCat(text) {
  const t = text.toLowerCase();
  let best = 'Entertainment', bestN = 0;
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    const n = words.filter(w => t.includes(w)).length;
    if (n > bestN) { bestN = n; best = cat; }
  }
  return best;
}

function calcScore(views, likes, comments, shares, ageH) {
  const eng  = views > 0 ? Math.min(30, ((likes + comments*3 + shares*5) / views) * 300) : 0;
  const vel  = Math.min(35, Math.log10(Math.max(1, views / Math.max(ageH, 1))) * 9);
  const rec  = Math.max(0, 25 - ageH * 0.5);
  const big  = Math.min(10, Math.log10(views + 1) * 2);
  return Math.round(Math.min(99, eng + vel + rec + big));
}

function satLabel(ageH, views) {
  if (ageH < 6)        return { label:'🟢 First wave', color:'#10B981', tip:'Very few posts yet — catching early' };
  if (ageH < 24)       return { label:'🟡 Growing',     color:'#F59E0B', tip:'Gaining momentum — still early' };
  if (views > 5000000) return { label:'🔴 Saturated',   color:'#EF4444', tip:'Massively viral — peaked or peaking' };
  return                      { label:'🟠 Mid-wave',    color:'#F97316', tip:'Active spread — entering mainstream' };
}

function fmt(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n||0);
}

function rapidAPI(path) {
  return fetch(`https://${RAPIDAPI_HOST}${path}`, {
    headers: {
      'x-rapidapi-key':  RAPIDAPI_KEY,
      'x-rapidapi-host': RAPIDAPI_HOST,
      'Content-Type':    'application/json',
    },
    signal: AbortSignal.timeout(12000),
  });
}

// Convert a raw tiktok82 video item → our post schema
function itemToPost(item, sourceTag) {
  // tiktok82 field names (may vary — handle both variants)
  const author  = item.author  || item.authorInfo  || {};
  const stats   = item.stats   || item.statsV2     || item.statistics || {};
  const video   = item.video   || {};
  const music   = item.music   || {};

  const handle  = author.uniqueId  || author.unique_id  || author.id || 'creator';
  const name    = author.nickname  || author.name        || handle;
  const avatar  = author.avatarThumb || author.avatar_thumb || null;

  // Views/plays
  const plays    = Number(stats.playCount   || stats.play_count   || item.playCount   || 0);
  const likes    = Number(stats.diggCount   || stats.digg_count   || item.diggCount   || 0);
  const comments = Number(stats.commentCount|| stats.comment_count|| item.commentCount || 0);
  const shares   = Number(stats.shareCount  || stats.share_count  || item.shareCount  || 0);

  const desc    = item.desc || item.description || item.title || '';
  const videoId = item.id   || item.aweme_id    || item.video_id   || '';

  // Best thumbnail
  const thumb = video.cover         ||
                video.originCover   ||
                video.dynamicCover  ||
                item.thumbnail      ||
                avatar              || null;

  const created  = Number(item.createTime || item.create_time || 0) * 1000 || Date.now();
  const ageH     = Math.max(0.1, (Date.now() - created) / 3_600_000);
  const score    = calcScore(plays, likes, comments, shares, ageH);
  const cat      = detectCat(desc + ' ' + sourceTag);

  // Hashtags from challenges array or parsed from desc
  const hashtags = (item.challenges || item.textExtra || [])
    .map(c => '#' + (c.title || c.hashtagName || ''))
    .filter(h => h.length > 1);

  // Top comments if API returned them inline
  const topComments = (item.comments || []).slice(0, 3).map(c => ({
    user:   '@' + (c.user?.uniqueId || c.author?.uniqueId || 'user'),
    text:   (c.text || c.comment || '').slice(0, 120),
    likes:  Number(c.diggCount || c.like_count || 0),
    avatar: c.user?.avatarThumb || null,
  }));

  return {
    id:             'tt-' + (videoId || Math.random().toString(36).slice(2)),
    platform:       'tiktok',
    creator_name:   name,
    creator_handle: '@' + handle,
    creator_avatar: avatar,
    caption:        desc.slice(0, 220),
    thumbnail:      thumb,
    url:            `https://www.tiktok.com/@${handle}/video/${videoId}`,
    embed_url:      videoId ? `https://www.tiktok.com/embed/v2/${videoId}` : null,
    hashtags,
    views:          plays,
    upvotes:        likes,
    likes,
    comments,
    shares,
    trend_score:    score,
    category:       cat,
    sat:            satLabel(ageH, plays),
    growth_label:   '+' + fmt(Math.round(plays / Math.max(ageH, 1))) + '/hr',
    growth_rate:    Math.round(plays / Math.max(ageH, 1)),
    is_early:       ageH < 12 && score > 50,
    posted_at:      new Date(created).toISOString(),
    age_hours:      ageH,
    top_comments:   topComments,
    music:          music.title ? `🎵 ${music.title} — ${music.authorName||''}` : null,
  };
}

// ── Fetch trending feed (explore/for-you page) ───────────────────────────────
async function fetchTrending() {
  // Try common tiktok82 trending endpoint names
  const endpoints = [
    '/trending?region=US&count=20',
    '/feed/trending?region=US&count=20',
    '/video/trending?region=US&count=20',
    '/getTrendingFeed?region=US&count=20',
    '/explore?count=20',
  ];

  for (const ep of endpoints) {
    try {
      const res = await rapidAPI(ep);
      if (!res.ok) continue;
      const json = await res.json();
      // Try to find the items array wherever it may be
      const items =
        json?.data?.videos  ||
        json?.data?.items   ||
        json?.videos        ||
        json?.items         ||
        json?.itemList      ||
        (Array.isArray(json) ? json : null);
      if (items?.length) {
        console.log('✓ Trending via', ep, '—', items.length, 'items');
        return items.map(i => itemToPost(i, 'trending'));
      }
    } catch(e) { console.warn(ep, e.message); }
  }
  return [];
}

// ── Fetch hashtag feed ───────────────────────────────────────────────────────
async function fetchHashtag(tag) {
  // Try common tiktok82 hashtag endpoint names
  const endpoints = [
    `/hashtag/videos?name=${tag}&count=10`,
    `/challenge/posts?name=${tag}&count=10`,
    `/video/hashtag?name=${tag}&count=10`,
    `/getHashtagFeed?name=${tag}&count=10`,
    `/feed/hashtag?name=${tag}&count=10`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await rapidAPI(ep);
      if (!res.ok) continue;
      const json = await res.json();
      const items =
        json?.data?.videos  ||
        json?.data?.items   ||
        json?.videos        ||
        json?.items         ||
        json?.itemList      ||
        (Array.isArray(json) ? json : null);
      if (items?.length) {
        console.log('✓ Hashtag', tag, 'via', ep, '—', items.length, 'items');
        return items.map(i => itemToPost(i, tag));
      }
    } catch(e) { /* try next */ }
  }
  return [];
}

// ── Fetch comments for a video ───────────────────────────────────────────────
async function fetchComments(videoId) {
  const endpoints = [
    `/video/comments?video_id=${videoId}&count=5`,
    `/comments?video_id=${videoId}&count=5`,
    `/getComments?video_id=${videoId}&count=5`,
  ];
  for (const ep of endpoints) {
    try {
      const res = await rapidAPI(ep);
      if (!res.ok) continue;
      const json = await res.json();
      const comments = json?.data?.comments || json?.comments || json?.items || [];
      if (comments.length) return comments.slice(0,3).map(c => ({
        user:   '@' + (c.user?.uniqueId || c.author?.uniqueId || 'user'),
        text:   (c.text || c.comment || '').slice(0, 120),
        likes:  Number(c.diggCount || c.like_count || 0),
        avatar: c.user?.avatarThumb || null,
      }));
    } catch(e) { /* try next */ }
  }
  return [];
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  if (!RAPIDAPI_KEY) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'RAPIDAPI_KEY environment variable not set.',
        setup: 'Add RAPIDAPI_KEY in Netlify → Site settings → Environment variables, then redeploy.',
        setup_url: 'https://rapidapi.com/datauniverse/api/tiktok82',
      }),
    };
  }

  const posts = [];
  let strategy = 'none';

  // 1. Try the trending/explore feed first (most valuable — real FYP data)
  try {
    const trending = await fetchTrending();
    if (trending.length > 0) {
      posts.push(...trending);
      strategy = 'trending-feed';
    }
  } catch(e) { console.warn('Trending feed error:', e.message); }

  // 2. Pull hashtag feeds in parallel (broader coverage)
  const hashtagResults = await Promise.allSettled(
    HASHTAGS.slice(0, 6).map(tag => fetchHashtag(tag))
  );
  hashtagResults.forEach(r => {
    if (r.status === 'fulfilled') posts.push(...r.value);
  });
  if (posts.length > 0 && strategy === 'none') strategy = 'hashtags';

  if (posts.length === 0) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        ok: false,
        strategy: 'none',
        error: 'tiktok82 API returned no data. Check your RAPIDAPI_KEY and that you are subscribed to tiktok82 by datauniverse.',
        setup_url: 'https://rapidapi.com/datauniverse/api/tiktok82',
      }),
    };
  }

  // Deduplicate by id + sort
  const seen = new Set();
  const deduped = posts
    .filter(p => p.views > 0 || p.likes > 0)
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => b.trend_score - a.trend_score)
    .slice(0, 30);

  // Enrich top 8 posts with real comments (parallel, best-effort)
  const commentResults = await Promise.allSettled(
    deduped.slice(0, 8)
      .filter(p => p.top_comments.length === 0) // skip if already have comments
      .map(p => {
        const videoId = p.url.split('/video/')[1];
        return videoId ? fetchComments(videoId) : Promise.resolve([]);
      })
  );
  let ci = 0;
  deduped.slice(0, 8).forEach(p => {
    if (p.top_comments.length === 0 && commentResults[ci]?.status === 'fulfilled') {
      p.top_comments = commentResults[ci].value;
      ci++;
    }
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      strategy,
      count: deduped.length,
      scraped_at: new Date().toISOString(),
      posts: deduped,
    }),
  };
};
