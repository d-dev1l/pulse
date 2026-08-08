const KEY  = process.env.RAPIDAPI_KEY || '';
const HOST = 'tiktok82.p.rapidapi.com';

const KEYWORDS = ['ai technology','viral trend','life hack','future tech','startup'];
const HASHTAGS = ['ai','viral','tech','trending','lifehack'];

const CAT_WORDS = {
  AI:['ai','gpt','chatgpt','openai','llm','robot','neural','automation'],
  Technology:['tech','app','software','code','saas','dev','digital','phone'],
  Finance:['crypto','bitcoin','money','invest','stock','finance','trading'],
  Gaming:['game','gaming','twitch','steam','ps5','xbox','minecraft'],
  Entertainment:['movie','music','netflix','funny','celebrity','dance','song'],
  Food:['food','recipe','cook','eat','meal','diet','vegan','chef'],
  Science:['science','health','sleep','research','study','space','climate','brain'],
  Sports:['sport','nba','nfl','soccer','football','basketball','gym','fitness'],
};

function detectCat(text) {
  const t = (text||'').toLowerCase();
  let best = 'Entertainment', bestN = 0;
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    const n = words.filter(w => t.includes(w)).length;
    if (n > bestN) { bestN = n; best = cat; }
  }
  return best;
}

function calcScore(views, likes, comments, shares, ageH) {
  const eng = views > 0 ? Math.min(30, ((likes + comments*3 + shares*5) / views) * 300) : 0;
  const vel = Math.min(35, Math.log10(Math.max(1, views / Math.max(ageH, 1))) * 9);
  const rec = Math.max(0, 25 - ageH * 0.5);
  const big = Math.min(10, Math.log10(views + 1) * 2);
  return Math.round(Math.min(99, eng + vel + rec + big));
}

function satLabel(ageH, views) {
  if (ageH < 6)        return { label:'🟢 First wave', color:'#10B981', tip:'Very few posts yet — catching early' };
  if (ageH < 24)       return { label:'🟡 Growing',     color:'#F59E0B', tip:'Gaining momentum — still early' };
  if (views > 5000000) return { label:'🔴 Saturated',   color:'#EF4444', tip:'Massively viral — peaked or peaking' };
  return                      { label:'🟠 Mid-wave',    color:'#F97316', tip:'Active spread — entering mainstream' };
}

const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n||0);

const catThumb = cat => ({
  AI:'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=500&q=75',
  Technology:'https://images.unsplash.com/photo-1518770660439-4636190af475?w=500&q=75',
  Finance:'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=500&q=75',
  Gaming:'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=500&q=75',
  Food:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500&q=75',
  Science:'https://images.unsplash.com/photo-1532094349884-543559c98d1c?w=500&q=75',
  Entertainment:'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&q=75',
  Sports:'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=500&q=75',
}[cat] || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&q=75');

function call(path) {
  return fetch(`https://${HOST}${path}`, {
    headers: { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
}

function toPost(item, tag) {
  const author  = item.author || {};
  const handle  = author.unique_id || author.uniqueId || 'creator';
  const name    = author.nickname || handle;
  const avatar  = author.avatar || author.avatarThumb || null;
  const plays   = Number(item.play_count   || item.playCount   || 0);
  const likes   = Number(item.collect_count || item.diggCount  || item.like_count || 0);
  const cmts    = Number(item.comment_count || item.commentCount || 0);
  const shares  = Number(item.share_count  || item.shareCount  || 0);
  const desc    = item.title || item.desc || item.description || '';
  const vid     = item.video_id || item.id || item.aweme_id || '';
  const thumb   = item.cover || item.ai_dynamic_cover || item.origin_cover ||
                  (item.video && (item.video.cover || item.video.originCover)) ||
                  catThumb(detectCat(desc));
  const created = Number(item.create_time || item.createTime || 0) * 1000 || Date.now();
  const ageH    = Math.max(0.1, (Date.now() - created) / 3600000);
  const cat     = detectCat(desc + ' ' + tag);
  return {
    id: 'tt-' + (vid || Math.random().toString(36).slice(2)),
    platform: 'tiktok',
    creator_name: name,
    creator_handle: '@' + handle,
    creator_avatar: avatar,
    caption: desc.slice(0, 220),
    thumbnail: thumb,
    url: `https://www.tiktok.com/@${handle}/video/${vid}`,
    views: plays, upvotes: likes, likes, comments: cmts, shares,
    trend_score: calcScore(plays, likes, cmts, shares, ageH),
    category: cat, sat: satLabel(ageH, plays),
    growth_label: '+' + fmt(Math.round(plays / Math.max(ageH, 1))) + '/hr',
    growth_rate: Math.round(plays / Math.max(ageH, 1)),
    is_early: ageH < 12,
    posted_at: new Date(created).toISOString(),
    age_hours: ageH, top_comments: [],
  };
}

async function fetchKeyword(keyword) {
  try {
    const res = await call(`/getVideosByKeyword?keyword=${encodeURIComponent(keyword)}&count=10&cursor=0`);
    if (!res.ok) return [];
    const json = await res.json();
    const items = json?.data?.videos || json?.data?.items || json?.videos || json?.items || [];
    return Array.isArray(items) ? items.map(i => toPost(i, keyword)) : [];
  } catch(e) { return []; }
}

async function fetchHashtag(tag) {
  try {
    const res = await call(`/getChallengeVideos?challengeName=${encodeURIComponent(tag)}&count=10&cursor=0`);
    if (!res.ok) return [];
    const json = await res.json();
    const items = json?.data?.videos || json?.data?.items || json?.videos || json?.items || [];
    return Array.isArray(items) ? items.map(i => toPost(i, tag)) : [];
  } catch(e) { return []; }
}

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  if (!KEY) return { statusCode:503, headers, body:JSON.stringify({ ok:false, error:'RAPIDAPI_KEY not set.' }) };

  const posts = [];
  const results = await Promise.allSettled([
    ...KEYWORDS.map(kw => fetchKeyword(kw)),
    ...HASHTAGS.slice(0,3).map(tag => fetchHashtag(tag)),
  ]);
  results.forEach(r => { if (r.status === 'fulfilled') posts.push(...r.value); });

  const seen = new Set();
  const deduped = posts
    .filter(p => p && (p.views > 0 || p.likes > 0))
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => b.trend_score - a.trend_score)
    .slice(0, 30);

  if (!deduped.length) {
    return { statusCode:503, headers, body:JSON.stringify({ ok:false, error:'No TikTok videos returned.' }) };
  }

  return { statusCode:200, headers, body:JSON.stringify({ ok:true, count:deduped.length, scraped_at:new Date().toISOString(), posts:deduped }) };
};
