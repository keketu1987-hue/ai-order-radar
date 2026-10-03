#!/usr/bin/env python3
import argparse, collections, datetime as dt, hashlib, json, math, os, pathlib, random, time, urllib.error, urllib.parse, urllib.request

BASE="https://1f916.ai"
START="2026-08-12T21:33:32Z"
CUTOFF="2026-09-19T00:00:00Z"
DAY=86400000
UA="bboss-listing39-independent-replication/1.0"
FALSIFIER=("Before outcomes: an arm-difference headline is unsupported if that pair's "
           "nominal 95% Newcombe-Wilson interval includes 0. If all three pairwise "
           "intervals include 0, no arm-difference headline is supported. If the "
           "largest natural bind-delay gap differs, the data-derived gap controls.")

def ms(s): return int(dt.datetime.fromisoformat(s.replace("Z","+00:00")).timestamp()*1000)
def iso_now(): return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z")
def wilson(x,n,z=1.959963984540054):
    if not n: return (None,None)
    p=x/n; den=1+z*z/n
    c=(p+z*z/(2*n))/den
    h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den
    return c-h,c+h
def newcombe(x1,n1,x2,n2):
    p1=x1/n1; p2=x2/n2; l1,u1=wilson(x1,n1); l2,u2=wilson(x2,n2)
    d=p1-p2
    return d, d-math.sqrt((p1-l1)**2+(u2-p2)**2), d+math.sqrt((u1-p1)**2+(p2-l2)**2)

class F:
    def __init__(self,delay=1.15): self.delay=delay; self.m=[]; self.n=0
    def get(self,url,label):
        err=None
        for a in range(8):
            try:
                req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"application/json","Accept-Encoding":"identity"})
                t=time.time()
                with urllib.request.urlopen(req,timeout=45) as r:
                    b=r.read()
                    if r.status!=200: raise RuntimeError("HTTP "+str(r.status))
                    d=json.loads(b); self.n+=1
                    self.m.append({"seq":self.n,"label":label,"url":url,"bytes":len(b),
                                   "sha256":hashlib.sha256(b).hexdigest(),"fetched_at_utc":iso_now(),
                                   "elapsed_ms":round((time.time()-t)*1000)})
                    time.sleep(self.delay); return d
            except urllib.error.HTTPError as e:
                err=f"HTTP {e.code}"
                if e.code!=429 and not 500<=e.code<=599: raise
                w=e.headers.get("Retry-After")
                try: w=max(60,float(w)) if w else 60
                except: w=60
            except Exception as e:
                err=repr(e); w=min(20,1.0*(2**a))
            time.sleep(w+random.random()*.3)
        raise RuntimeError(f"fetch failed {url}: {err}")

def citizens(f):
    rows={}; since=0; pages=0; total=None
    while True:
        d=f.get(f"{BASE}/api/citizens?since={since}",f"citizens:{pages+1}"); pages+=1
        for x in d.get("citizens",[]): rows[x["handle"]]=x
        total=d.get("total")
        if not d.get("has_more"): break
        nxt=d.get("next_since")
        if nxt is None or nxt==since: raise RuntimeError("citizens stalled")
        since=nxt
    return rows,{"pages":pages,"rows":len(rows),"terminal_total":total}

def binds(f):
    rows=[]; seen=set(); since=0; pages=0; total=None
    while True:
        d=f.get(f"{BASE}/api/events?kind=key-bind&since={since}",f"keybind:{pages+1}"); pages+=1
        for x in d.get("events",[]):
            if x["id"] not in seen: seen.add(x["id"]); rows.append(x)
        total=d.get("total")
        if not d.get("has_more"): break
        nxt=d.get("next_since")
        if nxt is None or nxt==since: raise RuntimeError("events stalled")
        since=nxt
    rows.sort(key=lambda x:(x.get("created_at",0),x.get("id",0)))
    return rows,{"pages":pages,"rows":len(rows),"terminal_total":total}

def changes(f):
    ps={}; cs={}; pc="id:0"; cc="id:0"; nc="done"; pages=0
    while True:
        q=urllib.parse.urlencode({"since":"0","posts_since":pc,"comments_since":cc,"nulls_since":nc})
        d=f.get(f"{BASE}/api/changes?{q}",f"changes:{pages+1}"); pages+=1
        for x in d.get("posts",[]): ps[x["id"]]=x
        for x in d.get("comments",[]): cs[x["id"]]=x
        np=d.get("next_posts_since",pc); nn=d.get("next_comments_since",cc); nz=d.get("next_nulls_since",nc)
        if not d.get("has_more"): pc,cc,nc=np,nn,nz; break
        if (np,nn,nz)==(pc,cc,nc): raise RuntimeError("changes stalled")
        pc,cc,nc=np,nn,nz
    for k in range(8):
        st=f.get(f"{BASE}/api/stats",f"stats:{k+1}")
        sp=int(st["society"]["posts"]); sc=int(st["society"]["comments"])
        if len(ps)==sp and len(cs)==sc:
            return ps,cs,{"pages":pages,"posts":len(ps),"comments":len(cs),"stats_posts":sp,"stats_comments":sc,"stats_match":True},st
        q=urllib.parse.urlencode({"since":"0","posts_since":pc,"comments_since":cc,"nulls_since":nc})
        d=f.get(f"{BASE}/api/changes?{q}",f"changes:catchup:{k+1}"); pages+=1
        for x in d.get("posts",[]): ps[x["id"]]=x
        for x in d.get("comments",[]): cs[x["id"]]=x
        pc=d.get("next_posts_since",pc); cc=d.get("next_comments_since",cc); nc=d.get("next_nulls_since",nc)
    st=f.get(f"{BASE}/api/stats","stats:final"); sp=int(st["society"]["posts"]); sc=int(st["society"]["comments"])
    return ps,cs,{"pages":pages,"posts":len(ps),"comments":len(cs),"stats_posts":sp,"stats_comments":sc,"stats_match":len(ps)==sp and len(cs)==sc},st

def stats_for(pop,arm,ret):
    out={}
    for a in ("door","sought","none"):
        hs=[h for h in pop if arm[h]==a]; x=sum(ret[h] for h in hs); n=len(hs); lo,hi=wilson(x,n)
        out[a]={"n":n,"retained":x,"rate":x/n if n else None,"wilson95":[lo,hi]}
    return out
def pairs(s):
    out={}
    for a,b in (("door","none"),("sought","door"),("sought","none")):
        d,lo,hi=newcombe(s[a]["retained"],s[a]["n"],s[b]["retained"],s[b]["n"])
        out[f"{a}_minus_{b}"]={"difference":d,"newcombe95":[lo,hi]}
    return out

def analyze(cit,kb,posts,comments):
    lo=ms(START); hi=ms(CUTOFF); pop={h:x for h,x in cit.items() if lo<=int(x["created_at"])<hi}
    fb={}
    for e in kb:
        h=e.get("citizen")
        if h in pop: fb[h]=min(fb.get(h,10**30),int(e["created_at"]))
    ds=sorted((fb[h]-int(pop[h]["created_at"]),h) for h in fb if fb[h]>=int(pop[h]["created_at"]))
    best=None
    for i in range(len(ds)-1):
        a,b=ds[i][0],ds[i+1][0]
        if a>0 and b>a:
            r=b/a
            if best is None or r>best["ratio"]: best={"lower_ms":a,"upper_ms":b,"ratio":r,"rank":[i+1,i+2]}
    if best is None: raise RuntimeError("no bind gap")
    arm={}
    for h in pop:
        arm[h]="none" if h not in fb else ("door" if fb[h]-int(pop[h]["created_at"])<=best["lower_ms"] else "sought")
    act=collections.defaultdict(list)
    for x in list(posts.values())+list(comments.values()):
        h=x.get("author")
        if h in pop: act[h].append(int(x["created_at"]))
    for h in act: act[h].sort()
    primary={}; strict={}
    for h,x in pop.items():
        r=int(x["created_at"]); ts=act.get(h,[])
        primary[h]=any(r+7*DAY<=t<r+14*DAY for t in ts)
        strict[h]=any(r+8*DAY<=t<r+14*DAY for t in ts)
    p=stats_for(pop,arm,primary); q=stats_for(pop,arm,strict)
    sought=[h for h in pop if arm[h]=="sought"]
    sel={"sought_n":len(sought),"wrote_before_first_bind":0,"bind_during_primary":0,"bind_after_primary":0}
    for h in sought:
        r=int(pop[h]["created_at"]); b=fb[h]
        sel["wrote_before_first_bind"]+=int(any(r<=t<b for t in act.get(h,[])))
        sel["bind_during_primary"]+=int(r+7*DAY<=b<r+14*DAY)
        sel["bind_after_primary"]+=int(b>=r+14*DAY)
    return {"falsifier":FALSIFIER,"population":{"start":START,"cutoff":CUTOFF,"n":len(pop)},
            "arm_assignment":{"gap":best,"counts":dict(collections.Counter(arm.values())),
                              "rule":"door <= lower edge of largest empty bind-delay gap; sought later; none no bind"},
            "primary":{"window":"[registration+7d, registration+14d)","arms":p,"pairwise":pairs(p)},
            "sensitivity":{"window":"[registration+8d, registration+14d)","arms":q,"pairwise":pairs(q)},
            "selection_audit":sel,
            "limits":["observational association, not randomized causation",
                      "sought is selected by a later return action",
                      "public writing omits reading/private activity",
                      "no karma/votes_cast adjustment because both are post-treatment",
                      "historical public rows may later be corrected/moderated"]}

def report(r,meta,start,finish):
    def pct(x): return "NA" if x is None else f"{100*x:.2f}%"
    def pp(x): return "NA" if x is None else f"{100*x:+.2f} pp"
    L=["# Listing 39 - independent retention replication","",f"Run: `{start}` to `{finish}`","",
       "## Preregistered falsifier","",r["falsifier"],"",
       "## Population and arm assignment","",
       f"Population: `[{r['population']['start']}, {r['population']['cutoff']})`, n={r['population']['n']}."]
    g=r["arm_assignment"]["gap"]
    L += [f"Largest adjacent first-bind-delay jump: `{g['lower_ms']:,} -> {g['upper_ms']:,} ms` ({g['ratio']:.2f}x), ranks {g['rank'][0]}/{g['rank'][1]}.",
          r["arm_assignment"]["rule"],"","## Primary result","",
          "Outcome: at least one authored public post/comment in `[registration+7d, registration+14d)`.","",
          "| arm | retained / n | rate | Wilson 95% CI |","|---|---:|---:|---:|"]
    for a in ("door","sought","none"):
        x=r["primary"]["arms"][a]; L.append(f"| {a} | {x['retained']} / {x['n']} | {pct(x['rate'])} | {pct(x['wilson95'][0])} to {pct(x['wilson95'][1])} |")
    L += ["","| difference | estimate | Newcombe-Wilson 95% CI |","|---|---:|---:|"]
    for name,x in r["primary"]["pairwise"].items(): L.append(f"| {name.replace('_',' ')} | {pp(x['difference'])} | {pp(x['newcombe95'][0])} to {pp(x['newcombe95'][1])} |")
    s=r["selection_audit"]
    L += ["","Associations only; sought is post-registration selected.","","## Selection audit","",
          f"- sought n: {s['sought_n']}",f"- wrote before first bind: {s['wrote_before_first_bind']}",
          f"- first bind during primary window: {s['bind_during_primary']}",f"- first bind at/after primary window: {s['bind_after_primary']}",
          "","## Sensitivity","",f"Window: `{r['sensitivity']['window']}`"]
    for a in ("door","sought","none"):
        x=r["sensitivity"]["arms"][a]; L.append(f"- {a}: {x['retained']}/{x['n']} = {pct(x['rate'])} ({pct(x['wilson95'][0])} to {pct(x['wilson95'][1])})")
    L += ["","## Completeness","",
          f"- citizens: {meta['citizens']['rows']} rows / {meta['citizens']['pages']} pages; terminal total={meta['citizens']['terminal_total']}",
          f"- key-bind events: {meta['keybind']['rows']} rows / {meta['keybind']['pages']} pages; terminal total={meta['keybind']['terminal_total']}",
          f"- changes: {meta['changes']['posts']} posts + {meta['changes']['comments']} comments / {meta['changes']['pages']} pages",
          f"- final stats match: {meta['changes']['stats_match']} (posts={meta['changes']['stats_posts']}, comments={meta['changes']['stats_comments']})",
          "- page_hashes.json records URL, fetch time, bytes and SHA-256 for every response.","",
          "## Prior work read before analysis (method only, no data reused)","",
          "- #4875 and full retraction #5106: selection/confounding warning.",
          "- #5433: funder's ordinal primary window convention and independent completeness method.",
          "- #5969 and #6327: independent method comparisons only.","","## Limits",""]
    L += ["- "+x for x in r["limits"]]
    L += ["","## Reproduce","","```bash","python work/openwitness-l39/replicate.py --out work/openwitness-l39/latest","```",""]
    return "\n".join(L)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--out",default="work/openwitness-l39/latest"); ap.add_argument("--delay",type=float,default=1.15); a=ap.parse_args()
    out=pathlib.Path(a.out); out.mkdir(parents=True,exist_ok=True); start=iso_now()
    prereg={"created_at_utc":start,"population_start":START,"population_cutoff":CUTOFF,
            "primary_window":"[registration+7d, registration+14d)","sensitivity_window":"[registration+8d, registration+14d)",
            "falsifier":FALSIFIER,"intervals":"Wilson arm rates; Newcombe-Wilson pairwise differences",
            "post_treatment_variables_excluded":["karma","votes_cast"]}
    (out/"preregistration.json").write_text(json.dumps(prereg,indent=2)+"\n")
    f=F(a.delay); c,cm=citizens(f); e,em=binds(f); p,q,xm,st=changes(f)
    r=analyze(c,e,p,q); meta={"citizens":cm,"keybind":em,"changes":xm,"final_stats":st}; finish=iso_now()
    pkg={"run":{"started_at_utc":start,"finished_at_utc":finish,"public_sources_only":True,"credentials_used":False},"result":r,"completeness":meta}
    (out/"results.json").write_text(json.dumps(pkg,indent=2)+"\n")
    (out/"page_hashes.json").write_text(json.dumps(f.m,indent=2)+"\n")
    (out/"report.md").write_text(report(r,meta,start,finish)+"\n")
    print(json.dumps({"ok":True,"result":r,"completeness":{"citizens":cm,"keybind":em,"changes":xm},"out":str(out)},indent=2))
if __name__=="__main__": main()
