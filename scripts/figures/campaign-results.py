import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
a = json.load(open(sys.argv[1]))
runs = [r for r in a["runs"] if r["status"] in ("QUALIFIED", "CENSORED")]
def vals(cell, arch, f):
    return [f(r) for r in runs if r["cell"] == cell and r["arch"] == arch]
plt.rcParams.update({"font.family": "serif", "font.size": 7, "axes.linewidth": 0.6, "xtick.major.width": 0.6, "ytick.major.width": 0.6})
R, K = "#1f5fa8", "#c0392b"
fig, ax = plt.subplots(1, 3, figsize=(7.1, 2.15), gridspec_kw={"width_ratios": [1.6, 1, 1]})
# (a) completions during the database delay: bar at median, whisker min-max, value label
groups = [("REST", "A-DATABASE-R4", "REST", R), ("Kafka", "A-DATABASE-R4", "Kafka", K),
          ("poll\n5 ms", "B-POLL5-DATABASE-R4", "Kafka", K), ("poll\n10 ms", "B-POLL10-DATABASE-R4", "Kafka", K),
          ("poll\n25 ms", "B-POLL25-DATABASE-R4", "Kafka", K), ("batch-\ned", "C-BATCHED-DATABASE-R4", "Kafka", K),
          ("REST", "C-WORKERS8-DATABASE-R4", "REST", R), ("Kafka", "C-WORKERS8-DATABASE-R4", "Kafka", K)]
def median(v):
    v = sorted(v); n = len(v); return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2
for i, (lab, cell, arch, col) in enumerate(groups):
    v = vals(cell, arch, lambda r: r["fault"]["doneExactInterval"])
    m = median(v)
    ax[0].bar(i, m, width=0.62, color=col, alpha=0.85, lw=0)
    ax[0].vlines(i, min(v), max(v), color="black", lw=0.7)
    ax[0].text(i, max(v) + 3, f"{m:g}", ha="center", va="bottom", fontsize=6.2)
ax[0].axvline(5.5, color="grey", lw=0.5, ls=":")
ax[0].text(2.5, 143, "4 workers", ha="center", fontsize=6, color="dimgrey"); ax[0].text(6.5, 143, "8 workers", ha="center", fontsize=6, color="dimgrey")
ax[0].annotate("", xy=(1.7, 34), xytext=(5.3, 34), arrowprops=dict(arrowstyle="-", color=K, lw=0.6))
ax[0].text(3.5, 37, "Kafka variants", ha="center", fontsize=5.6, color=K)
ax[0].set_xticks(range(len(groups))); ax[0].set_xticklabels([g[0] for g in groups], fontsize=5.6)
ax[0].set_ylabel("Transfers finished\nduring the delay"); ax[0].set_ylim(0, 152)
ax[0].set_title("(a) 60 s database delay at 4 ops/s", fontsize=7)
# (b) polling interval: Kafka median line with min-max whiskers, REST band
polls = [(5, "B-POLL5-NOFAULT-R8"), (10, "B-POLL10-NOFAULT-R8"), (25, "B-POLL25-NOFAULT-R8"), (50, "A-NOFAULT-R8")]
xs, ms = [], []
for p, cell in polls:
    v = vals(cell, "Kafka", lambda r: r["medianMs"])
    m = median(v); xs.append(p); ms.append(m)
    ax[1].vlines(p, min(v), max(v), color=K, lw=0.8)
    dx, dy, ha = {5: (-1.5, -2, "right"), 10: (-1, 10, "right"), 25: (0, 10, "center"), 50: (0, 10, "center")}[p]
    ax[1].text(p + dx, m + dy, f"{m:g} ms", ha=ha, fontsize=6.2, color=K)
ax[1].plot(xs, ms, marker="s", ms=3, lw=0.9, color=K, label="Kafka")
rest = vals("A-NOFAULT-R8", "REST", lambda r: r["medianMs"])
ax[1].axhspan(min(rest), max(rest), color=R, alpha=0.25, lw=0)
ax[1].text(27, min(rest) - 15, f"REST {min(rest):g}\u2013{max(rest):g} ms (no polling)", color=R, fontsize=6, ha="center")
ax[1].set_xticks([5, 10, 25, 50]); ax[1].set_xlabel("Kafka outbox polling interval (ms)"); ax[1].set_ylabel("Median latency (ms)")
ax[1].set_ylim(0, 170); ax[1].set_xlim(-9, 56); ax[1].set_title("(b) No fault, 8 ops/s", fontsize=7)
# (c) ladder
for arch, col, mk in (("REST", R, "o"), ("Kafka", K, "s")):
    pts = [(l["offeredTransfersPerSecond"], l["goodput"]) for l in a["ladder"] if l["arch"] == arch]
    pts.sort()
    ax[2].plot([p[0] for p in pts], [p[1]["median"] for p in pts], marker=mk, ms=2.5, lw=0.8, color=col, label=arch)
    ax[2].vlines([p[0] for p in pts], [p[1]["min"] for p in pts], [p[1]["max"] for p in pts], color=col, lw=0.8)
mx = 256 * 0.76
ax[2].plot([0, mx], [0, mx], ls=":", lw=0.6, color="grey")
ax[2].set_xscale("log", base=2); ax[2].set_yscale("log", base=2)
ticks = [6.08, 12.2, 24.3, 48.6, 97.3, 194.6]
ax[2].set_xticks(ticks); ax[2].set_xticklabels(["6", "12", "24", "49", "97", "195"]); ax[2].set_yticks([6, 12, 24, 48, 96]); ax[2].set_yticklabels(["6", "12", "24", "48", "96"])
ax[2].minorticks_off()
ax[2].set_xlabel("Offered transfers/s"); ax[2].set_ylabel("Correct goodput (/s)"); ax[2].legend(frameon=False, fontsize=6, loc="upper left")
ax[2].set_title("(c) Load ladder, 3 runs per step", fontsize=7)
for x in ax: x.spines["top"].set_visible(False); x.spines["right"].set_visible(False)
fig.tight_layout(pad=0.3, w_pad=0.8)
fig.savefig(sys.argv[2], dpi=600)
