import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = "http://127.0.0.1:8000";
const ANCHO = 520;
const PAD = 24;
const MS_POR_VUELTA = 1400; // igual que el avance del Replay a 1x

export default function MapaPista({
  circuito,
  sessionKey,
  vuelta,
  filas,
  pilotos,
  seleccion,
  colorEquipo,
  reproduciendo,
  velocidad,
}) {
  const [pista, setPista] = useState(null);
  const [serie, setSerie] = useState(null);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState({});

  const fracc = useRef(0); // qué parte de la vuelta va (0 a 1)
  const inicio = useRef(0);
  const vueltaRef = useRef(vuelta);
  vueltaRef.current = vuelta;

  // Trazado del circuito.
  useEffect(() => {
    setPista(null);
    if (!circuito) return;
    let activo = true;
    fetch(`${API}/pista/${encodeURIComponent(circuito)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => activo && setPista(d))
      .catch(() => activo && setPista(null));
    return () => {
      activo = false;
    };
  }, [circuito]);

  // Posiciones de toda la carrera (la primera vez demora, después es instantáneo).
  useEffect(() => {
    setSerie(null);
    setError(null);
    setPos({});
    if (!sessionKey) return;
    let activo = true;
    let espera;
    // Si la descarga falla (red, límite de OpenF1), se reintenta unas veces antes de rendirse.
    const intentar = (n) => {
      fetch(`${API}/mapa/${sessionKey}`)
        .then((r) => {
          if (r.status === 404) {
            const e = new Error("No hay posiciones disponibles para esta carrera");
            e.final = true;
            throw e;
          }
          if (!r.ok) throw new Error("No se pudo preparar el mapa de esta carrera");
          return r.json();
        })
        .then((d) => activo && setSerie(d))
        .catch((e) => {
          if (!activo) return;
          if (!e.final && n < 3) espera = setTimeout(() => intentar(n + 1), 5000);
          else setError(e.final ? e.message : "No se pudo preparar el mapa de esta carrera, recarga para reintentar");
        });
    };
    intentar(1);
    return () => {
      activo = false;
      clearTimeout(espera);
    };
  }, [sessionKey]);

  // Posición de cada auto en una vuelta, a cierta altura de ella (f de 0 a 1).
  const calcular = useCallback(
    (v, f) => {
      if (!serie) return {};
      const a = serie.tv[String(v)];
      if (a == null) return {};
      const b = serie.tv[String(v + 1)] ?? a;
      const tau = a + (b - a) * f;
      const u = Math.max(0, Math.min(tau / serie.paso, serie.n - 1));
      const i = Math.floor(u);
      const j = Math.min(i + 1, serie.n - 1);
      const m = u - i;
      const salida = {};
      Object.entries(serie.pilotos).forEach(([num, p]) => {
        salida[num] = {
          x: p.x[i] + (p.x[j] - p.x[i]) * m,
          y: p.y[i] + (p.y[j] - p.y[i]) * m,
        };
      });
      return salida;
    },
    [serie]
  );

  // Al cambiar de vuelta, la animación parte desde el comienzo de esa vuelta.
  useEffect(() => {
    fracc.current = 0;
    inicio.current = performance.now();
    if (serie) setPos(calcular(vuelta, 0));
  }, [vuelta, serie, calcular]);

  // Mientras se reproduce, los autos avanzan de forma continua durante la vuelta.
  useEffect(() => {
    if (!reproduciendo || !serie) return;
    const duracion = MS_POR_VUELTA / velocidad;
    inicio.current = performance.now() - fracc.current * duracion;
    let id;
    const paso = (ahora) => {
      fracc.current = Math.min(1, (ahora - inicio.current) / duracion);
      setPos(calcular(vueltaRef.current, fracc.current));
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [reproduciendo, velocidad, serie, calcular]);

  // Escala del trazado al tamaño del dibujo (el eje Y se invierte).
  const geo = useMemo(() => {
    if (!pista) return null;
    const minX = Math.min(...pista.x);
    const maxX = Math.max(...pista.x);
    const minY = Math.min(...pista.y);
    const maxY = Math.max(...pista.y);
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    const esc = Math.min((ANCHO - 2 * PAD) / dx, (380 - 2 * PAD) / dy);
    const offX = (ANCHO - dx * esc) / 2;
    const punto = (x, y) => [offX + (x - minX) * esc, PAD + (maxY - y) * esc];
    const puntos = pista.x.map((x, i) => punto(x, pista.y[i]));
    const trazo = puntos.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("") + "Z";
    return { punto, trazo, inicio: puntos[0], alto: dy * esc + 2 * PAD };
  }, [pista]);

  if (!circuito) return null;

  return (
    <div className="mapa">
      <div className="grafico-titulo">Mapa de pista · vuelta {vuelta}</div>
      {!geo ? (
        <p className="aviso">Sin trazado para este circuito.</p>
      ) : (
        <svg viewBox={`0 0 ${ANCHO} ${geo.alto}`}>
          <path d={geo.trazo} fill="none" stroke="#f2f2f8" strokeWidth="10" strokeLinejoin="round" />
          <path d={geo.trazo} fill="none" stroke="#15151e" strokeWidth="6" strokeLinejoin="round" />
          <circle cx={geo.inicio[0]} cy={geo.inicio[1]} r="4" fill="#fff" stroke="#e10600" strokeWidth="2" />

          {filas
            .filter((f) => !f.fuera && pos[String(f.driver_number)])
            .map((f) => {
              const p = pos[String(f.driver_number)];
              const [px, py] = geo.punto(p.x, p.y);
              const elegido = seleccion.includes(f.driver_number);
              const info = pilotos[String(f.driver_number)];
              return (
                <g key={f.driver_number} style={{ transform: `translate(${px}px, ${py}px)` }}>
                  <circle
                    r={elegido ? 8 : 6.5}
                    fill={colorEquipo(info?.team_name)}
                    stroke={elegido ? "#fff" : "#111"}
                    strokeWidth={elegido ? 2.5 : 1.5}
                  />
                  {(elegido || f.posicion <= 3) && (
                    <text y="-11" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">
                      {info?.name_acronym}
                    </text>
                  )}
                </g>
              );
            })}
        </svg>
      )}
      {!serie && !error && (
        <p className="nota">
          Preparando el mapa de esta carrera… la primera vez demora cerca de 1 minuto; después es instantáneo.
        </p>
      )}
      {error && <p className="nota">{error}</p>}
    </div>
  );
}