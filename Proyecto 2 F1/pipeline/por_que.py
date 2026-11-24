import sqlite3
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold, cross_val_score

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"

# Nombres de los grupos según el perfil que vimos en clustering.py.
NOMBRES = {
    0: "Una parada (M-H)",
    1: "Largada con duro (H-M)",
    2: "Dos paradas agresiva (S-M-S)",
    3: "Dos paradas estándar (M-H-H)",
}

con = sqlite3.connect(RUTA_DB)

# --- 1. Junto las estrategias con el grupo de cada piloto-carrera -----------
df = pd.read_sql(
    "SELECT e.*, c.cluster FROM estrategias e "
    "JOIN clusters c ON e.session_key = c.session_key "
    "AND e.driver_number = c.driver_number", con)
df["estrategia"] = df["cluster"].map(NOMBRES)
print("Pilotos-carrera:", len(df), "\n")

# --- 2. Qué hizo cada equipo (2025 y 2026) ----------------------------------
reciente = df[df["year"] >= 2025]
por_equipo = pd.crosstab(reciente["team_name"], reciente["estrategia"], normalize="index").round(2)
print("Estrategias por equipo, 2025-2026 (cada fila suma 1):")
print(por_equipo.to_string(), "\n")

# --- 3. Qué estrategia domina en cada circuito ------------------------------
por_circuito = pd.crosstab(df["circuit_short_name"], df["estrategia"], normalize="index").round(2)
por_circuito["dominante"] = por_circuito.idxmax(axis=1)
print("Estrategia dominante por circuito:")
print(por_circuito.sort_values("dominante").to_string(), "\n")

# --- 4. Modelo: ¿qué factores explican la estrategia elegida? ---------------
X = df[["pos_largada", "n_safety_car", "n_vsc", "temp_pista", "year"]].copy()
X = X.join(pd.get_dummies(df["circuit_short_name"], prefix="circ"))
X = X.join(pd.get_dummies(df["team_name"], prefix="eq"))
y = df["cluster"]

# Saco las filas sin posición de largada.
valido = X["pos_largada"].notna()
X, y, grupos = X[valido], y[valido], df.loc[valido, "session_key"]

modelo = RandomForestClassifier(n_estimators=300, min_samples_leaf=3,
                                random_state=42, n_jobs=-1)

# Valido separando por carrera: así el modelo nunca ve una carrera de prueba
# durante el entrenamiento.
aciertos = cross_val_score(modelo, X, y, groups=grupos, cv=GroupKFold(n_splits=5))
base = y.value_counts(normalize=True).max()
print(f"Acierto del modelo: {aciertos.mean():.2f}")
print(f"Acierto de siempre adivinar el grupo más común: {base:.2f}\n")

# --- 5. Qué variables pesan más ---------------------------------------------
modelo.fit(X, y)
imp = pd.Series(modelo.feature_importances_, index=X.columns)

resumen = {
    "circuito (suma)": imp[imp.index.str.startswith("circ_")].sum(),
    "equipo (suma)": imp[imp.index.str.startswith("eq_")].sum(),
}
for v in ["pos_largada", "n_safety_car", "n_vsc", "temp_pista", "year"]:
    resumen[v] = imp[v]

factores = pd.Series(resumen).sort_values(ascending=False).round(3)
print("Importancia de los factores:")
print(factores)

# --- 6. Guardo los resultados en la base para que la API los lea ------------
factores_df = factores.reset_index()
factores_df.columns = ["factor", "importancia"]
factores_df.to_sql("por_que_factores", con, if_exists="replace", index=False)

pd.DataFrame([{"acierto_modelo": round(aciertos.mean(), 3),
               "acierto_base": round(base, 3)}]).to_sql(
    "por_que_modelo", con, if_exists="replace", index=False)

pd.DataFrame({"cluster": list(NOMBRES.keys()),
              "estrategia": list(NOMBRES.values())}).to_sql(
    "estrategias_nombres", con, if_exists="replace", index=False)

print("\nResultados guardados en la base.")
con.close()