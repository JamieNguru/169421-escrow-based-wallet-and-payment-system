import numpy as np
import pandas as pd

from src.seller_risk import build_dataset, seller_counts, score_terciles, seller_features, shrink, validate_trust_rule


def _orders(seller, n, start, late_share=0.0, status="delivered", score=5):
    purchase = pd.date_range(start, periods=n, freq="D")
    late = np.arange(n) < int(n * late_share)
    delivered = purchase + pd.to_timedelta(np.where(late, 15, 8), unit="D")
    return pd.DataFrame(
        {
            "seller_id": seller,
            "order_status": status,
            "order_purchase_timestamp": purchase,
            "order_estimated_delivery_date": purchase + pd.Timedelta(days=10),
            "order_delivered_customer_date": delivered if status == "delivered" else pd.NaT,
            "review_score": score,
        }
    )


def test_seller_features_measure_overrun_completion_and_low_reviews():
    orders = pd.concat(
        [_orders("a", 10, "2017-01-01", late_share=0.5, score=1), _orders("a", 10, "2017-02-01", status="canceled", score=1)]
    )

    counts = seller_counts(orders).loc["a"]

    assert counts["completion_rate"] == 0.5
    assert counts["delivery_overrun"] == 0.25  # half the delivered orders ran 50% past a 10-day promise
    assert counts["low"] == counts["reviewed"] == 20
    assert counts["late"] == 5 and counts["delivered"] == 10


def test_on_time_delivery_has_zero_overrun():
    assert seller_counts(_orders("a", 5, "2017-01-01")).loc["a", "delivery_overrun"] == 0


def test_shrink_pulls_small_samples_toward_the_prior_more_than_large_ones():
    assert shrink(1, 1, 0.1, 30) < 0.15  # one bad order barely moves the estimate
    assert shrink(100, 100, 0.1, 30) > 0.75
    assert shrink(0, 0, 0.1, 30) == 0.1


def test_seller_features_shrinks_toward_marketplace_rate():
    orders = pd.concat([_orders("bad", 3, "2017-01-01", score=1), _orders("ok", 200, "2017-01-01", score=5)])

    features = seller_features(orders)

    assert 0 < features.loc["bad", "low_review_rate"] < 0.2  # 3 of 3 low, but only 3 orders
    assert features.loc["ok", "low_review_rate"] < features.loc["bad", "low_review_rate"]


def test_build_dataset_uses_earlier_orders_for_features_and_later_for_outcome():
    sellers = [
        pd.concat([_orders(f"s{i}", 12, "2017-06-01", score=5), _orders(f"s{i}", 25, "2018-02-01", score=1 if i < 3 else 5)])
        for i in range(9)
    ]

    data = build_dataset(pd.concat(sellers), cutoff="2018-01-01")

    assert len(data) == 9
    assert (data["low_review_rate"] < 0.1).all()
    assert (data["later_low_review_rate"].iloc[:3] == 1).all()
    assert data["high_risk"].sum() == 3


def test_build_dataset_drops_sellers_with_too_few_orders_on_either_side():
    orders = pd.concat([_orders("few", 3, "2017-06-01"), _orders("few", 25, "2018-02-01")])

    assert build_dataset(orders, cutoff="2018-01-01").empty


def test_validate_trust_rule_scores_worse_sellers_lower():
    sellers = [
        pd.concat([_orders(f"s{i}", 12, "2017-06-01", late_share=0.9 if i < 5 else 0, score=1 if i < 5 else 5),
                   _orders(f"s{i}", 25, "2018-02-01", score=1 if i < 5 else 5)])
        for i in range(12)
    ]
    data = build_dataset(pd.concat(sellers), cutoff="2018-01-01")

    results = validate_trust_rule(data)

    assert all(result["spearman"] < 0 and result["auc"] > 0.5 for result in results.values())


def test_score_terciles_split_by_score_alone_and_keep_ties_together():
    points = pd.Series([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
    assert score_terciles(points).value_counts().to_dict() == {"Low": 3, "Medium": 3, "High": 3}

    tied = pd.Series([1.0] * 6 + [0.5, 0.4, 0.3])
    assert set(score_terciles(tied)[:6]) == {"High"}
