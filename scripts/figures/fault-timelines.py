import json, sys, datetime as dt
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
root = sys.argv[1]; out = sys.argv[2]
def ts(s): return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
def series(run):
    o = json.load(open(f"{root}/results-revision-campaign-v2/{run}/run-outcomes.json"))
    fe = json.load(open(f"{root}/results-revision-campaign-v2/{run}/fault-evidence.json"))
    inj, clr = ts(fe["injectedAt"]), ts(fe["clearedAt"])
    tr = [(ts(t["receivedAt"]), ts(t["terminalAt"]) if t.get("terminalAt") else 1e20) for t in o["transfers"]]
    xs = list(range(-30, 151)); back = []; done = []
    for x in xs:
        t = inj + x
        back.append(sum(1 for r, e in tr if r <= t < e))
        done.append(sum(1 for r, e in tr if t - 1 < e <= t))
    return xs, back, done, clr - inj
plt.rcParams.update({"font.family": "serif", "font.size": 7, "axes.linewidth": 0.6})
R, K = "#1f5fa8", "#c0392b"
fig, ax = plt.subplots(2, 1, figsize=(3.45, 2.4), sharex=True)
for run, col, lab in (("CAMP-A-DATABASE-R4-R-01", R, "REST"), ("CAMP-A-DATABASE-R4-K-01", K, "Kafka")):
    xs, b, d, dur = series(run)
    ax[0].plot(xs, b, color=col, lw=0.9, label=lab)
ax[0].axvspan(0, dur, color="grey", alpha=0.15, lw=0)
ax[0].set_ylabel("Backlog"); ax[0].legend(frameon=False, fontsize=6, loc="upper right")
ax[0].set_title("(a) Database delay, pair 1", fontsize=7)
import gzip
def accepted(run):
    fe = json.load(open(f"{root}/results-revision-campaign-v2/{run}/fault-evidence.json"))
    inj = ts(fe["injectedAt"])
    at = json.load(gzip.open(f"{root}/results-revision-campaign-v2/{run}/client-attempts.json.gz"))["attempts"]
    ok = [ts(a["sentAt"]) - inj for a in at if 200 <= a["httpStatus"] < 300]
    xs = list(range(-30, 151))
    return xs, [sum(1 for t in ok if x - 5 < t <= x) / 5 for x in xs], fe
for run, col, lab in (("CAMP-E-APPKILL-R4-R-03", R, "REST"), ("CAMP-E-APPKILL-R4-K-01", K, "Kafka")):
    xs, y, fe = accepted(run)
    ax[1].plot(xs, y, color=col, lw=0.9, label=lab)
ax[1].axvline(0, color="grey", lw=0.6)
ax[1].set_ylabel("Successful requests/s"); ax[1].set_xlabel("Seconds from fault injection")
ax[1].legend(frameon=False, fontsize=6, loc="center right"); ax[1].set_title("(b) Application kill", fontsize=7)
for a in ax: a.spines["top"].set_visible(False); a.spines["right"].set_visible(False)
fig.tight_layout(pad=0.3, h_pad=0.6)
fig.savefig(out, dpi=600)
