# Trust Scoring ML Microservice

Two Random Forest classifiers (one for workers, one for clients) that score platform users into Low/Medium/High trust levels based on their transaction history, served through a single role-aware Flask microservice for the escrow wallet backend.

Workers are assessed on job completion rate, dispute frequency, and response time. Clients are assessed on payment completion, escrow release time, and refund/dispute history.

## Setup

```
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Trained models (`models/*.joblib`) are git-ignored. Train the served v2 models with `python -m src.realistic`, then start the service with `python app.py` (port 5000). `Dockerfile` and `requirements-deploy.txt` are for container deployment (port 7860). See the [setup guide](../docs/setup-guide.md) for the whole system.

## Data

Raw datasets are not committed to the repo (see `.gitignore`). Place them locally under `data/`:

- `transactions_data.csv`
- `users_data.csv`
- `cards_data.csv`
- `mcc_codes.json`
- `train_fraud_labels.json`

## Notebooks

One notebook per pipeline stage, following the proposal's Chapter 3. Run them in order: each saves what the next one loads.

| Notebook | Stage | Saves |
|---|---|---|
| [`01_data_acquisition`](notebooks/01_data_acquisition.ipynb) | Profiles the raw data (3.2.1) | - |
| [`02_data_preprocessing`](notebooks/02_data_preprocessing.ipynb) | Cleans amounts, flags failures, encodes channel, merges merchant categories (3.2.2) | `data/processed/transactions_clean.parquet` |
| [`03_feature_engineering`](notebooks/03_feature_engineering.ipynb) | Per-user aggregation, synthetic worker/client split, trust labels (3.2.2) | `data/processed/{worker,client}_features.csv` |
| [`04_model_training`](notebooks/04_model_training.ipynb) | Cross-validated tuning of trees and depth, final training (3.2.3) | `models/*.joblib`, tuning heatmaps |
| [`05_model_evaluation`](notebooks/05_model_evaluation.ipynb) | Test-set metrics, real-fraud validation, report figures (3.2.4) | `reports/figures/*.png` |
| [`06_prediction_and_deployment`](notebooks/06_prediction_and_deployment.ipynb) | `predict_trust` and the Flask `/score` endpoint | - |

Run locally with `jupyter lab` from this directory after activating the virtual environment. Each notebook also runs in Google Colab: its first cell mounts Google Drive, copies this repo's code from the `dev` branch, and reads raw data from the Drive root (outputs go to `My Drive/processed` and `My Drive/models`).

## Pipeline (`src/`)

- `preprocessing.py` / `feature_engineering.py`: cleaning, per-user aggregation, synthetic worker/client datasets, trust labels.
- `train.py`: train/test split, cross-validated hyperparameter tuning, and training. `python -m src.train` tunes both models and saves them.
- `evaluate.py`: accuracy, precision, recall, F1, ROC-AUC on the held-out test set. `python -m src.evaluate` scores the saved models.
- `external_validation.py`: checks trust levels against real fraud labels, holding transaction volume constant (fraud rate falls with volume regardless of trust).
- `generate_figures.py` / `plots.py`: report figures. `python -m src.generate_figures` regenerates them from the saved models.
- `realistic.py`: the v2 models the service now serves. v1's tertile labels made "Low" mean only "bottom third of near-perfect users", so v2 labels by fixed thresholds (completion, dispute/refund rate and turnaround each scored 0-1 and weighted) and trains on the real-derived users plus synthetic profiles covering the poor behaviour an escrow platform sees. `python -m src.realistic` trains and saves both. The labels are a rule the forest learns, so its test accuracy shows it reproduces the rule, not that the rule is validated.
- `evaluate_v2.py`: evaluates the v2 models: confusion matrix and per-class metrics, the labelling rule and a majority-class predictor as baselines, and mean and spread over five splits plus 5-fold CV. `python -m src.evaluate_v2`. The rule scores 100% because it generates the labels, so the forest is judged on how closely it matches it, not on beating it.
- `fraud_risk.py`: the one model whose target is not a formula of its inputs. Predicts whether a client is in the top third by real fraud rate (`train_fraud_labels.json`) from the three client behaviour features, compared by repeated CV with a volume-only baseline and a majority baseline. Result: behaviour forest ROC-AUC 0.68, volume-only 0.73, chance 0.50, so the features carry some signal but no more than activity level alone. `python -m src.fraud_risk` (caches fraud rates to `data/processed/client_fraud_rates.csv`).
- `seller_risk.py`: real-data worker analogue using the Olist marketplace dataset (CC BY-NC-SA 4.0; place the CSVs in `data/olist/`, not committed). Per-seller completion rate, late-delivery rate, delivery overrun and low-review rate come from orders before 2018-01-01, with rates shrunk toward the marketplace average (empirical Bayes, strength 30) so small samples are not over-trusted. The outcome is the seller's 1-2 star review rate after that date; high risk is the top third (339 sellers with 10+ reviewed orders before and 20+ after). Result, ROC-AUC with repeated CV: logistic on delivery behaviour 0.61, forest on the same 0.54, past low-review rate 0.74, volume 0.52, chance 0.50. Delivery-only ranges 0.54-0.61 across cutoffs and shrinkage settings, so treat it as weak evidence. At order level (one seller's history predicting one review) AUC was only about 0.55, because a single review mostly reflects that order. The served v2 worker rule is also applied untrained to these sellers (`validate_trust_rule`): its score correlates with later low-review rate at Spearman -0.32 (AUC 0.65), or -0.27 (AUC 0.62) with the issues term dropped, so the continuous score ranks sellers in the right direction. The served Low/Medium/High thresholds do not separate them (nearly all sellers land in one band, because they were set for dispute rates, not marketplace review rates). Bands set from thirds of the Olist score distribution alone, with no outcome data, are the fairer check; see `score_terciles`. `python -m src.seller_risk`.
- `time_split_validation.py`: tests whether past behaviour predicts real fraud later. Features are rebuilt from 2010-2016 transactions only, scored with the v2 models, and compared with each client's real fraud rate in 2017-2019 (`train_fraud_labels.json`). The 1,126 clients with 1,000+ fraud-labelled transactions after the cutoff are used; high risk is a later fraud rate above the median. Every client is scored as both a worker and a client, and the worker's `delivery_overrun` is fixed at 0 because card transactions have no delivery promises. Result: ROC-AUC 0.47 (worker v2), 0.50 (client v2), 0.47-0.51 for the untrained rules, 0.54 for past volume alone, against 0.50 for chance; Spearman correlations are between -0.15 and 0.05. So the scores carry no usable signal for real fraud on this data, which is expected: fraud is about 0.2% of transactions, and the completion and dispute proxies come from payment error types, not from fraud. Limitations: one cutoff (2017-01-01), a card-payment dataset standing in for an escrow platform, and a worker score that ignores timing. `python -m src.time_split_validation` (caches to `data/processed/client_future_fraud_rates.csv`).
- `predict.py`: inference wrapper used by `app.py`; loads the correct model based on the requesting user's role.

## API

`python app.py` serves two endpoints (port 5000 locally, 7860 in the container). There is no authentication: the service is internal and only the backend calls it, through `ML_SERVICE_URL`.

### `GET /health`

Returns `200` with `{ "status": "ok" }`.

### `POST /score`

Scores one user with the model for their role.

```json
{
  "role": "worker",
  "features": { "job_completion_rate": 0.92, "dispute_rate": 0.04, "delivery_overrun": 0.1 }
}
```

Returns `200` with the predicted level and the probability of each level:

```json
{
  "role": "worker",
  "trust_level": "High",
  "probabilities": { "High": 0.81, "Low": 0.02, "Medium": 0.17 }
}
```

`features` must contain every feature for the role, and nothing else is read:

| Role | Feature | Range | Meaning |
|---|---|---|---|
| `worker` | `job_completion_rate` | 0 to 1 | Settled jobs paid out over all settled jobs |
| `worker` | `dispute_rate` | 0 to 1 | Disputes on the worker's jobs over their funded jobs |
| `worker` | `delivery_overrun` | 0 or more | How far past the promised delivery time jobs ran, as a share of that time (0 when on time) |
| `client` | `payment_completion_rate` | 0 to 1 | Settled jobs paid out over all settled jobs |
| `client` | `refund_rate` | 0 to 1 | Refund requests plus disputes the client raised, over their funded jobs |
| `client` | `escrow_release_time_hours` | 0 or more | Average hours from work submitted to the client releasing |

Values must be numbers; booleans, `NaN` and out-of-range values are rejected rather than scored.

| Status | Cause |
|---|---|
| `400` | Body is not JSON, `role` or `features` is missing, `role` is not `worker` or `client`, a feature is missing, or a feature is not a number in range |
| `503` | No trained model file exists for the role (train with `python -m src.realistic`) |

The backend works the feature values out from a user's job history (`backend/src/services/trustScoreService.ts`), gives the call a 5-second timeout, and turns any failure from this service into a `503` for its own caller. Users with fewer than 3 settled jobs are never sent here; the backend reports them as `New`.
