
import os, sqlite3, numpy as np, pandas as pd
from datetime import datetime
from sklearn.linear_model import LinearRegression
import matplotlib.pyplot as plt

os.makedirs("db", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

MERGE_DATE = pd.Timestamp("2024-07-01")

def simulate():
    dates = pd.date_range("2023-01-01","2024-12-31",freq="D")
    banks = ["Standard Bank","FNB","ABSA","Nedbank"]
    merging = ("Standard Bank","ABSA")
    base = {"Standard Bank":150,"FNB":140,"ABSA":155,"Nedbank":145}
    rng = np.random.default_rng(0)
    t = np.arange(len(dates))
    cost = 100 + 0.02*t + np.sin(t/30)*0.8

    rows=[]
    for b in banks:
        y = base[b] + np.cumsum(rng.normal(0,0.6,len(dates))) + 0.05*(cost-100)
        if b in merging:
            y = y + (dates>=MERGE_DATE).astype(int)*0.08*np.arange(len(dates))
        for i,d in enumerate(dates):
            rows.append((d,b,float(y[i]),float(cost[i])))
    df = pd.DataFrame(rows, columns=["date","bank","cds_bps","cost_index"])
    # shares
    pre = {"Standard Bank":0.30,"FNB":0.25,"ABSA":0.28,"Nedbank":0.17}
    post = pre.copy(); post["Standard Bank"] = pre["Standard Bank"]+pre["ABSA"]; post["ABSA"]=0.0
    df["share"]=0.0
    for d in dates:
        use = post if d>=MERGE_DATE else pre
        for b in banks:
            df.loc[(df.date==d)&(df.bank==b),"share"]=use[b]
    return df

def write_db(df):
    con = sqlite3.connect("db/merger_sim.db")
    df.to_sql("prices", con, if_exists="replace", index=False)
    con.close()

def vmm(pre_df, full_df, bw=8.0):
    pre_df = pre_df.sort_values(["bank","date"]).copy()
    pre_df["lag"] = pre_df.groupby("bank")["cds_bps"].shift(1)
    pre_df = pre_df.dropna()
    X = pre_df[["lag","cost_index"]].values; y = pre_df["cds_bps"].values

    full_df = full_df.sort_values(["bank","date"]).copy()
    full_df["lag"] = full_df.groupby("bank")["cds_bps"].shift(1)

    yh=[]
    for _,r in full_df.iterrows():
        if pd.isna(r["lag"]): yh.append(np.nan); continue
        x = np.array([r["lag"], r["cost_index"]])
        d2 = ((X - x)**2).sum(axis=1)
        w = np.exp(-d2/(2*bw*bw))
        yh.append( (w@y)/(w.sum()+1e-12) )
    full_df["vmm_hat"]=yh
    return full_df

def kpis(df):
    pre = df[df.date<MERGE_DATE]; post=df[df.date>=MERGE_DATE]
    base = pre.groupby("date")["vmm_hat"].mean().tail(60).mean()
    post_m = post.groupby("date")["vmm_hat"].mean().mean()
    avg_imp = float(post_m - base)

    def hhi(g):
        return int(round(10000*np.sum(np.square(g))))
    import numpy as np
    H_pre = hhi(pre.groupby("bank")["share"].mean().values)
    H_post= hhi(post.groupby("bank")["share"].mean().values)
    dHHI = H_post-H_pre

    # pass-through from pre differences
    pre2 = pre.sort_values(["bank","date"]).copy()
    pre2["dP"] = pre2.groupby("bank")["cds_bps"].diff()
    pre2["dC"] = pre2.groupby("bank")["cost_index"].diff()
    ok = pre2.dropna()
    if len(ok)>0 and ok["dC"].var()>1e-9:
        beta = np.cov(ok["dP"], ok["dC"])[0,1]/ok["dC"].var()
    else:
        beta = np.nan
    risk = "HIGH" if (avg_imp>8 and dHHI>200) else ("MEDIUM" if (avg_imp>4 or dHHI>100) else "LOW")
    return {"avg_price_impact_bps":round(avg_imp,2), "HHI_pre":H_pre, "HHI_post":H_post, "dHHI":dHHI,
            "pass_through": None if pd.isna(beta) else round(float(beta),3), "risk":risk}

def welfare(df):
    pre = df[df.date<MERGE_DATE]; post=df[df.date>=MERGE_DATE]
    avg_pre = pre.groupby("date")["vmm_hat"].mean().mean()
    avg_post = post.groupby("date")["vmm_hat"].mean().mean()
    dP = avg_post-avg_pre
    Q=1.0
    consumers = -dP*Q
    merged = 0.7*dP*Q
    rivals = 0.3*dP*Q*0.4
    dwl = -0.1*abs(dP)*Q
    net = consumers+merged+rivals+dwl
    return {"consumers":round(consumers,4), "merged_entity":round(merged,4),
            "rivals":round(rivals,4), "dwl":round(dwl,4), "net":round(net,4)}

def plots(df):
    import matplotlib.pyplot as plt
    m = df.groupby("date")[["cds_bps","vmm_hat"]].mean()
    fig,ax = plt.subplots(figsize=(10,4))
    ax.plot(m.index, m["cds_bps"], label="Actual")
    ax.plot(m.index, m["vmm_hat"], label="VMM")
    ax.axvline(pd.Timestamp("2024-07-01"), linestyle="--")
    ax.set_title("Market Average CDS Spread (bps)")
    ax.legend(); fig.tight_layout()
    fig.savefig("outputs/cds_time_series.png"); plt.close(fig)

    # welfare will be plotted by caller with numbers

if __name__=="__main__":
    import pandas as pd, numpy as np
    df = simulate()
    write_db(df)
    pre = df[df.date<MERGE_DATE]
    dfp = vmm(pre, df, bw=8.0)

    con = sqlite3.connect("db/merger_sim.db")
    dfp.to_sql("predictions", con, if_exists="replace", index=False)
    k = kpis(dfp); w = welfare(dfp)
    pd.DataFrame([k]).to_sql("kpis", con, if_exists="replace", index=False)
    pd.DataFrame([w]).to_sql("welfare", con, if_exists="replace", index=False)
    con.close()

    plots(dfp)

    # quick welfare chart
    labels=list(w.keys()); vals=[w[x] for x in labels]
    fig,ax=plt.subplots(figsize=(6,3))
    colors=["tab:green" if v>=0 else "tab:red" for v in vals]
    ax.bar(labels, vals, color=colors); ax.set_title("Welfare Decomposition (Δ)")
    fig.tight_layout(); fig.savefig("outputs/welfare.png"); plt.close(fig)

    print("DONE. DB at db/merger_sim.db; charts in outputs/.")
