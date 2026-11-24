import sqlite3
from pathlib import Path

import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
K = 4  # cantidad de grupos; lo ajustamos viendo el silhouette

con = sqlite3.connect(RUTA_DB)

# --- 1. Cargo la tabla de estrategias y el largo de cada carrera ------------
df = pd.read_sql("SELECT * FROM estrategias", con)
largo = pd.read_sql(
    "SELECT session_key, MAX(number_of_laps) AS vueltas_carrera "
    "FROM resultado GROUP BY session_key", con)
df = df.merge(largo, on="session_key", how="left")

# --- 2. Me quedo con carreras secas y pilotos que terminaron ----------------
seco = df[(df["mojada"] == 0) & (df["dnf"] == 0) & (df["dns"] == 0)].copy()

# --- 3. Variables que describen la estrategia -------------------------------
# Cuándo paró por primera vez, como porcentaje de la carrera (1.0 si nunca paró).
seco["pct_primera_parada"] = (seco["vuelta_primera_parada"] / seco["vueltas_carrera"]).fillna(1.0)

# Qué tan largo fue su stint más largo, como porcentaje de la carrera.
seco["pct_stint_max"] = seco["stint_mas_largo"] / seco["vueltas_carrera"]

# Cuántos tipos distintos de neumático usó.
seco["n_compuestos"] = seco["secuencia"].apply(lambda s: len(set(s.split("-"))))

# Con qué neumático largó (una columna por cada tipo).
for letra in ["S", "M", "H"]:
    seco[f"inicia_{letra}"] = (seco["compuesto_inicial"] == letra).astype(int)

VARIABLES = ["paradas", "pct_primera_parada", "pct_stint_max",
             "n_compuestos", "inicia_S", "inicia_M", "inicia_H"]
seco = seco.dropna(subset=VARIABLES)
print("Pilotos-carrera en el análisis:", len(seco), "\n")

# --- 4. Pongo todas las variables en la misma escala ------------------------
X = StandardScaler().fit_transform(seco[VARIABLES])

# --- 5. Pruebo distintos K para ver cuál separa mejor -----------------------
print("Silhouette por cantidad de grupos (más alto es mejor):")
for k in range(2, 9):
    etiquetas = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(X)
    print(f"  K={k}: {silhouette_score(X, etiquetas):.3f}")

# --- 6. Armo los grupos con el K elegido ------------------------------------
modelo = KMeans(n_clusters=K, n_init=10, random_state=42)
seco["cluster"] = modelo.fit_predict(X)

# --- 7. Perfil de cada grupo ------------------------------------------------
perfil = seco.groupby("cluster").agg(
    pilotos=("cluster", "size"),
    paradas=("paradas", "mean"),
    primera_parada=("pct_primera_parada", "mean"),
    stint_max=("pct_stint_max", "mean"),
    posiciones_ganadas=("posiciones_ganadas", "mean"),
    secuencia_tipica=("secuencia", lambda s: s.value_counts().index[0]),
).round(2)
print(f"\nPerfil de los {K} grupos:")
print(perfil.to_string())

# Las 3 secuencias más comunes de cada grupo, para ponerles nombre después.
print("\nSecuencias más comunes por grupo:")
for c, grupo in seco.groupby("cluster"):
    print(f"  Grupo {c}: {grupo['secuencia'].value_counts().head(3).to_dict()}")

# --- 8. Guardo el resultado en la base --------------------------------------
seco[["session_key", "driver_number", "cluster"]].to_sql(
    "clusters", con, if_exists="replace", index=False)

con.close()