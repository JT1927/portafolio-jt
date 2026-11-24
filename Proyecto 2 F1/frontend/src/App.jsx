import { useEffect, useMemo, useRef, useState } from "react";
import "./tokens.css";
import "./App.css";
import Replay from "./Replay";
import Inicio from "./Inicio";
import Analisis from "./Analisis";
import Diagnostico from "./Diagnostico";
import Equipos from "./Equipos";
import Circuitos from "./Circuitos";
import PorQue from "./PorQue";
import { BotonPNG, CabeceraTV, Esqueleto, Tip, Vacio } from "./comun";
import { NEUMATICOS, ROLES, ROL_POR_NOMBRE, colorEquipo, separarNombre, useApi, useTip } from "./datos";

// El color de una estrategia depende de cuántas paradas hizo el piloto (también va escrito en el nombre).
const colorParadas = (n) => (n === 0 ? "#9a9aa8" : n === 1 ? "#00d2be" : n === 2 ? "#ff8700" : "#ff5a52");

const posicionesGanadas = (p) =>
  p.pos_largada != null && p.pos_final != null ? p.pos_largada - p.pos_final : null;

function claseEvento(e) {
  if (e.bandera === "RED") return "roja";
  if ((e.mensaje || "").includes("VIRTUAL")) return "vsc";
  return "sc";
}

function metricas(p, total) {
  const largos = p.stints.map((s) => (s.vuelta_fin ?? total) - (s.vuelta_inicio ?? 1) + 1);
  return {
    stintLargo: largos.length ? Math.max(...largos) : null,
    primeraParada: p.stints.length > 1 ? p.stints[0].vuelta_fin : null,
  };
}

const CONTEXTO = { verde: "bandera verde", SC: "bajo Safety Car", VSC: "bajo VSC", ROJA: "bajo bandera roja", vuelta1: "vuelta 1" };

function Leyenda() {
  return (
    <div className="leyenda">
      {Object.entries(NEUMATICOS).map(([nombre, n]) => (
        <span className="leyenda-item" key={nombre}>
          <span className="punto" style={{ background: n.color }} />
          {n.letra} · {n.nombre}
        </span>
      ))}
      <span className="leyenda-item"><span className="marca sc" /> Safety Car</span>
      <span className="leyenda-item"><span className="marca vsc" /> VSC</span>
      <span className="leyenda-item"><span className="marca roja" /> Bandera roja</span>
    </div>
  );
}

function LeyendaRoles() {
  return (
    <div className="leyenda">
      <span className="leyenda-item"><b>Paradas:</b></span>
      {ROLES.map((r) => (
        <span className="leyenda-item" key={r.id} title={r.ayuda}>
          <span className="punto" style={{ background: r.color }} /> {r.nombre}
        </span>
      ))}
    </div>
  );
}

// Fichas con el desglose de paradas de un piloto: solo los roles que tuvo.
function Desglose({ desglose }) {
  const fichas = ROLES.filter((r) => desglose[r.rol] > 0);
  if (!fichas.length) return <span className="desglose sin">sin paradas</span>;
  return (
    <span className="desglose">
      {fichas.map((r) => (
        <span className="ficha" key={r.rol} style={{ "--c": r.color }} aria-label={`${desglose[r.rol]} ${r.nombre.toLowerCase()}`}>
          <i />
          {desglose[r.rol]} {r.corto}
        </span>
      ))}
    </span>
  );
}

// Línea de neumáticos de un piloto: barras por stint + marcas de Safety Car.
function LineaNeumaticos({ piloto, total, marcas, tipProps }) {
  const n = piloto.stints.length;
  return (
    <div className="linea" style={{ backgroundSize: `${(10 / total) * 100}% 100%` }}>
      {piloto.stints.map((s, i) => {
        const ini = s.vuelta_inicio ?? 1;
        const fin = s.vuelta_fin ?? total;
        const ancho = ((fin - ini + 1) / total) * 100;
        if (fin < ini) return null; // stint vacío: solo cuenta como cambio de compuesto
        const neu = NEUMATICOS[s.neumatico];
        const esUltimo = i === n - 1;
        return (
          <div
            key={`${piloto.driver_number}-${s.stint}`}
            className="stint"
            style={{
              left: `${((ini - 1) / total) * 100}%`,
              width: `${ancho}%`,
              background: neu?.color || "#666",
              animationDelay: `${i * 120}ms`,
            }}
            {...tipProps(<><b>{neu?.nombre ?? s.neumatico}</b><span>Vueltas {ini} a {fin} ({fin - ini + 1})</span></>)}
          >
            <span className="s-letra">{neu?.letra || "?"}</span>
            {!esUltimo && ancho > 7 && <span className="s-fin">V{fin}</span>}
          </div>
        );
      })}
      {marcas.map((e, i) => (
        <div
          key={i}
          className={`evento ${claseEvento(e)}`}
          style={{ left: `${((e.vuelta - 1) / total) * 100}%` }}
          {...tipProps(<><b>Vuelta {e.vuelta}</b><span>{e.mensaje || "Bandera roja"}</span></>)}
        />
      ))}
    </div>
  );
}

function ResumenCarrera({ carrera, pilotos, marcas, total }) {
  const ganador = pilotos.find((p) => p.pos_final === 1);
  const sc = marcas.filter((e) => claseEvento(e) === "sc").length;
  const vsc = marcas.filter((e) => claseEvento(e) === "vsc").length;
  const rojas = marcas.filter((e) => claseEvento(e) === "roja").length;

  const conteo = {};
  pilotos.forEach((p) => {
    conteo[p.estrategia] = (conteo[p.estrategia] || 0) + 1;
  });
  const top = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];

  const paradasTotal = pilotos.reduce((a, p) => a + p.paradas, 0);
  const paradasProm = pilotos.length ? paradasTotal / pilotos.length : 0;
  const libres = pilotos.reduce((a, p) => a + p.desglose.libre, 0);
  const mojada = pilotos.some((p) => p.mojada === 1);
  const g = ganador ? separarNombre(ganador.full_name) : null;
  const topPilotos = top ? pilotos.find((p) => p.estrategia === top[0]) : null;

  return (
    <>
      {carrera && (
        <CabeceraTV etiqueta={`${carrera.country_name} · ${carrera.date_start.slice(0, 10)}`} titulo={carrera.circuit_short_name} />
      )}
      <div className="cards">
        <div className="card" style={{ "--i": 0 }}>
          <div className="et">Ganador</div>
          <div className="valor">{g ? g.apellido : "—"}</div>
          <div className="sub2">{ganador?.team_name}</div>
        </div>
        <div className="card" style={{ "--i": 1 }}>
          <div className="et">Vueltas</div>
          <div className="valor">{total}</div>
          <div className="sub2">{mojada ? "Pista mojada" : "Pista seca"}</div>
        </div>
        <div className="card" style={{ "--i": 2 }}>
          <div className="et">Safety Car / VSC</div>
          <div className="valor">{sc} / {vsc}</div>
          <div className="sub2">{rojas > 0 ? `${rojas} bandera(s) roja(s)` : "Sin banderas rojas"}</div>
        </div>
        <div className="card" style={{ "--i": 3 }}>
          <div className="et">Estrategia más usada</div>
          <div className="valor" style={{ fontSize: 17, color: topPilotos ? colorParadas(topPilotos.paradas) : "#fff" }}>
            {top ? top[0] : "—"}
          </div>
          <div className="sub2">{top ? `${top[1]} de ${pilotos.length} pilotos` : ""}</div>
        </div>
        <div className="card" style={{ "--i": 4 }}>
          <div className="et">Paradas por piloto</div>
          <div className="valor">{paradasProm.toFixed(1).replace(".", ",")}</div>
          <div className="sub2">{libres} libres de {paradasTotal} paradas</div>
        </div>
      </div>
    </>
  );
}

function Comparacion({ a, b, total, marcas, tipProps }) {
  if (!a) {
    return (
      <div className="comparacion">
        <p className="nota">Modo comparar: haz clic en dos pilotos de la tabla.</p>
      </div>
    );
  }

  const pilotos = [a, b];
  const filas = [
    ["Largada", (p) => `P${p.pos_largada ?? "?"}`],
    ["Final", (p) => p.pos_final ?? (p.dnf ? "DNF" : "—")],
    ["Posiciones ganadas", (p) => {
      const d = posicionesGanadas(p);
      return d == null ? "—" : d > 0 ? `+${d}` : `${d}`;
    }],
    ["Estrategia", (p) => p.estrategia],
    ["Desglose de paradas", (p) => <Desglose desglose={p.desglose} />],
    ["Vuelta 1ª parada", (p) => metricas(p, total).primeraParada ?? "—"],
    ["Stint más largo", (p) => {
      const m = metricas(p, total).stintLargo;
      return m ? `${m} vueltas` : "—";
    }],
  ];

  return (
    <div className="comparacion">
      <div className="comp-grid">
        {pilotos.map((p, i) =>
          p ? (
            <div key={p.driver_number}>
              <div className="comp-cab">
                <b style={{ color: colorEquipo(p.team_name), fontSize: 22 }}>{separarNombre(p.full_name).apellido}</b>
                <span className="equipo-txt">{p.team_name}</span>
              </div>
              <LineaNeumaticos piloto={p} total={total} marcas={marcas} tipProps={tipProps} />
            </div>
          ) : (
            <div key={`vacio-${i}`} className="nota">Elige otro piloto para comparar.</div>
          )
        )}
      </div>

      <table className="comp-tabla">
        <tbody>
          {filas.map(([titulo, f]) => (
            <tr key={titulo}>
              <td className="comp-et">{titulo}</td>
              <td>{f(a)}</td>
              <td>{b ? f(b) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Carrera({ sessionKey, carrera }) {
  const { datos: pilotos, error } = useApi(sessionKey ? `/carreras/${sessionKey}/estrategias` : null);
  const { datos: eventos } = useApi(sessionKey ? `/carreras/${sessionKey}/eventos` : null);
  const [abierto, setAbierto] = useState(null);
  const [filtroEquipo, setFiltroEquipo] = useState("todos");
  const [filtroEstrategia, setFiltroEstrategia] = useState("todas");
  const [modoComparar, setModoComparar] = useState(false);
  const [seleccion, setSeleccion] = useState([]);
  const { tip, props: tipProps } = useTip();
  const refTabla = useRef(null);

  // Al cambiar de carrera, limpio filtros y selecciones.
  useEffect(() => {
    setAbierto(null);
    setFiltroEquipo("todos");
    setFiltroEstrategia("todas");
    setSeleccion([]);
  }, [sessionKey]);

  // Total de vueltas = la vuelta más alta que aparece en los stints.
  const total = useMemo(() => {
    if (!pilotos) return 1;
    let max = 0;
    pilotos.forEach((p) =>
      p.stints.forEach((s) => {
        max = Math.max(max, s.vuelta_fin || 0, s.vuelta_inicio || 0);
      })
    );
    return max || 1;
  }, [pilotos]);

  // Estrategias que existen en esta carrera, de la más usada a la menos usada.
  const estrategias = useMemo(() => {
    const c = {};
    (pilotos || []).forEach((p) => {
      c[p.estrategia] = (c[p.estrategia] || 0) + 1;
    });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [pilotos]);

  if (error) return <p className="error-caja">No pude cargar la carrera: {error}</p>;
  if (!pilotos) return <Esqueleto filas={8} grande />;

  // Solo muestro cuando se despliega el Safety Car / VSC y las banderas rojas.
  const marcas = (eventos || []).filter((e) => e.vuelta && (e.bandera === "RED" || /DEPLOYED/.test(e.mensaje || "")));

  const equipos = [...new Set(pilotos.map((p) => p.team_name))].sort();
  const hayMojado = pilotos.some((p) => p.mojada === 1);

  const visibles = pilotos.filter(
    (p) =>
      (filtroEquipo === "todos" || p.team_name === filtroEquipo) &&
      (filtroEstrategia === "todas" || p.estrategia === filtroEstrategia)
  );
  const limpiar = () => {
    setFiltroEquipo("todos");
    setFiltroEstrategia("todas");
  };

  const ticks = [1, ...Array.from({ length: Math.floor(total / 10) }, (_, i) => (i + 1) * 10)];

  const clicPiloto = (num) => {
    if (modoComparar) {
      setSeleccion((s) => {
        if (s.includes(num)) return s.filter((x) => x !== num);
        return s.length >= 2 ? [s[1], num] : [...s, num];
      });
    } else {
      setAbierto(abierto === num ? null : num);
    }
  };

  const porNumero = (num) => pilotos.find((p) => p.driver_number === num);

  return (
    <section>
      <ResumenCarrera carrera={carrera} pilotos={pilotos} marcas={marcas} total={total} />

      {hayMojado && (
        <div className="banner">
          Carrera con lluvia: los cambios hacia o desde neumáticos intermedios y de lluvia se cuentan como paradas de clima, no como estrategia libre.
        </div>
      )}

      <div className="filtros">
        <select aria-label="Filtrar por equipo" value={filtroEquipo} onChange={(e) => setFiltroEquipo(e.target.value)}>
          <option value="todos">Todos los equipos</option>
          {equipos.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select aria-label="Filtrar por estrategia" value={filtroEstrategia} onChange={(e) => setFiltroEstrategia(e.target.value)}>
          <option value="todas">Todas las estrategias</option>
          {estrategias.map(([nombre, n]) => <option key={nombre} value={nombre}>{nombre} · {n}</option>)}
        </select>
        <button
          className={`boton ${modoComparar ? "activo" : ""}`} aria-pressed={modoComparar}
          onClick={() => { setModoComparar(!modoComparar); setSeleccion([]); }}
        >
          {modoComparar ? "Salir de comparar" : "Comparar pilotos"}
        </button>
        <span className="nota" style={{ margin: 0 }}>{visibles.length} de {pilotos.length} pilotos</span>
        <span style={{ marginLeft: "auto" }}><BotonPNG objetivo={refTabla} nombre={`carrera-${carrera?.circuit_short_name ?? sessionKey}`} /></span>
      </div>

      {modoComparar && (
        <Comparacion a={porNumero(seleccion[0])} b={porNumero(seleccion[1])} total={total} marcas={marcas} tipProps={tipProps} />
      )}

      <div ref={refTabla} className="carrera-grafico">
        <Leyenda />
        <LeyendaRoles />

        <div className="tabla">
          <div className="cabecera">
            <div>Pos</div>
            <div>Piloto</div>
            <div>Largada</div>
            <div>Estrategia</div>
            <div>
              <div className="eje">
                {ticks.map((t) => (
                  <span key={t} style={{ left: t === 1 ? 0 : `${(t / total) * 100}%` }}>{t}</span>
                ))}
              </div>
            </div>
          </div>

          {visibles.length === 0 && <Vacio mensaje="Ningún piloto cumple los filtros." onLimpiar={limpiar} />}

          {visibles.map((p, idx) => {
            const { apellido, nombre } = separarNombre(p.full_name);
            const delta = posicionesGanadas(p);
            const clasePos = p.pos_final === 1 ? "oro" : p.pos_final === 2 ? "plata" : p.pos_final === 3 ? "bronce" : "";
            const activa = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), clicPiloto(p.driver_number));

            return (
              <div
                className={`piloto ${seleccion.includes(p.driver_number) ? "seleccionado" : ""}`}
                key={p.driver_number}
                style={{ "--equipo": colorEquipo(p.team_name), "--i": idx }}
                role="button" tabIndex={0}
                aria-expanded={modoComparar ? undefined : abierto === p.driver_number}
                aria-pressed={modoComparar ? seleccion.includes(p.driver_number) : undefined}
                aria-label={`${apellido}, ${p.team_name}, ${p.estrategia}`}
                onClick={() => clicPiloto(p.driver_number)}
                onKeyDown={activa}
              >
                <div className="fila">
                  <div className={`pos ${clasePos} ${p.pos_final == null ? "dnf" : ""}`}>
                    {p.pos_final ?? (p.dnf ? "DNF" : "—")}
                  </div>
                  <div className="nombre">
                    <div className="pila">{nombre}</div>
                    <div className="apellido">{apellido}</div>
                    <div className="equipo-txt">{p.team_name}</div>
                  </div>
                  <div className={`delta ${delta > 0 ? "sube" : delta < 0 ? "baja" : "igual"}`}>
                    {delta == null ? "—" : delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : "="}
                    <small>P{p.pos_largada ?? "?"}</small>
                  </div>
                  <div className="etiqueta" style={{ "--c": colorParadas(p.paradas) }}>
                    {p.estrategia}
                    <Desglose desglose={p.desglose} />
                  </div>
                  <LineaNeumaticos piloto={p} total={total} marcas={marcas} tipProps={tipProps} />
                </div>

                {!modoComparar && abierto === p.driver_number && (
                  <div className="detalle">
                    <span><b>Secuencia:</b> {p.secuencia}</span>
                    <span>
                      <b>Largó:</b> P{p.pos_largada ?? "?"} → <b>Terminó:</b> {p.pos_final ?? (p.dnf ? "abandonó" : "sin dato")}
                    </span>
                    <ul className="paradas-lista">
                      {p.paradas_detalle.length === 0 && <li>Sin paradas.</li>}
                      {p.paradas_detalle.map((d) => {
                        const r = ROL_POR_NOMBRE[d.rol];
                        return (
                          <li key={d.parada_n}>
                            <span className="ficha" style={{ "--c": r?.color }}><i />{r?.nombre ?? d.rol}</span>
                            vuelta {d.vuelta}: {NEUMATICOS[d.compuesto_sale]?.nombre ?? d.compuesto_sale} → {NEUMATICOS[d.compuesto_entra]?.nombre ?? d.compuesto_entra}
                            <small> · {CONTEXTO[d.contexto] ?? d.contexto}</small>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <Tip tip={tip} />
    </section>
  );
}

const TABS = [
  ["inicio", "Inicio"],
  ["analisis", "Análisis"],
  ["diagnostico", "Diagnóstico"],
  ["carrera", "Carrera"],
  ["replay", "Replay"],
  ["equipos", "Equipos"],
  ["circuitos", "Circuitos"],
  ["porque", "¿Por qué?"],
];

export default function App() {
  const [year, setYear] = useState(2026);
  const [sessionKey, setSessionKey] = useState(null);
  const [tab, setTab] = useState("inicio");
  const [desde, setDesde] = useState(2025);

  const { datos: carreras } = useApi(`/carreras?year=${year}`);

  // Al cambiar de año, selecciono la última carrera de ese año.
  useEffect(() => {
    if (carreras?.length) setSessionKey(carreras[carreras.length - 1].session_key);
  }, [carreras]);

  const carreraActual = (carreras || []).find((c) => c.session_key === sessionKey);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">Strategy <span>Lab</span></div>
        <div className="sub">Estrategias de neumáticos · F1 2023–2026</div>
      </header>
      <div className="cuadros" aria-hidden="true" />

      <nav className="tabs" aria-label="Secciones">
        {TABS.map(([id, texto]) => (
          <button
            key={id}
            className={`tab ${tab === id ? "activa" : ""}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <span>{texto}</span>
          </button>
        ))}
      </nav>

      <div className="controles">
        {(tab === "carrera" || tab === "replay") && (
          <>
            <select aria-label="Temporada" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[2026, 2025, 2024, 2023].map((y) => <option key={y} value={y}>Temporada {y}</option>)}
            </select>
            <select aria-label="Carrera" value={sessionKey ?? ""} onChange={(e) => setSessionKey(Number(e.target.value))}>
              {(carreras || []).map((c) => (
                <option key={c.session_key} value={c.session_key}>{c.circuit_short_name} · {c.date_start.slice(0, 10)}</option>
              ))}
            </select>
          </>
        )}
        {tab === "equipos" && (
          <select aria-label="Desde qué temporada" value={desde} onChange={(e) => setDesde(Number(e.target.value))}>
            {[2023, 2024, 2025, 2026].map((y) => <option key={y} value={y}>Desde {y}</option>)}
          </select>
        )}
      </div>

      {tab === "inicio" && <Inicio onIr={setTab} />}
      {tab === "analisis" && <Analisis />}
      {tab === "diagnostico" && <Diagnostico />}
      {tab === "carrera" && <Carrera sessionKey={sessionKey} carrera={carreraActual} />}
      {tab === "replay" && <Replay sessionKey={sessionKey} carrera={carreraActual} />}
      {tab === "equipos" && <Equipos desde={desde} />}
      {tab === "circuitos" && <Circuitos />}
      {tab === "porque" && <PorQue onIr={setTab} />}
    </div>
  );
}
