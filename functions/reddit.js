const SUBREDDITS = [
  'technology','artificial','MachineLearning','Futurology','gadgets',
  'worldnews','science','business','startups','ChatGPT',
  'LifeProTips','interestingasfuck','nextfuckinglevel','todayilearned','programming'
];

const CAT_WORDS = {
  AI:['ai','gpt','llm','openai','claude','neural','robot','chatbot'],
  Technology:['tech','software','app','code','web','dev','saas','startup','digital'],
  Finance:['crypto','bitcoin','stock','invest','money','finance','trading'],
  Gaming:['game','gaming','esport','steam','ps5','xbox','twitch'],
  Entertainment:['movie','music','netflix','film','celebrity','viral'],
  Food:['food','recipe','cook','eat','meal','diet','vegan','chef'],
  Science:['science','research','space','nasa','biology','climate','health','sleep'],
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

function calcScore(upvotes, comments, ageH) {
  const vel = Math.min(35, Math.log10(Math.max(1, upvotes / Math.max(ageH, 0.5))) * 12);
  const rec = Math.max(0, 30 - ageH * 0.6);
  const eng = Math.min(20, Math.log10(comments + 1) * 8);
  const big = Math.min(10, Math.log10(upvotes + 1) * 3);
  return Math.round(Math.min(99, vel + rec + eng + big));
}

function satLabel(ageH, commentCount) {
  if (ageH < 3)           return { label:'🟢 First wave',  color:'#10B981', tip:'Very few posts yet — catching early' };
  if (ageH < 12)          return { label:'🟡 Growing',      color:'#F59E0B', tip:'Gaining momentum — still early' };
  if (commentCount > 500) return { label:'🔴 Saturated',    color:'#EF4444', tip:'High volume — trending everywhere' };
  return                         { label:'🟠 Mid-wave',     color:'#F97316', tip:'Active spread — entering mainstream' };
}

function fmt(n) {
  return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1000?(n/1000).toFixed(1)+'K':String(n||0);
}

// Try multiple approaches to reach Reddit
async function fetchSubreddit(sub) {
  const attempts = [
    // Standard JSON API
    { url: `https://www.reddit.com/r/${sub}/hot.json?limit=8&t=day&raw_json=1`,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PulseTrends/1.0)', 'Accept': 'application/json' } },
    // Old reddit
    { url: `https://old.reddit.com/r/${sub}/hot.json?limit=8&t=day&raw_json=1`,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PulseTrends/1.0)', 'Accept': 'application/json' } },
    // API subdomain
    { url: `https://api.reddit.com/r/${sub}/hot?limit=8&t=day`,
      headers: { 'User-Agent': 'PulseTrends/1.0 (by /u/pulse_trends)', 'Accept': 'application/json' } },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { headers: attempt.headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json = await res.json();
        if (json?.data?.children?.length) return { children: json.data.children, method: attempt.url };
      }
    } catch {}
  }
  return null;
}

async function fetchComments(sub, postId) {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${sub}/comments/${postId}.json?limit=3&depth=1&sort=top&raw_json=1`,
      { headers:{'User-Agent':'Mozilla/5.0 (compatible; PulseTrends/1.0)','Accept':'application/json'}, signal:AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json?.[1]?.data?.children || [])
      .filter(c => c.kind==='t1' && c.data.body && c.data.body!=='[deleted]')
      .slice(0, 3)
      .map(c => ({ user:'u/'+c.data.author, text:c.data.body.slice(0,120), likes:c.data.score, avatar:null }));
  } catch { return []; }
}

exports.handler = async () => {
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Content-Type':'application/json',
    'Cache-Control':'public, max-age=300',
  };

  const errors = [];
  const rawPosts = [];

  // Try fetching subreddits - first test with one to see if Reddit is reachable
  const testResult = await fetchSubreddit('technology');
  if (!testResult) {
    // Reddit is completely blocked from this server - return helpful error
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Reddit API is not reachable from this server. This is a known issue with cloud hosting providers.',
        debug: 'Reddit blocks many cloud provider IPs. Consider using Reddit OAuth API instead.'
      })
    };
  }

  // Reddit is reachable - fetch all subreddits
  const results = await Promise.allSettled(
    SUBREDDITS.map(sub => fetchSubreddit(sub).then(r => ({ sub, result: r })))
  );

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value.result) continue;
    const { sub, result } = r.value;
    for (const p of result.children) {
      const d = p.data;
      if (d.stickied || d.score < 50) continue;
      const ageH = (Date.now()/1000 - d.created_utc) / 3600;
      const score = calcScore(d.score, d.num_comments, ageH);
      let thumbnail = null;
      if (d.preview?.images?.[0]?.source?.url)
        thumbnail = d.preview.images[0].source.url.replace(/&amp;/g,'&');
      else if (d.thumbnail?.startsWith('http'))
        thumbnail = d.thumbnail;

      rawPosts.push({
        id: 'r-'+d.id, reddit_id: d.id, platform:'reddit',
        creator_name: d.author, creator_handle:'u/'+d.author, creator_avatar:null,
        caption: d.title, thumbnail, url:'https://www.reddit.com'+d.permalink,
        subreddit: sub, flair: d.link_flair_text||null,
        views: d.score*20, upvotes: d.score, likes: d.score,
        comments: d.num_comments, shares: Math.round(d.score*0.06),
        upvote_ratio: d.upvote_ratio,
        trend_score: score,
        category: detectCat(d.title+' '+sub),
        sat: satLabel(ageH, d.num_comments),
        growth_label:'+'+fmt(Math.round(d.score/Math.max(ageH,0.5)))+'/hr',
        growth_rate: Math.round(d.score/Math.max(ageH,0.5)),
        is_early: ageH<6 && score>55,
        posted_at: new Date(d.created_utc*1000).toISOString(),
        age_hours: ageH, top_comments:[],
      });
    }
  }

  const seen = new Set();
  const posts = rawPosts
    .filter(p => { if(seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a,b) => b.trend_score - a.trend_score)
    .slice(0, 40);

  // Fetch real comments for top 8
  await Promise.allSettled(posts.slice(0,8).map(async p => {
    p.top_comments = await fetchComments(p.subreddit, p.reddit_id);
  }));

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok:true, count:posts.length, scraped_at:new Date().toISOString(), posts })
  };
};
