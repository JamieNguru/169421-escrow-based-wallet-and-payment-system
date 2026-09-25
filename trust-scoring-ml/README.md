# Trust Scoring ML Microservice

Random Forest classifier that scores platform users into Low/Medium/High trust levels based on transaction history (completion rate, dispute frequency, response time, transaction volume), served as a Flask microservice for the escrow wallet backend.

## Setup

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Data

Raw datasets are not committed to the repo (see `.gitignore`). Place them locally under `data/`:

- `transactions_data.csv`
- `users_data.csv`
- `cards_data.csv`
- `mcc_codes.json`
- `train_fraud_labels.json`

## Notebooks

- [`notebooks/01_dataset_exploration.ipynb`](notebooks/01_dataset_exploration.ipynb) — loads and profiles the raw datasets.
- [`notebooks/02_feature_engineering.ipynb`](notebooks/02_feature_engineering.ipynb) — cleans and engineers features for the classifier.

Run with `jupyter lab` from this directory after activating the virtual environment.

## Pipeline (`src/`)

- `preprocessing.py` / `feature_engineering.py` — reusable feature pipeline, ported from the notebooks.
- `train.py` — trains the Random Forest model.
- `evaluate.py` — computes precision/recall/F1/ROC-AUC.
- `predict.py` — inference wrapper used by `app.py`.

## API

Once `app.py` is implemented: `POST /score` returns a trust classification for a given user's transaction features. See [Issues](../../../issues) for current build status.
