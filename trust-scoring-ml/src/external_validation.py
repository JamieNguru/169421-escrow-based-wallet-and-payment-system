"""Check whether the synthetic trust proxy features correlate with real fraud outcomes.

trust_level (see feature_engineering.add_trust_label) is derived from the same proxy
features the models are trained on, so model accuracy against it is circular. This
module checks the proxy features against train_fraud_labels.json, a real,
independently-collected fraud outcome per transaction that was never used anywhere
else in the pipeline, as an external validity signal.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr, t

from src.feature_engineering import TRUST_LEVELS, add_client_trust_label, add_worker_trust_label

TRUST_LEVEL_ORDINAL = {level: i for i, level in enumerate(TRUST_LEVELS)}

# Quartiles of each user's number of fraud-labelled transactions (activity level).
VOLUME_BANDS = ["Lowest", "Lower-middle", "Upper-middle", "Highest"]


def partial_spearman(x, y, z):
    """Spearman correlation between x and y with z held constant.

    Users have a similar number of fraud cases however much they transact, so fraud rate
    falls as volume rises; controlling for volume stops a trust measure from looking
    predictive merely because it tracks how active a user is. Returns (rho, two-sided p).
    """
    r_xy = spearmanr(x, y)[0]
    r_xz = spearmanr(x, z)[0]
    r_yz = spearmanr(y, z)[0]
    rho = (r_xy - r_xz * r_yz) / np.sqrt((1 - r_xz**2) * (1 - r_yz**2))

    dof = len(x) - 3
    t_stat = rho * np.sqrt(dof / (1 - rho**2))
    return rho, 2 * t.sf(abs(t_stat), dof)


def load_client_fraud_rates(data_dir):
    """Compute each client's real fraud rate from train_fraud_labels.json.

    Uses a Series.map lookup rather than a DataFrame merge to keep peak memory
    down on the ~13.3M-row transactions file.
    """
    data_dir = Path(data_dir)

    transactions = pd.read_csv(
        data_dir / "transactions_data.csv",
        usecols=["id", "client_id"],
        dtype={"id": "int32", "client_id": "int32"},
    )

    with open(data_dir / "train_fraud_labels.json", "r", encoding="utf-8") as f:
        fraud_labels = json.load(f)["target"]

    fraud_series = pd.Series(
        {int(k): (v == "Yes") for k, v in fraud_labels.items()}, name="is_fraud"
    )
    del fraud_labels

    transactions["is_fraud"] = transactions["id"].map(fraud_series)
    del fraud_series
    transactions = transactions.dropna(subset=["is_fraud"])
    transactions["is_fraud"] = transactions["is_fraud"].astype(bool)

    return transactions.groupby("client_id").agg(
        real_fraud_rate=("is_fraud", "mean"),
        real_labeled_transactions=("is_fraud", "count"),
    ).reset_index()


def correlate_trust_with_real_fraud(dataset, fraud_rates, label_col="trust_level"):
    """Relate a dataset's trust_level to real per-client fraud rate, with and without
    controlling for transaction volume.

    Returns the raw Spearman correlation, the partial correlation holding volume constant,
    how strongly trust itself tracks volume, mean fraud rate per trust level, and mean fraud
    rate per trust level within each volume band.
    """
    merged = dataset.merge(fraud_rates, on="client_id", how="inner")
    merged["trust_ordinal"] = merged[label_col].map(TRUST_LEVEL_ORDINAL)
    volume = merged["real_labeled_transactions"]

    correlation, p_value = spearmanr(merged["trust_ordinal"], merged["real_fraud_rate"])
    partial, partial_p = partial_spearman(merged["trust_ordinal"], merged["real_fraud_rate"], volume)

    group_means = merged.groupby(label_col, observed=True)["real_fraud_rate"].mean().reindex(TRUST_LEVELS)

    merged["volume_band"] = pd.qcut(volume, q=len(VOLUME_BANDS), labels=VOLUME_BANDS)
    by_band = (
        merged.groupby(["volume_band", label_col], observed=True)["real_fraud_rate"]
        .mean()
        .unstack(label_col)
        .reindex(index=VOLUME_BANDS, columns=TRUST_LEVELS)
    )

    return {
        "n_clients": len(merged),
        "spearman_correlation": correlation,
        "p_value": p_value,
        "partial_spearman_correlation": partial,
        "partial_p_value": partial_p,
        "trust_volume_correlation": spearmanr(merged["trust_ordinal"], volume)[0],
        "mean_real_fraud_rate_by_trust_level": group_means.to_dict(),
        "mean_real_fraud_rate_by_volume_band": by_band,
    }


def _print_report(name, result):
    print(f"\n{name} (n={result['n_clients']})")
    print(f"  Trust vs real fraud rate, Spearman:          {result['spearman_correlation']:+.3f} (p={result['p_value']:.4f})")
    print(f"  Same, holding transaction volume constant:   {result['partial_spearman_correlation']:+.3f} (p={result['partial_p_value']:.4f})")
    print(f"  Trust vs transaction volume, Spearman:       {result['trust_volume_correlation']:+.3f}")
    print("  Mean real fraud rate by volume band (rows) and trust level (columns):")
    print(result["mean_real_fraud_rate_by_volume_band"].round(4).to_string())


def _main():
    root = Path(__file__).resolve().parent.parent
    raw_dir = root / "data"
    processed_dir = root / "data" / "processed"

    print("Loading real fraud labels and computing per-client fraud rates...")
    fraud_rates = load_client_fraud_rates(raw_dir)

    worker_dataset = add_worker_trust_label(pd.read_csv(processed_dir / "worker_features.csv"))
    client_dataset = add_client_trust_label(pd.read_csv(processed_dir / "client_features.csv"))

    _print_report("Worker dataset", correlate_trust_with_real_fraud(worker_dataset, fraud_rates))
    _print_report("Client dataset", correlate_trust_with_real_fraud(client_dataset, fraud_rates))


if __name__ == "__main__":
    _main()
