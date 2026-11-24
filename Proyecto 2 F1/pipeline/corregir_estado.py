# Recalcula el estado de cada vuelta (SC, VSC, ROJA) usando los mensajes de Race Control,
# y guarda las ventanas de tiempo de cada bandera en la tabla ventanas_bandera.
# Reglas:
#  - El Safety Car termina con "SAFETY CAR IN THIS LAP", o cuando llega una bandera roja.
#  - El VSC termina con "VIRTUAL SAFETY CAR ENDING" / "VSC ENDING", o cuando llega un Safety Car
#    (así se convierte en OpenF1) o una bandera roja.
#  - La bandera roja dura hasta los mensajes de reanudación (RESUME / RESUMPTION / ORDER FOR RESTART).
#  - Si hay varios estados en una vuelta, manda ROJA, luego SC y luego VSC.
# Deja un respaldo del estado anterior en la tabla replay_vueltas_respaldo.
import re
import sqlite3
from pathlib import Path

import pandas as pd

RUTA_DB = Path(__file__).resolve().parent.parent / "data" / "f1.db"
MARGEN_SC = 90   # segundos extra al terminar un Safety Car (los autos siguen entrando a boxes)
MARGEN_VSC = 60

con = sqlite3.connect(RUTA_DB)

vueltas = pd.read_sql("SELECT * FROM replay_vueltas", con)
control = pd.read_sql(
    "SELECT session_key, date, lap_number, category, flag, scope, message FROM control", con
)
control["lap_number"] = pd.to_numeric(control["lap_number"], errors="coerce")
control["message"] = control["message"].fillna("")
control["hora"] = pd.to_datetime(control["date"], utc=True, format="ISO8601")

existe = pd.read_sql(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='replay_vueltas_respaldo'", con
)
if existe.empty:
    vueltas.to_sql("replay_vueltas_respaldo", con, index=False)
    print("Respaldo guardado en replay_vueltas_respaldo")


def es_rojo(flag, scope, texto):
    if "INFRINGEMENT" in texto or "INCIDENT" in texto or "STEWARDS" in texto:
        return False
    return (flag == "RED" and scope != "Sector") or texto.startswith("RED FLAG")


def es_reanudacion(texto):
    return "RESUME" in texto or "RESUMPTION" in texto or "ORDER FOR RESTART" in texto


def hora_reanudacion(texto, hora_msg):
    # "RACE WILL RESUME AT 17:12" viene en hora local; se prueba cada huso y se elige
    # el que deja la hora de reanudación justo después del mensaje.
    m = re.search(r"RESUME AT (\d{1,2}):(\d{2})", texto)
    if not m:
        return None
    hh, mm = int(m.group(1)), int(m.group(2))
    medianoche = hora_msg.normalize()
    mejor = None
    for huso in range(-12, 15):
        cand = medianoche + pd.Timedelta(hours=hh - huso, minutes=mm)
        dif = (cand - hora_msg).total_seconds()
        if dif >= -120 and (mejor is None or dif < mejor[0]):
            mejor = (dif, cand)
    if mejor is None or mejor[0] > 3 * 3600:
        return None
    return mejor[1]


def calcular(msgs, total):
    sc, vsc, rojo = set(), set(), set()
    ventanas = []
    if msgs.empty:
        return sc, vsc, rojo, ventanas

    msgs = msgs.sort_values("hora").copy()
    msgs["lap"] = msgs["lap_number"].ffill().fillna(1).astype(int)

    def cerrar(tipo, abierto, lap_fin, hora_fin, margen, conjunto):
        if abierto is None:
            return None
        conjunto.update(range(abierto["lap"], max(abierto["lap"], lap_fin) + 1))
        ventanas.append((tipo, abierto["t"], hora_fin + pd.Timedelta(seconds=margen)))
        return None

    def cerrar_rojo(abierto):
        if abierto is None:
            return None
        rojo.update(range(abierto["lap_ini"], abierto["lap_fin"] + 1))
        fin = abierto["fin_t"] or (abierto["ultima"] + pd.Timedelta(minutes=10))
        ventanas.append(("ROJA", abierto["t"], max(fin, abierto["t"])))
        return None

    sc_a, vsc_a, rojo_a = None, None, None
    fin_carrera = None

    for flag, scope, texto, lap, hora in zip(
        msgs["flag"], msgs["scope"], msgs["message"].str.upper(), msgs["lap"], msgs["hora"]
    ):
        if es_rojo(flag, scope, texto):
            sc_a = cerrar("SC", sc_a, lap - 1, hora, 0, sc)
            vsc_a = cerrar("VSC", vsc_a, lap - 1, hora, 0, vsc)
            if rojo_a is None:
                rojo_a = {"lap_ini": lap, "lap_fin": lap, "t": hora, "fin_t": None, "ultima": hora}
            else:
                rojo_a["lap_fin"] = max(rojo_a["lap_fin"], lap)
                rojo_a["ultima"] = hora
        elif rojo_a is not None and es_reanudacion(texto):
            rojo_a["lap_fin"] = max(rojo_a["lap_fin"], lap)
            rojo_a["ultima"] = hora
            h = hora_reanudacion(texto, hora)
            cand = h if h is not None else hora
            rojo_a["fin_t"] = cand if rojo_a["fin_t"] is None else max(rojo_a["fin_t"], cand)
        elif "VIRTUAL SAFETY CAR DEPLOYED" in texto or "VSC DEPLOYED" in texto:
            rojo_a = cerrar_rojo(rojo_a)
            if vsc_a is None:
                vsc_a = {"lap": lap, "t": hora}
        elif "VIRTUAL SAFETY CAR ENDING" in texto or "VSC ENDING" in texto:
            vsc_a = cerrar("VSC", vsc_a, lap, hora, MARGEN_VSC, vsc)
        elif "SAFETY CAR DEPLOYED" in texto:
            rojo_a = cerrar_rojo(rojo_a)
            vsc_a = cerrar("VSC", vsc_a, lap - 1, hora, 0, vsc)  # el VSC se convierte en Safety Car
            if sc_a is None:
                sc_a = {"lap": lap, "t": hora}
        elif "SAFETY CAR IN THIS LAP" in texto:
            sc_a = cerrar("SC", sc_a, lap, hora, MARGEN_SC, sc)
        elif flag == "CHEQUERED":
            fin_carrera = hora
            break

    fin = fin_carrera if fin_carrera is not None else msgs["hora"].iloc[-1]
    rojo_a = cerrar_rojo(rojo_a)
    sc_a = cerrar("SC", sc_a, total, fin, 0, sc)
    vsc_a = cerrar("VSC", vsc_a, total, fin, 0, vsc)
    return sc, vsc, rojo, ventanas


nuevo = {}
filas_ventanas = []
for sk, g in vueltas.groupby("session_key"):
    total = int(g["vuelta"].max())
    sc, vsc, rojo, ventanas = calcular(control[control["session_key"] == sk], total)
    for v in g["vuelta"]:
        v = int(v)
        nuevo[(int(sk), v)] = "ROJA" if v in rojo else "SC" if v in sc else "VSC" if v in vsc else ""
    for tipo, ini, fin in ventanas:
        filas_ventanas.append(
            {"session_key": int(sk), "tipo": tipo, "inicio": ini.isoformat(), "fin": fin.isoformat()}
        )

vueltas["estado"] = [nuevo[(int(s), int(v))] for s, v in zip(vueltas["session_key"], vueltas["vuelta"])]
vueltas.to_sql("replay_vueltas", con, if_exists="replace", index=False)
ventanas_df = pd.DataFrame(filas_ventanas)
ventanas_df.to_sql("ventanas_bandera", con, if_exists="replace", index=False)

# ---------- Validación ----------
pd.set_option("display.width", 160)
carreras = pd.read_sql("SELECT session_key, circuit_short_name, date_start FROM carreras", con)
carreras["year"] = carreras["date_start"].str[:4].astype(int)

vueltas["bandera"] = vueltas["estado"] != ""
rachas = []
for s, g in vueltas.sort_values(["session_key", "vuelta"]).groupby("session_key"):
    total = int(g["vuelta"].max())
    inicio = None
    for v, b in zip(g["vuelta"], g["bandera"]):
        if b and inicio is None:
            inicio = int(v)
        if (not b) and inicio is not None:
            rachas.append((int(s), inicio, int(v) - inicio, total))
            inicio = None
    if inicio is not None:
        rachas.append((int(s), inicio, total - inicio + 1, total))

r = pd.DataFrame(rachas, columns=["session_key", "desde_vuelta", "largo", "total_vueltas"])
r["hasta_el_final"] = (r["desde_vuelta"] + r["largo"] - 1) == r["total_vueltas"]
r = r.merge(carreras[["session_key", "circuit_short_name", "year"]], on="session_key")

print("\nVueltas por estado:")
print(vueltas["estado"].replace("", "verde").value_counts())
print("\nVentanas de bandera por tipo:")
print(ventanas_df["tipo"].value_counts())
print("\nRachas de bandera más largas:")
print(r.sort_values("largo", ascending=False).head(8)[["year", "circuit_short_name", "desde_vuelta", "largo", "total_vueltas", "hasta_el_final"]].to_string(index=False))
print(f"\nRachas de 8 vueltas o más: {int((r['largo'] >= 8).sum())} de {len(r)}")

for circuito, anio in [("Shanghai", 2024), ("Kuala Lumpur", 2026), ("Monte Carlo", 2026)]:
    sk = int(carreras[(carreras["circuit_short_name"] == circuito) & (carreras["year"] == anio)].iloc[0]["session_key"])
    estados = {v: e for (s, v), e in nuevo.items() if s == sk and e}
    print(f"\n{circuito} {anio}: {estados}")
    print(ventanas_df[ventanas_df["session_key"] == sk].to_string(index=False))

con.close()