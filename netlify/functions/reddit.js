const SUBREDDITS = [
  'technology','artificial','MachineLearning','Futurology','gadgets',
  'worldnews','science','business','startups','programming',
  'ChatGPT','singularity','dataisbeautiful','NoCode','SideProject',
  'LifeProTips','interestingasfuck','nextfuckinglevel','todayilearned','YouShouldKnow'
];

const CAT_WORDS = {
  AI:['ai','gpt','llm','openai','claude','gemini','neural','robot','chatbot','deepmind','artificial'],
  Technology:['tech','software','app','code','program','web','dev','saas','startup','digital','cyber','api'],
  Finance:['crypto','bitcoin','stock','invest','money','finance','trading'],
  Gaming:['game','gaming','esport','steam','ps5','xbox','nintendo','twitch'],
  Entertainment:['movie','music','netflix','film','celebrity','viral'],
  Food:['food','recipe','cook','eat','meal','diet','vegan','chef'],
  Science:['science','research','space','nasa','biology','climate','health','sleep','brain'],
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

async function fetchSubreddit(sub) {
  const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=8&t=day`, {
    headers: { 'User-Agent':'PulseTrends/2.0','Accept':'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.data?.children || [];
}

async function fetchComments(sub, postId) {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${sub}/comments/${postId}.json?limit=5&depth=1&sort=top`,
      { headers:{'User-Agent':'PulseTrends/2.0','Accept':'application/json'}, signal:AbortSignal.timeout(6000) }
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
  try {
    const results = await Promise.allSettled(
      SUBREDDITS.map(sub => fetchSubreddit(sub).then(posts => ({ sub, posts })))
    );

    const rawPosts = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { sub, posts } = r.value;
      for (const p of posts) {
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
          caption: d.title, full_text:(d.selftext||'').slice(0,400),
          thumbnail, url:'https://www.reddit.com'+d.permalink,
          subreddit: sub, flair: d.link_flair_text||null,
          views: d.score*20, upvotes: d.score, likes: d.score,
          comments: d.num_comments, shares: Math.round(d.score*0.06),
          upvote_ratio: d.upvote_ratio,
          trend_score: score,
          category: detectCat(d.title+' '+sub+' '+(d.selftext||'')),
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

    const commentResults = await Promise.allSettled(
      posts.slice(0,10).map(p => fetchComments(p.subreddit, p.reddit_id))
    );
    commentResults.forEach((r,i) => {
      if (r.status==='fulfilled' && r.value.length>0) posts[i].top_comments = r.value;
    });

    return { statusCode:200, headers, body:JSON.stringify({ ok:true, count:posts.length, scraped_at:new Date().toISOString(), posts }) };
  } catch(err) {
    return { statusCode:500, headers, body:JSON.stringify({ ok:false, error:err.message }) };
  }
};
