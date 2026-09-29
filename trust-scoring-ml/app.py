"""Flask microservice exposing the trust-scoring models."""

from flask import Flask, jsonify, request

from src.predict import predict_trust

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/score")
def score():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "Request body must be JSON"}), 400

    role = payload.get("role")
    features = payload.get("features")

    if not role:
        return jsonify({"error": "'role' is required"}), 400
    if not isinstance(features, dict):
        return jsonify({"error": "'features' is required and must be an object"}), 400

    try:
        result = predict_trust(role, features)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except FileNotFoundError:
        return jsonify({"error": f"No trained model found for role '{role}'"}), 503

    return jsonify(
        {
            "role": result["role"],
            "trust_level": str(result["trust_level"]),
            "probabilities": {label: float(p) for label, p in result["probabilities"].items()},
        }
    )


if __name__ == "__main__":
    app.run(debug=True)
