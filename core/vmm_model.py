import numpy as np
import pandas as pd

def fit_vmm_pre(df: pd.DataFrame, date_col="date", y_col="cds_actual"):
    # mock "VMM" pre-merger: low-variance smoother + residuals for bootstrap
    pre = df[df[y_col].notna()].copy()
    y = pre[y_col].to_numpy()
    # simple Kalman-like EWMA as placeholder
    alpha = 0.2
    yhat = np.zeros_like(y)
    yhat[0] = y[0]
    for i in range(1, len(y)):
        yhat[i] = alpha*y[i] + (1-alpha)*yhat[i-1]
    resid = y - yhat
    return pre, yhat, resid

def predict_with_ci(df: pd.DataFrame, pre, yhat_pre, resid, boot_n=500, ci=0.95, seed=3):
    # extend smoother into post using last state + random walk drift
    full_dates = df["date"].to_numpy()
    yhat_full = np.empty(len(full_dates))
    yhat_full[:] = np.nan
    yhat_full[:len(yhat_pre)] = yhat_pre
    # naive continuation
    step = np.nanmean(np.diff(yhat_pre))
    for i in range(len(yhat_pre), len(full_dates)):
        yhat_full[i] = yhat_full[i-1] + step

    # bootstrap CI from pre residuals
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(boot_n):
        bres = rng.choice(resid, size=len(full_dates), replace=True)
        boots.append(yhat_full + bres)
    boots = np.vstack(boots)
    lo = np.percentile(boots, (1-ci)*50, axis=0)
    hi = np.percentile(boots, 100 - (1-ci)*50, axis=0)

    # fit stats
    mape = float(np.mean(np.abs(resid) / np.maximum(1e-6, pre["cds_actual"].to_numpy())) * 100)
    r2 = float(1 - (np.var(resid)/np.var(pre["cds_actual"].to_numpy())))
    mean_resid = float(np.mean(resid))
    return yhat_full, lo, hi, {"MAPE": mape, "R2": r2, "mean_resid": mean_resid}
