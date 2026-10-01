import numpy as np
import pandas as pd
import pytest
from scipy.stats import spearmanr

from src.external_validation import VOLUME_BANDS, correlate_trust_with_real_fraud, partial_spearman
from src.feature_engineering import TRUST_LEVELS


def _volume_driven_data(n=400, seed=0):
    rng = np.random.default_rng(seed)
    volume = rng.integers(500, 30000, n)
    fraud_rate = 10 / volume * rng.uniform(0.8, 1.2, n)  # fixed fraud count, so rate falls with volume
    return volume, fraud_rate, rng


def test_partial_spearman_removes_a_relationship_that_only_runs_through_volume():
    volume, fraud_rate, rng = _volume_driven_data()
    trust = volume + rng.normal(0, 3000, len(volume))  # tracks volume, nothing else

    raw = spearmanr(trust, fraud_rate)[0]
    partial, _ = partial_spearman(trust, fraud_rate, volume)

    assert raw < -0.5
    assert abs(partial) < 0.15


def test_partial_spearman_keeps_a_relationship_that_exists_beyond_volume():
    volume, fraud_rate, rng = _volume_driven_data()
    trust = rng.uniform(0, 1, len(volume))
    fraud_rate = fraud_rate * (2 - trust)  # higher trust, less fraud at any volume

    partial, p_value = partial_spearman(trust, fraud_rate, volume)

    assert partial < -0.3
    assert p_value < 0.001


def test_correlate_trust_with_real_fraud_reports_volume_controlled_results():
    rng = np.random.default_rng(1)
    n = 120
    dataset = pd.DataFrame(
        {"client_id": range(n), "trust_level": pd.Categorical(rng.choice(TRUST_LEVELS, n), categories=TRUST_LEVELS)}
    )
    fraud_rates = pd.DataFrame(
        {
            "client_id": range(n),
            "real_fraud_rate": rng.uniform(0, 0.01, n),
            "real_labeled_transactions": rng.integers(500, 30000, n),
        }
    )

    result = correlate_trust_with_real_fraud(dataset, fraud_rates)

    assert result["n_clients"] == n
    for key in ["spearman_correlation", "partial_spearman_correlation", "trust_volume_correlation"]:
        assert -1 <= result[key] <= 1
    assert 0 <= result["partial_p_value"] <= 1

    by_band = result["mean_real_fraud_rate_by_volume_band"]
    assert list(by_band.index) == VOLUME_BANDS
    assert list(by_band.columns) == TRUST_LEVELS

    # The highest-volume Low-trust cell is the mean over exactly those users.
    merged = dataset.merge(fraud_rates, on="client_id")
    top_quartile = merged["real_labeled_transactions"] > merged["real_labeled_transactions"].quantile(0.75)
    expected = merged.loc[top_quartile & (merged["trust_level"] == "Low"), "real_fraud_rate"].mean()
    assert by_band.loc["Highest", "Low"] == pytest.approx(expected)
