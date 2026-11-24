import { useEffect, useMemo, useState } from "react";
import "./Replay.css";
import MapaPista from "./MapaPista";
import { API, NEUMATICOS, colorEquipo } from "./datos";

const ANCHO = 600;
const ALTO_FILA = 38;

const ESTADOS = {
  SC: { texto: "Safety Car", color: "var(--bandera-sc)" },
  VSC: { texto: "Virtual Safety Car", color: "var(--bandera-vsc)" },
  ROJA: { texto: "Bandera roja", color: "var(--bandera-roja)" },
};

// Banderas de Race Control: el texto va siempre junto al color.
const BANDERAS = {
  RED: { texto: "Roja", color: "#ff2a2a" },
  YELLOW: { texto: "Amarilla", color: "#ffd600" },
  "DOUBLE YELLOW": { texto: "Doble amarilla", color: "#ffd600" },
  GREEN: { texto: "Verde", color: "#2ecc71" },
  CLEAR: { texto: "Pista libre", color: "#2ecc71" },
  BLUE: { texto: "Azul", color: "#5b8def" },
  CHEQUERED: { texto: "Cuadros", color: "#f0f0f0" },
  "BLACK AND WHITE": { texto: "Blanca y negra", color: "#cfcfcf" },
};
const CATEGORIAS = { SafetyCar: "Safety Car", Drs: "DRS", CarEvent: "Auto", Flag: "Bandera", Other: "Otro" };

// Pido datos a la API; si falla, devuelvo el mensaje que explica por qué.
function useApi(ruta) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDatos(null);
    setError(null);
    if (!ruta) return;
    let activo = true;
    fetch(`${API}${ruta}`)
      .then(async (r) => {
        if (!r.ok) {
          let detalle = `Error ${r.status}`;
          try {
            detalle = (await r.json()).detail || detalle;
          } catch {
            // la respuesta no traía detalle
          }
          throw new Error(detalle);
        }
        return r.json();
      })
      .then((d) => activo && setDatos(d))
      .catch((e) => activo && setError(e.message));
    return () => {
      activo = false;
    };
  }, [ruta]);

  return { datos, error };
}

// Convierte una serie de puntos en el trazo de un gráfico SVG.
function camino(t, y, duracion, maximo, alto, escalon = false) {
  let d = "";
  let previo = 0;
  for (let i = 0; i < t.length; i++) {
    if (y[i] == null) continue;
    const x = (t[i] / duracion) * ANCHO;
    const py = alto - (Math.min(y[i], maximo) / maximo) * alto;
    if (!d) d = `M${x.toFixed(1)},${py.toFixed(1)}`;
    else if (escalon) d += `L${x.toFixed(1)},${previo.toFixed(1)}L${x.toFixed(1)},${py.toFixed(1)}`;
    else d += `L${x.toFixed(1)},${py.toFixed(1)}`;
    previo = py;
  }
  return d;
}

function Grafico({ titulo, t, duracion, alto, capas, frac, onFrac }) {
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onFrac(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const x0 = (t[0] / duracion) * ANCHO;
  const x1 = (t[t.length - 1] / duracion) * ANCHO;

  return (
    <div className="grafico">
      <div className="grafico-titulo">{titulo}</div>
      <svg
        role="img"
        aria-label={`Gráfico de ${titulo.toLowerCase()} a lo largo de la vuelta`}
        viewBox={`0 0 ${ANCHO} ${alto}`}
        preserveAspectRatio="none"
        style={{ height: alto }}
        onMouseMove={mover}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={ANCHO}
            y1={alto * f}
            y2={alto * f}
            stroke="#ffffff"
            strokeOpacity="0.07"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {capas.map((c, i) => {
          const d = camino(t, c.datos, duracion, c.maximo, alto, c.escalon);
          if (!d) return null;
          return (
            <g key={i}>
              {c.relleno && (
                <path d={`${d}L${x1.toFixed(1)},${alto}L${x0.toFixed(1)},${alto}Z`} fill={c.color} opacity="0.22" />
              )}
              <path d={d} fill="none" stroke={c.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {frac != null && (
          <line
            x1={frac * ANCHO}
            x2={frac * ANCHO}
            y1="0"
            y2={alto}
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

function PanelTelemetria({ sessionKey, piloto, vuelta }) {
  const { datos, error } = useApi(
    vuelta
      ? `/telemetria?session_key=${sessionKey}&driver_number=${piloto.driver_number}&vuelta=${vuelta}`
      : null
  );
  const [frac, setFrac] = useState(null);
  const color = colorEquipo(piloto.team_name);

  // Valores exactos donde está el mouse.
  let lectura = null;
  if (datos && frac != null && datos.t.length) {
    const objetivo = frac * datos.duracion;
    let idx = 0;
    for (let i = 0; i < datos.t.length; i++) {
      if (datos.t[i] <= objetivo) idx = i;
      else break;
    }
    lectura = {
      t: datos.t[idx],
      v: datos.velocidad[idx],
      a: datos.acelerador[idx],
      f: datos.freno[idx],
      m: datos.marcha[idx],
    };
  }

  return (
    <div className="panel-tel" style={{ borderTopColor: color }}>
      <div className="panel-tel-cab">
        <b style={{ color }}>{piloto.name_acronym}</b>
        <span>{piloto.full_name}</span>
        <span className="vuelta-tel">
          Vuelta {vuelta ?? "—"}
          {datos ? ` · ${datos.duracion.toFixed(3)} s` : ""}
        </span>
      </div>

      {error && <p className="error" style={{ padding: "10px 0" }}>{error}</p>}
      {!datos && !error && (
        <p className="aviso" style={{ padding: "14px 0" }}>
          {vuelta ? "Cargando telemetría…" : "Pausa el replay para cargar la telemetría."}
        </p>
      )}
      {datos && datos.t.length === 0 && (
        <p className="aviso" style={{ padding: "14px 0" }}>OpenF1 no trae telemetría de esa vuelta.</p>
      )}

      {datos && datos.t.length > 0 && (
        <>
          <div className="lectura">
            {lectura
              ? `${lectura.v} km/h · Acelerador ${lectura.a}% · Freno ${lectura.f ? "ON" : "OFF"} · Marcha ${lectura.m} · ${lectura.t.toFixed(1)} s`
              : "Pasa el mouse sobre los gráficos para ver los valores"}
          </div>
          <div onMouseLeave={() => setFrac(null)}>
            <Grafico
              titulo="Velocidad (km/h)"
              t={datos.t}
              duracion={datos.duracion}
              alto={90}
              frac={frac}
              onFrac={setFrac}
              capas={[{ datos: datos.velocidad, maximo: 350, color, relleno: true }]}
            />
            <Grafico
              titulo="Acelerador (verde) y freno (rojo)"
              t={datos.t}
              duracion={datos.duracion}
              alto={70}
              frac={frac}
              onFrac={setFrac}
              capas={[
                { datos: datos.acelerador, maximo: 100, color: "#3ddc84", relleno: true },
                { datos: datos.freno, maximo: 100, color: "#ff4d4d", relleno: true },
              ]}
            />
            <Grafico
              titulo="Marcha"
              t={datos.t}
              duracion={datos.duracion}
              alto={50}
              frac={frac}
              onFrac={setFrac}
              capas={[{ datos: datos.marcha, maximo: 8, color: "#e6e6f0", escalon: true }]}
            />
          </div>
        </>
      )}
    </div>
  );
}

// Mensajes de Race Control hasta la vuelta actual (los más recientes primero), sincronizados con el replay.
function PanelControl({ sessionKey, vuelta }) {
  const { datos, error } = useApi(sessionKey ? `/carreras/${sessionKey}/control` : null);

  const mensajes = useMemo(
    () =>
      (datos || [])
        .map((m) => ({ ...m, v: m.vuelta == null || Number.isNaN(Number(m.vuelta)) ? 0 : Number(m.vuelta) }))
        .filter((m) => m.mensaje),
    [datos]
  );
  const hasta = mensajes.filter((m) => m.v <= vuelta).reverse();

  return (
    <div className="rc">
      <div className="grafico-titulo">Race Control · hasta la vuelta {vuelta}</div>
      {error && <p className="nota">No pude cargar los mensajes de Race Control.</p>}
      {!datos && !error && <p className="nota">Cargando mensajes…</p>}
      {datos && hasta.length === 0 && <p className="nota">Todavía no hay mensajes de Race Control.</p>}
      <ul className="rc-lista" aria-live="off">
        {hasta.slice(0, 60).map((m, i) => {
          const b = BANDERAS[m.bandera];
          return (
            <li key={`${m.fecha}-${i}`} className={m.v === vuelta ? "ahora" : ""}>
              <span className="rc-vuelta">{m.v === 0 ? "Pre" : `V${m.v}`}</span>
              <span className="rc-chip" style={{ "--c": b?.color ?? "var(--gris)" }}>
                {b?.texto ?? CATEGORIAS[m.categoria] ?? m.categoria}
              </span>
              <span className="rc-msg">{m.mensaje}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Replay({ sessionKey, carrera }) {
  const { datos, error } = useApi(sessionKey ? `/carreras/${sessionKey}/replay` : null);
  const [vuelta, setVuelta] = useState(1);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [velocidad, setVelocidad] = useState(1);
  const [seleccion, setSeleccion] = useState([]);
  const [vueltaTel, setVueltaTel] = useState(null);

  const total = datos?.vueltas?.length ?? 0;

  // Al cambiar de carrera vuelvo a la vuelta 1.
  useEffect(() => {
    setVuelta(1);
    setReproduciendo(false);
    setVueltaTel(null);
  }, [sessionKey]);

  // Cuando llegan los datos, selecciono a los dos primeros de la vuelta 1.
  useEffect(() => {
    if (!datos) return;
    const primeros = (datos.leaderboard["1"] || []).slice(0, 2).map((f) => f.driver_number);
    setSeleccion(primeros);
  }, [datos]);

  // Reproducción: avanzo una vuelta cada cierto tiempo.
  useEffect(() => {
    if (!reproduciendo || !total) return;
    const id = setInterval(() => {
      setVuelta((v) => {
        if (v >= total) {
          setReproduciendo(false);
          return v;
        }
        return v + 1;
      });
    }, 1400 / velocidad);
    return () => clearInterval(id);
  }, [reproduciendo, velocidad, total]);

  // La telemetría solo se actualiza con el replay en pausa (para no saturar OpenF1).
  useEffect(() => {
    if (reproduciendo || !total) return;
    const id = setTimeout(() => setVueltaTel(vuelta), 500);
    return () => clearTimeout(id);
  }, [vuelta, reproduciendo, total]);

  // En qué vueltas paró cada piloto.
  const paradas = useMemo(() => {
    const r = {};
    if (!datos) return r;
    Object.entries(datos.leaderboard).forEach(([v, filas]) =>
      filas.forEach((f) => {
        if (f.en_pits) {
          if (!r[f.driver_number]) r[f.driver_number] = [];
          r[f.driver_number].push(Number(v));
        }
      })
    );
    return r;
  }, [datos]);

  if (error) return <p className="error">No pude cargar el replay: {error}</p>;
  if (!datos) return <p className="aviso">Cargando replay…</p>;

  const info = datos.vueltas.find((v) => v.vuelta === vuelta);
  const filas = datos.leaderboard[String(vuelta)] || [];
  const estado = info?.estado ? ESTADOS[info.estado] : null;

  const alternar = (num) =>
    setSeleccion((s) => {
      if (s.includes(num)) return s.filter((x) => x !== num);
      return s.length >= 2 ? [s[1], num] : [...s, num];
    });

  const jugar = () => {
    if (vuelta >= total) setVuelta(1);
    setReproduciendo((r) => !r);
  };

  return (
    <section>
      <div className="replay">
        <div className="rp-izq">
          <div className="rp-cab">
            <div>
              <div className="rp-et">
                {carrera ? `${carrera.circuit_short_name} · ${carrera.year}` : "Carrera"}
              </div>
              <div className="rp-vuelta">
                Vuelta <b>{vuelta}</b>
                <span>/{total}</span>
              </div>
            </div>

            <div
              className="rp-estado"
              style={{ background: estado ? estado.color : "#1f3d2a", color: estado ? "#111" : "#6df08f" }}
            >
              {estado ? estado.texto : "Pista en verde"}
            </div>

            <div className="rp-clima">
              <div><span>Pista</span><b>{info?.temp_pista != null ? `${Math.round(info.temp_pista)}°C` : "—"}</b></div>
              <div><span>Aire</span><b>{info?.temp_aire != null ? `${Math.round(info.temp_aire)}°C` : "—"}</b></div>
              <div><span>Humedad</span><b>{info?.humedad != null ? `${Math.round(info.humedad)}%` : "—"}</b></div>
              <div><span>Viento</span><b>{info?.viento != null ? `${info.viento} m/s` : "—"}</b></div>
              <div><span>Lluvia</span><b>{info?.lluvia > 0 ? "SÍ" : "NO"}</b></div>
            </div>
          </div>

          <MapaPista circuito={carrera?.circuit_short_name} sessionKey={sessionKey} vuelta={vuelta} filas={filas} pilotos={datos.pilotos} seleccion={seleccion} colorEquipo={colorEquipo} reproduciendo={reproduciendo} velocidad={velocidad} />
          <div className="rp-controles">
            <button className="boton" aria-label="Ir a la vuelta 1" onClick={() => { setReproduciendo(false); setVuelta(1); }}>⏮</button>
            <button className="boton" aria-label="Vuelta anterior" onClick={() => setVuelta((v) => Math.max(1, v - 1))}>◀</button>
            <button className={`boton ${reproduciendo ? "activo" : ""}`} aria-pressed={reproduciendo} onClick={jugar}>
              {reproduciendo ? "⏸ Pausa" : "▶ Play"}
            </button>
            <button className="boton" aria-label="Vuelta siguiente" onClick={() => setVuelta((v) => Math.min(total, v + 1))}>▶</button>
            <button
              className="boton"
              aria-label={`Velocidad de reproducción ${velocidad} equis`}
              onClick={() => setVelocidad((v) => (v === 1 ? 2 : v === 2 ? 4 : 1))}
            >
              {velocidad}x
            </button>
          </div>

          <input
            className="rp-slider"
            aria-label="Vuelta de la carrera"
            type="range"
            min="1"
            max={total}
            value={vuelta}
            onChange={(e) => {
              setReproduciendo(false);
              setVuelta(Number(e.target.value));
            }}
          />

          <div className="tira">
            {datos.vueltas.map((v) => (
              <div
                key={v.vuelta}
                className={`celda ${v.vuelta === vuelta ? "actual" : ""}`}
                style={{ background: ESTADOS[v.estado]?.color ?? "" }}
                title={`Vuelta ${v.vuelta}${v.estado ? ` · ${ESTADOS[v.estado].texto}` : ""}`}
                onClick={() => {
                  setReproduciendo(false);
                  setVuelta(v.vuelta);
                }}
              />
            ))}
          </div>
          <div className="tira tira-paradas">
            {datos.vueltas.map((v) => (
              <div key={v.vuelta} className="celda-parada">
                {seleccion
                  .filter((d) => paradas[d]?.includes(v.vuelta))
                  .map((d) => (
                    <span
                      key={d}
                      className="punto-parada"
                      style={{ background: colorEquipo(datos.pilotos[String(d)]?.team_name) }}
                      title={`Parada de ${datos.pilotos[String(d)]?.name_acronym}`}
                    />
                  ))}
              </div>
            ))}
          </div>
          <p className="nota">
            Amarillo: Safety Car · naranja: VSC · rojo: bandera roja · puntos: paradas de los pilotos seleccionados.
          </p>

          <PanelControl sessionKey={sessionKey} vuelta={vuelta} />

          {seleccion.map((num) => {
            const piloto = datos.pilotos[String(num)];
            return piloto ? (
              <PanelTelemetria key={num} sessionKey={sessionKey} piloto={piloto} vuelta={vueltaTel} />
            ) : null;
          })}
          {seleccion.length === 0 && (
            <p className="aviso">Haz clic en un piloto del leaderboard para ver su telemetría.</p>
          )}
        </div>

        <div className="rp-der">
          <h3 className="titulo" style={{ fontSize: 16 }}>Leaderboard</h3>
          <div className="tower" style={{ height: filas.length * ALTO_FILA }}>
            {filas.map((f) => {
              const p = datos.pilotos[String(f.driver_number)];
              const neu = NEUMATICOS[f.neumatico];
              return (
                <div
                  key={f.driver_number}
                  className={`lb-fila ${seleccion.includes(f.driver_number) ? "sel" : ""} ${f.fuera ? "fuera" : ""}`}
                  style={{
                    transform: `translateY(${(f.posicion - 1) * ALTO_FILA}px)`,
                    "--equipo": colorEquipo(p?.team_name),
                  }}
                  role="button" tabIndex={0}
                  aria-pressed={seleccion.includes(f.driver_number)}
                  aria-label={`Posición ${f.posicion}, ${p?.name_acronym ?? f.driver_number}`}
                  onClick={() => alternar(f.driver_number)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), alternar(f.driver_number))}
                >
                  <span className="lb-pos">{f.posicion}</span>
                  <span className="lb-nombre">{p?.name_acronym ?? f.driver_number}</span>
                  <span className="lb-equipo">{p?.team_name}</span>
                  <span className="lb-neu">
                    <i style={{ borderColor: neu?.color || "#666", color: neu?.color || "#666" }}>
                      {neu?.letra || "?"}
                    </i>
                    {f.edad != null ? Math.round(f.edad) : ""}
                  </span>
                  {f.fuera ? <span className="lb-tag out">OUT</span> : f.en_pits ? <span className="lb-tag pit">PIT</span> : null}
                </div>
              );
            })}
          </div>
          <p className="nota" style={{ marginTop: 10 }}>
            Orden en pista. Clic en un piloto para ver su telemetría (máximo 2). En la última vuelta
            puede diferir del resultado oficial por sanciones posteriores.
          </p>
        </div>
      </div>
    </section>
  );
}
