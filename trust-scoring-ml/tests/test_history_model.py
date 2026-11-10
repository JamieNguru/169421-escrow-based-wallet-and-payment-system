import numpy as np
import pandas as pd
import pytest

import app as app_module
from src.history_model import band_for, predict_history, train_history_model
from src.model_io import load_model, save_model


def _orders(seller, n, start, low_share, late_share):
    purchase = pd.date_range(start, periods=n, freq="D")
    late = np.arange(n) < int(n * late_share)
    low = np.arange(n) < int(n * low_share)
    return pd.DataFrame(
        {
            "seller_id": seller,
            "order_status": "delivered",
            "order_purchase_timestamp": purchase,
            "order_estimated_delivery_date": purchase + pd.Timedelta(days=10),
            "order_delivered_customer_date": purchase + pd.to_timedelta(np.where(late, 15, 8), unit="D"),
            "review_score": np.where(low, 1, 5),
        }
    )


@pytest.fixture(scope="module")
def olist_like_orders():
    # Sellers who were bad before the cutoff stay bad after it, so history carries signal.
    sellers = []
    for i in range(60):
        share = i / 60 * 0.6
        sellers.append(
            pd.concat(
                [_orders(f"s{i}", 40, "2017-03-01", share, share), _orders(f"s{i}", 40, "2018-02-01", share, share)]
            )
        )
    return pd.concat(sellers)


@pytest.fixture(scope="module")
def model(olist_like_orders):
    return train_history_model(olist_like_orders)


def good(**extra):
    return {"jobs": 100, "disputed": 0, **extra}


def bad(**extra):
    return {"jobs": 100, "disputed": 40, **extra}


def test_training_keeps_priors_and_ordered_band_cuts(model):
    assert 0 < model["priors"]["low_review_rate"] < 1
    assert 0 < model["cuts"]["medium_from"] < model["cuts"]["low_from"] < 1
    assert model["trained_on"]["sellers"] == 60


def test_a_clean_history_is_high_trust_and_a_troubled_one_low_trust(model):
    clean = predict_history(good(), model)
    troubled = predict_history(bad(), model)

    assert clean["trust_level"] == "High"
    assert troubled["trust_level"] == "Low"
    assert clean["risk"] < troubled["risk"]


def test_more_disputes_never_lower_the_risk(model):
    risks = [predict_history({"jobs": 50, "disputed": d}, model)["risk"] for d in range(0, 30, 5)]

    assert risks == sorted(risks) and risks[0] < risks[-1]


def test_the_served_model_scores_past_dissatisfaction_only(model):
    # Late deliveries overlap with past bad reviews and earned a negative weight when scored, so they are left out.
    assert model["columns"] == ["low_review_rate"]
    assert model["pipeline"].steps[-1][1].coef_[0][0] > 0


def test_a_tiny_history_is_pulled_toward_the_middle(model):
    one_bad_job = predict_history({"jobs": 1, "disputed": 1}, model)
    long_bad_record = predict_history(bad(), model)

    assert one_bad_job["risk"] < long_bad_record["risk"]
    assert one_bad_job["trust_level"] != "Low"


def test_an_empty_history_scores_as_the_marketplace_average(model):
    empty = predict_history({"jobs": 0, "disputed": 0}, model)

    assert empty["rates"]["low_review_rate"] == pytest.approx(model["priors"]["low_review_rate"])
    assert empty["trust_level"] == "Medium"


def test_band_for_cuts_risk_into_thirds():
    cuts = {"medium_from": 0.3, "low_from": 0.6}

    assert [band_for(r, cuts) for r in (0.1, 0.3, 0.59, 0.6, 0.9)] == ["High", "Medium", "Medium", "Low", "Low"]


@pytest.mark.parametrize(
    "counts, message",
    [
        ({"jobs": 5}, "disputed"),
        ({"disputed": 0}, "jobs"),
        ({"jobs": -1, "disputed": 0}, "negative"),
        ({"jobs": 5, "disputed": 6}, "disputed"),
        ({"jobs": "5", "disputed": 0}, "whole number"),
        ({"jobs": 5.5, "disputed": 0}, "whole number"),
        ({"jobs": True, "disputed": 0}, "whole number"),
        ({"jobs": float("nan"), "disputed": 0}, "whole number"),
    ],
)
def test_bad_counts_are_rejected(model, counts, message):
    with pytest.raises(ValueError, match=message):
        predict_history(counts, model)


def test_saved_model_round_trips_through_model_io(model, tmp_path):
    save_model(model, "worker", "history", models_dir=tmp_path)
    reloaded = load_model("worker", "history", models_dir=tmp_path)

    assert predict_history(bad(), reloaded)["risk"] == predict_history(bad(), model)["risk"]


class TestHistoryEndpoint:
    @pytest.fixture
    def client(self, model, monkeypatch):
        monkeypatch.setattr("src.history_model.load_model", lambda role, version: model)
        return app_module.app.test_client()

    def test_returns_band_risk_and_rates(self, client):
        res = client.post("/score/history", json={"counts": good()})

        assert res.status_code == 200
        body = res.get_json()
        assert body["trust_level"] == "High"
        assert 0 <= body["risk"] <= 1
        assert set(body["rates"]) == {"low_review_rate"}

    def test_a_troubled_worker_is_low_trust_over_http(self, client):
        assert client.post("/score/history", json={"counts": bad()}).get_json()["trust_level"] == "Low"

    @pytest.mark.parametrize("payload", [None, {}, {"counts": []}, {"counts": "x"}])
    def test_rejects_a_missing_or_malformed_body(self, client, payload):
        res = client.post("/score/history", json=payload) if payload is not None else client.post("/score/history")

        assert res.status_code == 400

    def test_rejects_impossible_counts(self, client):
        res = client.post("/score/history", json={"counts": {"jobs": 2, "disputed": 5}})

        assert res.status_code == 400
        assert "disputed" in res.get_json()["error"]

    def test_503_when_no_model_is_trained(self, monkeypatch):
        def missing(role, version):
            raise FileNotFoundError

        monkeypatch.setattr("src.history_model.load_model", missing)
        res = app_module.app.test_client().post("/score/history", json={"counts": good()})

        assert res.status_code == 503
