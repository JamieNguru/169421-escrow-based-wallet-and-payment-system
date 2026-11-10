"""Predict a seller's later customer dissatisfaction from their earlier behaviour.

Real marketplace data (Olist) stands in for workers. Features come from orders before a
cutoff date; the outcome, the share of 1-2 star reviews, from orders after it. The outcome is
a real customer judgement from a later period, not a formula of the features.

A seller with few orders has a noisy rate, so rates are shrunk toward the marketplace average
(empirical Bayes: (events + m * prior) / (orders + m)), which pulls small samples toward the
average and leaves large ones almost untouched. Past low reviews predict future ones on their
own, so the delivery-only models are the fairer test of delivery behaviour.
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from src.realistic import COMPLETION_FLOOR, OVERRUN_CEILING, SCORE_WEIGHTS, trust_level, trust_points

OLIST_DIR = Path(__file__).resolve().parent.parent / "data" / "olist"

# Fixed before looking at results; _main also prints how sensitive the result is to them.
CUTOFF = "2018-01-01"
MIN_REVIEWED_BEFORE = 10
MIN_REVIEWED_AFTER = 20
SHRINKAGE = 30
LOW_REVIEW_MAX = 2
HIGH_RISK_QUANTILE = 2 / 3
FAILED_STATUSES = {"canceled", "unavailable"}
SEED = 42

DELIVERY_COLUMNS = ["completion_rate", "late_rate", "delivery_overrun"]
ALL_COLUMNS = DELIVERY_COLUMNS + ["low_review_rate"]
# Past outcomes carry the signal: the shrunk low-review rate and late rate.
HISTORY_COLUMNS = ["low_review_rate", "late_rate"]

DATE_COLUMNS = ["order_purchase_timestamp", "order_delivered_customer_date", "order_estimated_delivery_date"]


def load_orders(olist_dir=OLIST_DIR):
    """One row per (order, seller) with dates, status and the order's mean review score."""
    olist_dir = Path(olist_dir)
    orders = pd.read_csv(olist_dir / "olist_orders_dataset.csv", parse_dates=DATE_COLUMNS)
    items = pd.read_csv(olist_dir / "olist_order_items_dataset.csv", usecols=["order_id", "seller_id"]).drop_duplicates()
    reviews = pd.read_csv(olist_dir / "olist_order_reviews_dataset.csv", usecols=["order_id", "review_score"])
    review_scores = reviews.groupby("order_id")["review_score"].mean().rename("review_score")
    return orders.merge(items, on="order_id").merge(review_scores, on="order_id", how="left")


def shrink(events, trials, prior, strength):
    """Empirical-Bayes estimate of a rate: small samples are pulled toward the prior."""
    return (events + strength * prior) / (trials + strength)


def seller_counts(orders):
    """Per seller: order, reviewed, low-review, delivered and late counts, plus completion
    rate and mean delivery overrun as a share of the promised time (0 = on time)."""
    orders = orders.copy()
    promised = (orders["order_estimated_delivery_date"] - orders["order_purchase_timestamp"]).dt.total_seconds()
    actual = (orders["order_delivered_customer_date"] - orders["order_purchase_timestamp"]).dt.total_seconds()
    orders["overrun"] = np.where(promised > 0, np.clip((actual - promised) / promised, 0, None), np.nan)
    orders["failed"] = orders["order_status"].isin(FAILED_STATUSES).astype(float)
    reviewed = orders["review_score"].notna()
    orders["reviewed"] = reviewed.astype(float)
    orders["low"] = ((orders["review_score"] <= LOW_REVIEW_MAX) & reviewed).astype(float)
    delivered = orders["order_delivered_customer_date"].notna()
    orders["delivered"] = delivered.astype(float)
    orders["late"] = (
        (orders["order_delivered_customer_date"] > orders["order_estimated_delivery_date"]) & delivered
    ).astype(float)

    grouped = orders.groupby("seller_id")
    return pd.DataFrame(
        {
            "orders": grouped.size(),
            "reviewed": grouped["reviewed"].sum(),
            "low": grouped["low"].sum(),
            "delivered": grouped["delivered"].sum(),
            "late": grouped["late"].sum(),
            "completion_rate": 1 - grouped["failed"].mean(),
            "delivery_overrun": grouped["overrun"].mean(),
        }
    )


def seller_features(orders, strength=SHRINKAGE):
    """Shrunk late and low-review rates (prior = marketplace-wide rate), plus completion
    rate and delivery overrun."""
    counts = seller_counts(orders)
    prior_low = counts["low"].sum() / counts["reviewed"].sum()
    prior_late = counts["late"].sum() / counts["delivered"].sum()
    counts["low_review_rate"] = shrink(counts["low"], counts["reviewed"], prior_low, strength)
    counts["late_rate"] = shrink(counts["late"], counts["delivered"], prior_late, strength)
    return counts


def build_dataset(
    orders,
    cutoff=CUTOFF,
    min_before=MIN_REVIEWED_BEFORE,
    min_after=MIN_REVIEWED_AFTER,
    strength=SHRINKAGE,
):
    """Features from orders purchased before the cutoff, outcome from orders after it
    (raw low-review rate, as it is the measurement). High risk (1) is the top third of
    sellers by that later rate."""
    before = orders[orders["order_purchase_timestamp"] < cutoff]
    after = orders[orders["order_purchase_timestamp"] >= cutoff]

    features = seller_features(before, strength)
    later = seller_counts(after)[["reviewed", "low"]].add_prefix("later_")
    later["later_low_review_rate"] = later["later_low"] / later["later_reviewed"]

    data = features.join(later, how="inner")
    data = data[(data["reviewed"] >= min_before) & (data["later_reviewed"] >= min_after)]
    data = data.dropna(subset=ALL_COLUMNS).copy()

    cutoff_rate = data["later_low_review_rate"].quantile(HIGH_RISK_QUANTILE)
    data["high_risk"] = (data["later_low_review_rate"] >= cutoff_rate).astype(int)
    return data


def candidates(seed=SEED):
    def logistic():
        return make_pipeline(StandardScaler(), LogisticRegression())

    return {
        "logistic, delivery only": (logistic(), DELIVERY_COLUMNS),
        "forest, delivery only": (
            RandomForestClassifier(n_estimators=300, min_samples_leaf=5, random_state=seed),
            DELIVERY_COLUMNS,
        ),
        "logistic, past reviews only": (logistic(), ["low_review_rate"]),
        "logistic, delivery + reviews": (logistic(), ALL_COLUMNS),
        "logistic, reviews + late rate": (logistic(), HISTORY_COLUMNS),
        "logistic, volume only": (logistic(), ["orders"]),
        "always majority": (DummyClassifier(strategy="prior"), DELIVERY_COLUMNS),
    }


def compare(data, n_repeats=10, seed=SEED):
    """ROC-AUC mean and std over repeated stratified 5-fold CV for each candidate."""
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=n_repeats, random_state=seed)
    results = {}
    for name, (model, columns) in candidates(seed).items():
        scores = cross_val_score(model, data[columns], data["high_risk"], cv=cv, scoring="roc_auc")
        results[name] = (float(np.mean(scores)), float(np.std(scores)))
    return results


def sensitivity(orders, cutoffs=("2017-10-01", "2018-01-01"), strengths=(0, 30, 100), n_repeats=5):
    """Delivery-only and past-review AUC under other cutoffs and shrinkage strengths, so
    the headline design is not read as the best of many tries."""
    rows = []
    for cutoff in cutoffs:
        for strength in strengths:
            data = build_dataset(orders, cutoff=cutoff, strength=strength)
            results = compare(data, n_repeats=n_repeats)
            rows.append(
                {
                    "cutoff": cutoff,
                    "shrinkage": strength,
                    "sellers": len(data),
                    "delivery_only": results["logistic, delivery only"][0],
                    "past_reviews": results["logistic, past reviews only"][0],
                }
            )
    return pd.DataFrame(rows)


def risk_bands(data, seed=SEED, columns=HISTORY_COLUMNS):
    """Out-of-fold risk from the history model (on `columns`), cut into Low/Medium/High trust by thirds of
    that risk (highest risk = Low trust), with mean later low-review rate per band. Out-of-fold
    so no seller is scored by a model that saw their own outcome."""
    from sklearn.model_selection import StratifiedKFold, cross_val_predict

    model = make_pipeline(StandardScaler(), LogisticRegression())
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    risk = pd.Series(
        cross_val_predict(model, data[columns], data["high_risk"], cv=cv, method="predict_proba")[:, 1],
        index=data.index,
    )
    bands = score_terciles(-risk)
    return data.groupby(bands)["later_low_review_rate"].agg(["count", "mean"]).reindex(["High", "Medium", "Low"])


def delivery_only_points(data):
    """The v2 worker rule without its issues term (completion and delivery overrun only,
    weights rescaled), for when no dispute measure is available."""
    completion = np.clip((data["completion_rate"] - COMPLETION_FLOOR) / (1 - COMPLETION_FLOOR), 0, 1)
    timing = np.clip(1 - data["delivery_overrun"] / OVERRUN_CEILING, 0, 1)
    weights = SCORE_WEIGHTS["completion"] + SCORE_WEIGHTS["time"]
    return (SCORE_WEIGHTS["completion"] * completion + SCORE_WEIGHTS["time"] * timing) / weights


def score_terciles(points):
    """Low/Medium/High by thirds of the score distribution itself (ties share a band).
    Uses no outcome data, so checking later outcomes by band stays an honest test."""
    percentile = pd.Series(np.asarray(points), index=points.index).rank(pct=True, method="average")
    return pd.Series(np.where(percentile > 2 / 3, "High", np.where(percentile > 1 / 3, "Medium", "Low")), index=points.index)


def validate_trust_rule(data):
    """Apply the served v2 worker rule, untrained, to Olist sellers and relate its score to
    their later low-review rate. Returns per-variant Spearman correlation (negative is
    good), ROC-AUC of a low score predicting high risk, and mean later low-review rate by
    trust level under the served thresholds and under score terciles. The full variant uses the shrunk past low-review rate as its dispute proxy."""
    variants = {
        "full rule (past reviews as dispute proxy)": trust_points(
            "worker", data["completion_rate"], data["low_review_rate"], data["delivery_overrun"]
        ),
        "delivery-only rule": delivery_only_points(data),
    }
    results = {}
    for name, points in variants.items():
        levels = pd.Series(trust_level(points), index=data.index)
        by_level = data.groupby(levels)["later_low_review_rate"].agg(["count", "mean"])
        by_tercile = data.groupby(score_terciles(pd.Series(points, index=data.index)))["later_low_review_rate"].agg(["count", "mean"])
        results[name] = {
            "by_tercile": by_tercile.reindex(["High", "Medium", "Low"]),
            "spearman": float(spearmanr(points, data["later_low_review_rate"])[0]),
            "auc": float(roc_auc_score(data["high_risk"], -points)),
            "by_level": by_level.reindex(["High", "Medium", "Low"]),
        }
    return results


def _main():
    orders = load_orders()
    print(f"orders (order x seller rows): {len(orders)}, sellers: {orders['seller_id'].nunique()}")

    data = build_dataset(orders)
    print(
        f"cutoff {CUTOFF}, shrinkage {SHRINKAGE}; sellers with >= {MIN_REVIEWED_BEFORE} reviewed orders before "
        f"and >= {MIN_REVIEWED_AFTER} after: {len(data)}, high-risk: {data['high_risk'].sum()}"
    )

    print("\nROC-AUC, repeated 5-fold CV (mean +/- std):")
    for name, (mean, std) in compare(data).items():
        print(f"  {name:<30} {mean:.3f} +/- {std:.3f}")

    print("\nThe served v2 worker rule applied untrained to these sellers:")
    for name, result in validate_trust_rule(data).items():
        print(f"  {name}: Spearman {result['spearman']:+.3f}, AUC {result['auc']:.3f}")
        print("  served thresholds:")
        print(result["by_level"].round(3).to_string())
        print("  Olist score terciles (no outcome data used):")
        print(result["by_tercile"].round(3).to_string())

    print("\nHistory model (reviews + late rate), out-of-fold risk in thirds; later low-review rate by band:")
    print(risk_bands(data).round(3).to_string())

    print("\nServed model (past low-review rate only), same bands:")
    print(risk_bands(data, columns=["low_review_rate"]).round(3).to_string())

    print("\nSensitivity to cutoff and shrinkage (logistic, ROC-AUC):")
    print(sensitivity(orders).round(3).to_string(index=False))


if __name__ == "__main__":
    _main()
