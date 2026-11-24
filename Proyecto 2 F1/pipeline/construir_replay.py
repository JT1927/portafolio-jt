import sqlite3
from pathlib import Path

import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
con = sqlite3.connect(RUTA_DB)


def fechas(serie):
    # Convierto texto a fecha con zona horaria UTC.
    return pd.to_datetime(serie, utc=True, format="ISO8601").dt.as_unit("ns")


# --- 1. Cargo las tablas que necesito ---------------------------------------
vueltas = pd.read_sql("SELECT * FROM vueltas", con)
posicion = pd.read_sql("SELECT * FROM posicion", con)
stints = pd.read_sql(
    "SELECT session_key, driver_number, lap_start, lap_end, compound, tyre_age_at_start "
    "FROM stints", con)
control = pd.read_sql("SELECT session_key, date, flag, message FROM control", con)
clima = pd.read_sql(
    "SELECT session_key, date, rainfall, track_temperature, air_temperature, "
    "humidity, wind_speed FROM clima", con)
res = pd.read_sql("SELECT session_key, driver_number, position, dnf FROM resultado", con)

# Fechas y números en su formato correcto.
vueltas["date_start"] = fechas(vueltas["date_start"])
vueltas["lap_duration"] = pd.to_numeric(vueltas["lap_duration"], errors="coerce")
posicion["date"] = fechas(posicion["date"])
posicion["position"] = pd.to_numeric(posicion["position"], errors="coerce")
control["date"] = fechas(control["date"])
clima["date"] = fechas(clima["date"])
for col in ["lap_start", "lap_end", "tyre_age_at_start"]:
    stints[col] = pd.to_numeric(stints[col], errors="coerce")
res["position"] = pd.to_numeric(res["position"], errors="coerce")

lista_pilotos, lista_info = [], []

# --- 2. Una carrera a la vez ------------------------------------------------
for sk, v in vueltas.groupby("session_key"):
    v = v.sort_values(["driver_number", "lap_number"]).copy()

    # Cuándo termina cada vuelta de cada piloto: cuando empieza la siguiente
    # o, en la última, inicio + duración.
    v["fin"] = v.groupby("driver_number")["date_start"].shift(-1)
    falta = v["fin"].isna() & v["date_start"].notna() & v["lap_duration"].notna()
    v.loc[falta, "fin"] = v.loc[falta, "date_start"] + pd.to_timedelta(
        v.loc[falta, "lap_duration"], unit="s")

    # La foto de cada vuelta: cuando el primer auto la completa.
    t = v.dropna(subset=["fin"]).groupby("lap_number")["fin"].min().sort_index().cummax()
    if t.empty:
        continue
    # En la última vuelta espero al último auto, para que la foto sea el resultado final.
    t.iloc[-1] = v["fin"].max()

    # Pilotos que abandonaron: quedan "fuera" después de su última vuelta.
    r = res[res["session_key"] == sk]
    abandonaron = set(r.loc[r["dnf"] == 1, "driver_number"])
    ultima_vuelta = v.groupby("driver_number")["lap_number"].max()

    # Tabla base: una fila por vuelta y piloto.
    grid = pd.MultiIndex.from_product(
        [t.index, ultima_vuelta.index], names=["vuelta", "driver_number"]
    ).to_frame(index=False)
    grid["t"] = grid["vuelta"].map(t)
    grid["fuera"] = (
        (grid["vuelta"] > grid["driver_number"].map(ultima_vuelta))
        & grid["driver_number"].isin(abandonaron)
    ).astype(int)

    # Posición de cada piloto en ese instante: su último registro anterior.
    p = posicion[posicion["session_key"] == sk].sort_values("date")
    grid = grid.sort_values("t")
    grid = pd.merge_asof(
        grid, p[["date", "driver_number", "position"]],
        left_on="t", right_on="date", by="driver_number", direction="backward")

    # Ordeno el leaderboard: los que siguen en carrera primero, y numero 1, 2, 3...
    grid = grid.sort_values(["vuelta", "fuera", "position", "driver_number"])
    grid["posicion"] = grid.groupby("vuelta").cumcount() + 1

    # Neumático y edad en cada vuelta, según el stint que correspondía.
    s = stints[stints["session_key"] == sk].sort_values(["driver_number", "lap_start"]).copy()
    base = grid[["vuelta", "driver_number"]].merge(s, on="driver_number")
    base["lap_end"] = base["lap_end"].fillna(9999)
    base = base[(base["vuelta"] >= base["lap_start"]) & (base["vuelta"] <= base["lap_end"])]
    base = base.sort_values("lap_start").drop_duplicates(["vuelta", "driver_number"], keep="last")
    base["edad"] = base["tyre_age_at_start"].fillna(0) + (base["vuelta"] - base["lap_start"])
    base = base.rename(columns={"compound": "neumatico"})
    grid = grid.merge(base[["vuelta", "driver_number", "neumatico", "edad"]],
                      on=["vuelta", "driver_number"], how="left")

    # Vuelta de parada: donde termina un stint que no es el último de ese piloto.
    s["es_ultimo"] = s.groupby("driver_number")["lap_start"].transform("max") == s["lap_start"]
    paradas = s.loc[~s["es_ultimo"], ["driver_number", "lap_end"]].dropna()
    paradas = paradas.rename(columns={"lap_end": "vuelta"}).astype({"vuelta": int})
    paradas["en_pits"] = 1
    grid = grid.merge(paradas.drop_duplicates(["vuelta", "driver_number"]),
                      on=["vuelta", "driver_number"], how="left")
    grid["en_pits"] = grid["en_pits"].fillna(0).astype(int)

    grid["session_key"] = sk
    lista_pilotos.append(grid[["session_key", "vuelta", "driver_number", "posicion",
                               "fuera", "neumatico", "edad", "en_pits"]])

    # Información de cada vuelta: hora, clima y estado de la pista.
    info = t.reset_index().rename(columns={"lap_number": "vuelta", "fin": "t"})
    info = info.sort_values("t")
    c = clima[clima["session_key"] == sk].sort_values("date")
    if c.empty:
        for col in ["rainfall", "track_temperature", "air_temperature", "humidity", "wind_speed"]:
            info[col] = None
    else:
        info = pd.merge_asof(
            info,
            c[["date", "rainfall", "track_temperature", "air_temperature", "humidity", "wind_speed"]],
            left_on="t", right_on="date", direction="backward")
    info = info.sort_values("vuelta").reset_index(drop=True)

    # Estado de la pista (Safety Car, VSC, bandera roja) recorriendo los eventos en orden.
    ev = control[control["session_key"] == sk].sort_values("date")
    eventos = list(zip(ev["date"], ev["flag"], ev["message"].fillna("")))
    i, estado, estados = 0, "", []
    for fin in info["t"]:
        termina_sc, roja = False, False
        while i < len(eventos) and eventos[i][0] <= fin:
            _, bandera, msg = eventos[i]
            if msg == "SAFETY CAR DEPLOYED":
                estado = "SC"
            elif msg == "VIRTUAL SAFETY CAR DEPLOYED":
                estado = "VSC"
            elif "SAFETY CAR IN THIS LAP" in msg:
                termina_sc = True
            elif "VIRTUAL SAFETY CAR ENDING" in msg:
                estado = ""
            if bandera == "RED":
                roja = True
            i += 1
        estados.append("ROJA" if roja else estado)
        if termina_sc:
            estado = ""
    info["estado"] = estados
    info["session_key"] = sk
    info["t"] = info["t"].astype(str)
    lista_info.append(info.rename(columns={
        "rainfall": "lluvia", "track_temperature": "temp_pista",
        "air_temperature": "temp_aire", "humidity": "humedad", "wind_speed": "viento",
    })[["session_key", "vuelta", "t", "estado", "lluvia", "temp_pista",
        "temp_aire", "humedad", "viento"]])

# --- 3. Guardo en la base ---------------------------------------------------
pilotos = pd.concat(lista_pilotos, ignore_index=True)
info_vueltas = pd.concat(lista_info, ignore_index=True)
pilotos.to_sql("replay_pilotos", con, if_exists="replace", index=False)
info_vueltas.to_sql("replay_vueltas", con, if_exists="replace", index=False)

print("replay_pilotos:", pilotos.shape)
print("replay_vueltas:", info_vueltas.shape)
print("Vueltas con Safety Car / VSC / bandera roja:",
      (info_vueltas["estado"] == "SC").sum(), "/",
      (info_vueltas["estado"] == "VSC").sum(), "/",
      (info_vueltas["estado"] == "ROJA").sum(), "\n")

# --- 4. Validación: la última foto debe coincidir con el resultado oficial --
ultimo = pilotos[pilotos["vuelta"] == pilotos.groupby("session_key")["vuelta"].transform("max")]
chk = ultimo.merge(
    res[["session_key", "driver_number", "position"]].rename(columns={"position": "pos_final"}),
    on=["session_key", "driver_number"]).dropna(subset=["pos_final"])
chk["ok"] = chk["posicion"] == chk["pos_final"]
print("Coincidencia del orden final del replay con el resultado oficial:", round(chk["ok"].mean(), 3))

peores = chk.groupby("session_key")["ok"].mean().sort_values().head(5)
carreras = pd.read_sql("SELECT session_key, year, circuit_short_name FROM carreras", con).set_index("session_key")
print("\nLas 5 carreras con menos coincidencia:")
print(carreras.loc[peores.index].assign(coincidencia=peores.round(2)))

# Muestra: top 5 de la última vuelta de Interlagos 2026.
nombres = pd.read_sql("SELECT DISTINCT session_key, driver_number, full_name FROM drivers", con)
muestra = pilotos[(pilotos["session_key"] == 11412)]
muestra = muestra[muestra["vuelta"] == muestra["vuelta"].max()].merge(
    nombres, on=["session_key", "driver_number"]).sort_values("posicion").head(5)
print("\nInterlagos 2026, última vuelta (top 5):")
print(muestra[["posicion", "full_name", "neumatico", "edad"]].to_string(index=False))

con.close()