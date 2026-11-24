# Modelo explicativo de la estrategia de neumáticos (reemplaza al KMeans/Random Forest anterior).
# 1) ¿Qué tan bien se predice la estrategia de un circuito que el modelo nunca vio? (leave-circuit-out)
# 2) ¿Cuánta variación explican circuito, equipo y año? (R2 ajustado, aporte único)
# 3) ¿Se ganan posiciones con más paradas libres? (controlando por la posición de partida)
# Requiere: clasificar_paradas.py, construir_circuitos.py.
# Limitaciones: la clasificación se usa como proxy de la parrilla (no hay sanciones); solo carreras secas y pilotos que terminan.
import sqlite3
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, RidgeCV
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
con = sqlite3.connect(RUTA_DB)
pd.set_option("display.width", 170)
pd.set_option("display.max_rows", 100)

# ---------- Datos base: un registro por piloto y carrera ----------
carreras = pd.read_sql("SELECT session_key, circuit_short_name, date_start FROM carreras", con)
carreras["year"] = carreras["date_start"].str[:4].astype(int)
rc = pd.read_sql("SELECT * FROM circuitos_carrera", con)
pr = pd.read_sql("SELECT * FROM paradas_resumen", con)

res = pd.read_sql("SELECT session_key, driver_number, position, dnf, dns, dsq FROM resultado", con)
cla = pd.read_sql("SELECT session_key, driver_number, position AS grid FROM clasificacion", con).drop_duplicates(
    ["session_key", "driver_number"]
)
for c in ["position"]:
    res[c] = pd.to_numeric(res[c], errors="coerce")
cla["grid"] = pd.to_numeric(cla["grid"], errors="coerce")
for c in ["dnf", "dns", "dsq"]:
    res[c] = pd.to_numeric(res[c], errors="coerce").fillna(0)

d = pr.merge(carreras[["session_key", "circuit_short_name", "year"]], on="session_key")
d = d.merge(res, on=["session_key", "driver_number"], how="left").merge(cla, on=["session_key", "driver_number"], how="left")
d = d.merge(rc[["session_key", "seca"]], on="session_key", how="left")

# Equipo de cada piloto en cada carrera
drv = pd.read_sql("SELECT * FROM drivers", con)
col_equipo = next((c for c in ["team_name", "team"] if c in drv.columns), None)
if col_equipo and {"session_key", "driver_number"} <= set(drv.columns):
    eq = drv[["session_key", "driver_number", col_equipo]].drop_duplicates(["session_key", "driver_number"])
    eq = eq.rename(columns={col_equipo: "equipo"})
    d = d.merge(eq, on=["session_key", "driver_number"], how="left")
else:
    print("AVISO: la tabla drivers no tiene equipo por carrera. Columnas:", list(drv.columns))
    d["equipo"] = np.nan

d["planificadas"] = d["paradas_obligatorias"] + d["paradas_libres"]
d = d[(d["dnf"] == 0) & (d["dns"] == 0) & (d["dsq"] == 0) & d["position"].notna()]
d = d[(d["usa_mojado"] == 0) & (d["seca"] == 1)].copy()
print(f"Registros piloto-carrera (secas, terminaron): {len(d)} en {d['session_key'].nunique()} carreras")

# ---------- 1. ¿El circuito explica la estrategia? ----------
carrera = d.groupby("session_key").agg(
    planificadas=("planificadas", "mean"), libres=("paradas_libres", "mean"), pilotos=("driver_number", "count")
).reset_index()
carrera = carrera[carrera["pilotos"] >= 10].merge(rc, on="session_key").merge(
    carreras[["session_key", "circuit_short_name"]].rename(columns={"circuit_short_name": "circuito"}), on="session_key"
)

PISTA = ["longitud_km", "tiempo_pit_lane_s", "degradacion_s_por_vuelta", "temp_pista_media"]
ADELANTAR = ["spearman_grid_final", "cambio_posiciones_medio"]
EVENTOS = ["pct_vueltas_bandera", "n_roja", "n_sc_vsc"]
CONJUNTOS = {"A. pista": PISTA, "B. pista + adelantar": PISTA + ADELANTAR, "C. B + eventos de carrera": PISTA + ADELANTAR + EVENTOS}


def hacer_modelo(nombre):
    if nombre == "Ridge":
        return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 20)))
    return make_pipeline(
        SimpleImputer(strategy="median"), RandomForestRegressor(n_estimators=300, min_samples_leaf=3, random_state=0)
    )


def evaluar(df, feats, objetivo, nombre):
    df = df.dropna(subset=[objetivo])
    X, y, g = df[feats], df[objetivo].to_numpy(float), df["circuit_short_name"]
    pred, base = np.zeros(len(df)), np.zeros(len(df))
    for tr, te in LeaveOneGroupOut().split(X, y, g):
        m = hacer_modelo(nombre).fit(X.iloc[tr], y[tr])
        pred[te] = m.predict(X.iloc[te])
        base[te] = y[tr].mean()
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - base) ** 2).sum()
    return r2, np.abs(y - pred).mean(), np.abs(y - base).mean(), len(df)


filas = []
for objetivo in ["planificadas", "libres"]:
    for nombre_set, feats in CONJUNTOS.items():
        for modelo in ["Ridge", "RandomForest"]:
            r2, mae, mae0, n = evaluar(carrera, feats, objetivo, modelo)
            filas.append(
                {"objetivo": objetivo, "variables": nombre_set, "modelo": modelo, "R2_vs_promedio": round(r2, 3),
                 "MAE_modelo": round(mae, 3), "MAE_promedio": round(mae0, 3), "carreras": n}
            )
metricas = pd.DataFrame(filas)
metricas.to_sql("modelo_por_que", con, if_exists="replace", index=False)
print("\n1) Predicción de un circuito no visto (R2 > 0 = mejor que predecir el promedio):")
print(metricas.to_string(index=False))

feats_c = CONJUNTOS["C. B + eventos de carrera"]
dfc = carrera.dropna(subset=["planificadas"])
rf = hacer_modelo("RandomForest").fit(dfc[feats_c], dfc["planificadas"])
imp = pd.DataFrame(
    {"variable": feats_c, "importancia_rf": rf[-1].feature_importances_,
     "spearman_con_planificadas": [dfc[[f, "planificadas"]].corr(method="spearman").iloc[0, 1] for f in feats_c]}
).sort_values("importancia_rf", ascending=False).round(3)
imp.to_sql("importancias_por_que", con, if_exists="replace", index=False)
print("\nImportancia de variables (paradas planificadas por carrera):")
print(imp.to_string(index=False))

# ---------- 2. Descomposición de varianza: circuito, equipo, año ----------
def r2_ajustado(X, y):
    X = X.astype(float)
    n, p = X.shape
    r2 = LinearRegression().fit(X, y).score(X, y)
    return 1 - (1 - r2) * (n - 1) / (n - p - 1)


dv = d.dropna(subset=["equipo"]).copy()
filas = []
if len(dv) > 100:
    for objetivo in ["planificadas", "paradas_libres"]:
        y = dv[objetivo].to_numpy(float)
        bloques = {
            "circuito": pd.get_dummies(dv["circuit_short_name"], drop_first=True),
            "equipo": pd.get_dummies(dv["equipo"], drop_first=True),
            "año": pd.get_dummies(dv["year"].astype(str), drop_first=True),
        }
        completo = r2_ajustado(pd.concat(bloques.values(), axis=1), y)
        for f, Xf in bloques.items():
            sin = pd.concat([v for k, v in bloques.items() if k != f], axis=1)
            filas.append(
                {"objetivo": objetivo, "factor": f, "R2aj_solo": round(r2_ajustado(Xf, y), 3),
                 "aporte_unico": round(completo - r2_ajustado(sin, y), 3), "R2aj_todos": round(completo, 3)}
            )
    varianza = pd.DataFrame(filas)
    varianza.to_sql("varianza_factores", con, if_exists="replace", index=False)
    print("\n2) Cuánta variación explica cada factor (R2 ajustado):")
    print(varianza.to_string(index=False))
else:
    print("\n2) Sin equipo disponible: se omite la descomposición de varianza.")

# ---------- 3. Estrategia vs posiciones ganadas ----------
d["ganadas"] = d["grid"] - d["position"]
d = d.dropna(subset=["ganadas", "grid"])
for col, nuevo in [("paradas_libres", "libres_rel"), ("paradas_reactivas", "reactivas_rel")]:
    d[nuevo] = d[col] - d.groupby("session_key")[col].transform("mean")

X_cols = ["grid", "grid2", "libres_rel", "reactivas_rel"]
d["grid2"] = d["grid"] ** 2
por_carrera = {sk: g for sk, g in d.groupby("session_key")}
claves = list(por_carrera)


def coeficientes(frames):
    g = pd.concat(frames)
    X = np.column_stack([np.ones(len(g))] + [g[c].to_numpy(float) for c in X_cols])
    return np.linalg.lstsq(X, g["ganadas"].to_numpy(float), rcond=None)[0]


base = coeficientes([por_carrera[k] for k in claves])
rng = np.random.default_rng(0)
boot = np.array([coeficientes([por_carrera[k] for k in rng.choice(claves, len(claves))]) for _ in range(300)])
nombres = ["constante"] + X_cols
coef = pd.DataFrame(
    {"variable": nombres, "coeficiente": base.round(3),
     "IC95_bajo": np.percentile(boot, 2.5, axis=0).round(3), "IC95_alto": np.percentile(boot, 97.5, axis=0).round(3)}
)
coef.to_sql("estrategia_vs_posiciones", con, if_exists="replace", index=False)
print("\n3) Posiciones ganadas ~ posición de partida + paradas libres/reactivas relativas (IC bootstrap por carrera):")
print(coef.to_string(index=False))

d["grupo_parrilla"] = pd.cut(d["grid"], [0, 5, 12, 30], labels=["1-5", "6-12", "13+"])
d["libres_vs_resto"] = pd.cut(d["libres_rel"], [-9, -0.5, 0.5, 9], labels=["menos que el resto", "igual", "más que el resto"])
tabla = d.groupby(["grupo_parrilla", "libres_vs_resto"], observed=True)["ganadas"].agg(["mean", "count"]).round(2)
tabla.reset_index().to_sql("ganadas_por_estrategia", con, if_exists="replace", index=False)
print("\nPosiciones ganadas promedio según paradas libres vs el resto de la carrera:")
print(tabla.to_string())

con.close()