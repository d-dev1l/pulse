// Hacker News + HN Algolia API — no auth, no blocking, works from any server
// Replaces Reddit which blocks cloud provider IPs

const CAT_WORDS = {
  AI:['ai','gpt','llm','openai','claude','neural','robot','chatbot','machine learning','deep learning','gemini','anthropic'],
  Technology:['tech','software','app','code','web','dev','saas','startup','digital','programming','github','api','launch'],
  Finance:['crypto','bitcoin','stock','invest','money','finance','trading','vc','funding','revenue','profit'],
  Gaming:['game','gaming','steam','ps5','xbox','nintendo','indie','esport'],
  Entertainment:['movie','music','netflix','film','celebrity','viral','streaming','spotify'],
  Food:['food','recipe','cook','eat','meal','diet','vegan','restaurant'],
  Science:['science','research','space','nasa','biology','climate','health','sleep','brain','study','paper'],
  Sports:['sport','nba','nfl','soccer','football','basketball','athlete'],
};

function detectCat(text) {
  const t = text.toLowerCase();
  let best = 'Technology', bestN = 0;
  for (const [cat, words] of Object.entries(CAT_WORDS)) {
    const n = words.filter(w => t.includes(w)).length;
    if (n > bestN) { bestN = n; best = cat; }
  }
  return best;
}

function calcScore(points, comments, ageH) {
  const vel = Math.min(35, Math.log10(Math.max(1, points / Math.max(ageH, 0.5))) * 14);
  const rec = Math.max(0, 32 - ageH * 0.7);
  const eng = Math.min(20, Math.log10(comments + 1) * 9);
  const big = Math.min(10, Math.log10(points + 1) * 3);
  return Math.round(Math.min(99, vel + rec + eng + big));
}

function satLabel(ageH, comments) {
  if (ageH < 3)          return { label:'🟢 First wave',  color:'#10B981', tip:'Very few posts yet — catching early' };
  if (ageH < 12)         return { label:'🟡 Growing',      color:'#F59E0B', tip:'Gaining momentum — still early' };
  if (comments > 300)    return { label:'🔴 Saturated',    color:'#EF4444', tip:'High volume — trending everywhere' };
  return                        { label:'🟠 Mid-wave',     color:'#F97316', tip:'Active spread — entering mainstream' };
}

function fmt(n) {
  return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'K':String(n||0);
}

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

async function fetchHNTop() {
  // HN top stories — completely open, no auth, no blocking
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error('HN top stories failed: ' + res.status);
  const ids = await res.json();
  return ids.slice(0, 60); // top 60 stories
}

async function fetchHNItem(id) {
  const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchAlgoliaFront() {
  // HN Algolia search — great for recent trending items
  const res = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30', {
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.hits || [];
}

async function fetchAlgoliaSearch(query) {
  const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10&numericFilters=created_at_i>${Math.floor(Date.now()/1000)-86400}`, {
    signal: AbortSignal.timeout(6000)
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.hits || [];
}

function algoliaToPost(hit) {
  const ageH = Math.max(0.1, (Date.now() - (hit.created_at_i || 0) * 1000) / 3600000);
  const points = hit.points || 0;
  const comments = hit.num_comments || 0;
  const cat = detectCat((hit.title || '') + ' ' + (hit.url || '') + ' ' + (hit.story_text || ''));
  const score = calcScore(points, comments, ageH);

  return {
    id: 'hn-' + hit.objectID,
    platform: 'reddit', // displayed as "HN" via subreddit field
    creator_name: hit.author || 'hn_user',
    creator_handle: hit.author || 'hn_user',
    creator_avatar: null,
    caption: hit.title || '',
    thumbnail: catThumb(cat),
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    subreddit: 'HackerNews',
    flair: hit.url ? new URL(hit.url).hostname.replace('www.','') : 'hn',
    views: points * 25,
    upvotes: points,
    likes: points,
    comments,
    shares: Math.round(points * 0.08),
    upvote_ratio: 0.85,
    trend_score: score,
    category: cat,
    sat: satLabel(ageH, comments),
    growth_label: '+' + fmt(Math.round(points / Math.max(ageH, 0.5))) + '/hr',
    growth_rate: Math.round(points / Math.max(ageH, 0.5)),
    is_early: ageH < 6 && score > 55,
    posted_at: new Date((hit.created_at_i || 0) * 1000).toISOString(),
    age_hours: ageH,
    top_comments: [],
  };
}

async function fetchHNItemFull(id) {
  const item = await fetchHNItem(id);
  if (!item || item.type !== 'story' || !item.score || item.score < 50) return null;
  const ageH = Math.max(0.1, (Date.now() - (item.time || 0) * 1000) / 3600000);
  const cat = detectCat((item.title || '') + ' ' + (item.url || ''));
  const score = calcScore(item.score, item.descendants || 0, ageH);

  // Get top comments
  const topComments = [];
  if (item.kids?.length > 0) {
    const commentIds = item.kids.slice(0, 3);
    const comments = await Promise.allSettled(commentIds.map(cid => fetchHNItem(cid)));
    comments.forEach(r => {
      if (r.status === 'fulfilled' && r.value?.text && r.value?.by) {
        topComments.push({
          user: r.value.by,
          text: r.value.text.replace(/<[^>]+>/g, '').slice(0, 120),
          likes: 0,
          avatar: null,
        });
      }
    });
  }

  return {
    id: 'hn-' + item.id,
    platform: 'reddit',
    creator_name: item.by || 'hn_user',
    creator_handle: item.by || 'hn_user',
    creator_avatar: null,
    caption: item.title || '',
    thumbnail: catThumb(cat),
    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
    subreddit: 'HackerNews',
    flair: item.url ? (() => { try { return new URL(item.url).hostname.replace('www.',''); } catch { return 'hn'; } })() : 'hn',
    views: (item.score || 0) * 25,
    upvotes: item.score || 0,
    likes: item.score || 0,
    comments: item.descendants || 0,
    shares: Math.round((item.score || 0) * 0.08),
    trend_score: score,
    category: cat,
    sat: satLabel(ageH, item.descendants || 0),
    growth_label: '+' + fmt(Math.round((item.score || 0) / Math.max(ageH, 0.5))) + '/hr',
    growth_rate: Math.round((item.score || 0) / Math.max(ageH, 0.5)),
    is_early: ageH < 6 && score > 55,
    posted_at: new Date((item.time || 0) * 1000).toISOString(),
    age_hours: ageH,
    top_comments: topComments,
  };
}

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    // Fetch from multiple HN sources in parallel
    const [topIds, algoliaFront, algoliaAI, algoliaStartup] = await Promise.allSettled([
      fetchHNTop(),
      fetchAlgoliaFront(),
      fetchAlgoliaSearch('AI machine learning'),
      fetchAlgoliaSearch('startup launch product'),
    ]);

    const posts = [];

    // Process Algolia front page (fastest, most data)
    if (algoliaFront.status === 'fulfilled') {
      algoliaFront.value.forEach(hit => {
        if (hit.points > 30) posts.push(algoliaToPost(hit));
      });
    }

    // Process Algolia searches
    [algoliaAI, algoliaStartup].forEach(r => {
      if (r.status === 'fulfilled') {
        r.value.forEach(hit => { if (hit.points > 20) posts.push(algoliaToPost(hit)); });
      }
    });

    // Fetch top HN items with full data + comments (top 15 only to stay fast)
    if (topIds.status === 'fulfilled') {
      const itemResults = await Promise.allSettled(
        topIds.value.slice(0, 20).map(id => fetchHNItemFull(id))
      );
      itemResults.forEach(r => {
        if (r.status === 'fulfilled' && r.value) posts.push(r.value);
      });
    }

    // Deduplicate and sort
    const seen = new Set();
    const deduped = posts
      .filter(p => p && (p.upvotes > 0))
      .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .sort((a, b) => b.trend_score - a.trend_score)
      .slice(0, 40);

    if (deduped.length === 0) {
      return { statusCode: 503, headers, body: JSON.stringify({ ok: false, error: 'No HN posts fetched.' }) };
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, count: deduped.length, source: 'hackernews', scraped_at: new Date().toISOString(), posts: deduped })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
