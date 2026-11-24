import sqlite3
from pathlib import Path

import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"

# Abrevio los neumáticos para que la secuencia se lea fácil: I-M-H.
ABREVIATURA = {"SOFT": "S", "MEDIUM": "M", "HARD": "H", "INTERMEDIATE": "I", "WET": "W"}

con = sqlite3.connect(RUTA_DB)

# --- 1. Estrategia de cada piloto en cada carrera ---------------------------
stints = pd.read_sql("SELECT * FROM stints", con)

# Me aseguro de que las vueltas sean números (lo que no lo sea queda vacío).
stints["lap_start"] = pd.to_numeric(stints["lap_start"], errors="coerce")
stints["lap_end"] = pd.to_numeric(stints["lap_end"], errors="coerce")

# Calculo cuántas vueltas duró cada stint y abrevio el neumático.
stints["vueltas"] = stints["lap_end"] - stints["lap_start"] + 1
stints["letra"] = stints["compound"].map(ABREVIATURA).fillna("?")

# Ordeno los stints en el orden en que ocurrieron.
stints = stints.sort_values(["session_key", "driver_number", "stint_number"])

# Por piloto y carrera: secuencia, número de stints, neumático inicial,
# stint más largo y la vuelta en que terminó el primer stint.
estrategia = stints.groupby(["session_key", "driver_number"]).agg(
    secuencia=("letra", "-".join),
    n_stints=("stint_number", "count"),
    compuesto_inicial=("letra", "first"),
    stint_mas_largo=("vueltas", "max"),
    fin_primer_stint=("lap_end", "first"),
).reset_index()

# Una parada menos que la cantidad de stints.
estrategia["paradas"] = estrategia["n_stints"] - 1

# La vuelta de la primera parada es donde termina el primer stint,
# pero solo si el piloto paró al menos una vez.
estrategia["vuelta_primera_parada"] = estrategia["fin_primer_stint"].where(estrategia["paradas"] > 0)
estrategia = estrategia.drop(columns=["fin_primer_stint"])

# --- 2. Nombre y equipo -----------------------------------------------------
drivers = pd.read_sql(
    "SELECT DISTINCT session_key, driver_number, full_name, team_name FROM drivers", con)
estrategia = estrategia.merge(drivers, on=["session_key", "driver_number"], how="left")

# --- 3. Resultado final y largada -------------------------------------------
resultado = pd.read_sql(
    "SELECT session_key, driver_number, position AS pos_final, dnf, dns, points "
    "FROM resultado", con)
largada = pd.read_sql(
    "SELECT session_key, driver_number, position AS pos_largada FROM clasificacion", con)

# Las posiciones tienen que ser números para poder restarlas.
resultado["pos_final"] = pd.to_numeric(resultado["pos_final"], errors="coerce")
largada["pos_largada"] = pd.to_numeric(largada["pos_largada"], errors="coerce")

estrategia = estrategia.merge(resultado, on=["session_key", "driver_number"], how="left")
estrategia = estrategia.merge(largada, on=["session_key", "driver_number"], how="left")

# Posiciones ganadas: positivo es que subió posiciones durante la carrera.
estrategia["posiciones_ganadas"] = estrategia["pos_largada"] - estrategia["pos_final"]

# --- 4. Contexto de la carrera: lluvia y Safety Car -------------------------
clima = pd.read_sql(
    "SELECT session_key, AVG(rainfall > 0) AS pct_lluvia, "
    "AVG(track_temperature) AS temp_pista FROM clima GROUP BY session_key", con)

eventos = pd.read_sql(
    "SELECT session_key, "
    "SUM(message = 'SAFETY CAR DEPLOYED') AS n_safety_car, "
    "SUM(message = 'VIRTUAL SAFETY CAR DEPLOYED') AS n_vsc "
    "FROM control GROUP BY session_key", con)

carreras = pd.read_sql(
    "SELECT session_key, year, circuit_short_name, country_name FROM carreras", con)

estrategia = (estrategia
              .merge(carreras, on="session_key", how="left")
              .merge(clima, on="session_key", how="left")
              .merge(eventos, on="session_key", how="left"))

# Una carrera es "mojada" si llovió en más del 10 % de las lecturas de clima.
estrategia["mojada"] = (estrategia["pct_lluvia"] > 0.1).astype(int)

# --- 5. Guardo la tabla en la base y muestro un resumen ---------------------
estrategia.to_sql("estrategias", con, if_exists="replace", index=False)

print("Tabla estrategias:", estrategia.shape, "\n")

print("Vuelta de primera parada sin dato, entre pilotos que sí pararon:",
      estrategia.loc[estrategia["paradas"] > 0, "vuelta_primera_parada"].isna().sum(), "\n")

print("pos_final vacía según dnf / dns (cuántas filas):")
print(estrategia[estrategia["pos_final"].isna()].groupby(["dnf", "dns"]).size(), "\n")

una_por_carrera = estrategia.drop_duplicates("session_key")
print("Carreras por año:")
print(una_por_carrera.groupby("year").size(), "\n")
print("Carreras mojadas (más de 10 % de lluvia):", una_por_carrera["mojada"].sum())
print("Carreras con Safety Car:", (una_por_carrera["n_safety_car"] > 0).sum())

con.close()