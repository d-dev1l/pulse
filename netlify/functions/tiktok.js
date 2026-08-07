const KEY  = process.env.RAPIDAPI_KEY || '';
const HOST = 'tiktok82.p.rapidapi.com';

const HASHTAGS = ['ai','tech','viral','trending','innovation','lifehack','future','startup','mindfulness','science'];

const CAT_WORDS = {
  AI:['ai','gpt','chatgpt','openai','llm','robot','neural','tech'],
  Technology:['tech','app','software','code','saas','dev','digital','phone'],
  Finance:['crypto','bitcoin','money','invest','stock','finance','trading'],
  Gaming:['game','gaming','twitch','steam','ps5','xbox','minecraft'],
  Entertainment:['movie','music','netflix','funny','celebrity','dance','song'],
  Food:['food','recipe','cook','eat','meal','diet','vegan','chef'],
  Science:['science','health','sleep','research','study','space','climate','brain'],
  Sports:['sport','nba','nfl','soccer','football','basketball','gym','fitness'],
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

function call(path) {
  return fetch(`https://${HOST}${path}`, {
    headers: { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
}

function toPost(item, tag) {
  const author  = item.author  || item.authorInfo  || {};
  const stats   = item.stats   || item.statsV2     || item.statistics || {};
  const video   = item.video   || {};
  const handle  = author.uniqueId || author.unique_id || author.id || 'creator';
  const name    = author.nickname || author.name || handle;
  const avatar  = author.avatarThumb || author.avatar_thumb || null;
  const plays   = Number(stats.playCount   || stats.play_count   || item.playCount   || 0);
  const likes   = Number(stats.diggCount   || stats.digg_count   || item.diggCount   || 0);
  const cmts    = Number(stats.commentCount|| stats.comment_count|| item.commentCount || 0);
  const shares  = Number(stats.shareCount  || stats.share_count  || item.shareCount  || 0);
  const desc    = item.desc || item.description || item.title || '';
  const videoId = item.id   || item.aweme_id    || item.video_id  || '';
  const thumb   = video.cover || video.originCover || video.dynamicCover || item.thumbnail || avatar || null;
  const created = Number(item.createTime || item.create_time || 0) * 1000 || Date.now();
  const ageH    = Math.max(0.1, (Date.now() - created) / 3600000);
  const score   = calcScore(plays, likes, cmts, shares, ageH);
  const cat     = detectCat(desc + ' ' + tag);
  const hashtags = (item.challenges || item.textExtra || [])
    .map(c => '#' + (c.title || c.hashtagName || '')).filter(h => h.length > 1);
  const topComments = (item.comments || []).slice(0, 3).map(c => ({
    user: '@' + (c.user?.uniqueId || c.author?.uniqueId || 'user'),
    text: (c.text || c.comment || '').slice(0, 120),
    likes: Number(c.diggCount || c.like_count || 0),
    avatar: c.user?.avatarThumb || null,
  }));
  return {
    id: 'tt-' + (videoId || Math.random().toString(36).slice(2)),
    platform: 'tiktok', creator_name: name, creator_handle: '@' + handle,
    creator_avatar: avatar, caption: desc.slice(0, 220), thumbnail: thumb,
    url: `https://www.tiktok.com/@${handle}/video/${videoId}`,
    hashtags, views: plays, upvotes: likes, likes, comments: cmts, shares,
    trend_score: score, category: cat, sat: satLabel(ageH, plays),
    growth_label: '+' + fmt(Math.round(plays / Math.max(ageH, 1))) + '/hr',
    growth_rate: Math.round(plays / Math.max(ageH, 1)),
    is_early: ageH < 12 && score > 50,
    posted_at: new Date(created).toISOString(), age_hours: ageH, top_comments: topComments,
  };
}

async function fetchTrending() {
  for (const ep of ['/trending?region=US&count=20','/feed/trending?region=US&count=20','/getTrendingFeed?region=US&count=20']) {
    try {
      const res = await call(ep); if (!res.ok) continue;
      const json = await res.json();
      const items = json?.data?.videos || json?.data?.items || json?.videos || json?.items || json?.itemList || (Array.isArray(json)?json:null);
      if (items?.length) return items.map(i => toPost(i, 'trending'));
    } catch {}
  }
  return [];
}

async function fetchHashtag(tag) {
  for (const ep of [`/hashtag/videos?name=${tag}&count=10`,`/challenge/posts?name=${tag}&count=10`,`/video/hashtag?name=${tag}&count=10`]) {
    try {
      const res = await call(ep); if (!res.ok) continue;
      const json = await res.json();
      const items = json?.data?.videos || json?.data?.items || json?.videos || json?.items || json?.itemList || (Array.isArray(json)?json:null);
      if (items?.length) return items.map(i => toPost(i, tag));
    } catch {}
  }
  return [];
}

exports.handler = async () => {
  const headers = { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json', 'Cache-Control':'public, max-age=300' };

  if (!KEY) {
    return { statusCode:503, headers, body:JSON.stringify({ ok:false, error:'RAPIDAPI_KEY not set in environment variables.' }) };
  }

  const posts = [];
  const trending = await fetchTrending();
  posts.push(...trending);

  const hashtagResults = await Promise.allSettled(HASHTAGS.slice(0,6).map(tag => fetchHashtag(tag)));
  hashtagResults.forEach(r => { if (r.status==='fulfilled') posts.push(...r.value); });

  const seen = new Set();
  const deduped = posts
    .filter(p => p.views > 0 || p.likes > 0)
    .filter(p => { if(seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a,b) => b.trend_score - a.trend_score)
    .slice(0, 30);

  if (deduped.length === 0) {
    return { statusCode:503, headers, body:JSON.stringify({ ok:false, error:'No TikTok data returned. Check RAPIDAPI_KEY and tiktok82 subscription.' }) };
  }

  return { statusCode:200, headers, body:JSON.stringify({ ok:true, count:deduped.length, scraped_at:new Date().toISOString(), posts:deduped }) };
};
