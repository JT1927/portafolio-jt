import { useMemo, useRef, useState } from "react";
import "./Diagnostico.css";
import { BotonPNG, CabeceraTV, Esqueleto, Segmentado, Tip, Vacio } from "./comun";
import { colorEquipo, con, dec, media, useApi, useTip } from "./datos";

const CAUSAS = [
  { id: "salida", nombre: "Salida", color: "var(--causa-salida)", ayuda: "Vuelta 1. Incluye sanciones de parrilla y largadas desde boxes, porque la parrilla es la clasificación." },
  { id: "parada_propia", nombre: "Sus paradas", color: "var(--causa-parada_propia)", ayuda: "Posiciones ganadas o perdidas en las vueltas en que el piloto estaba en boxes o recién salía." },
  { id: "parada_ajena", nombre: "Paradas rivales", color: "var(--causa-parada_ajena)", ayuda: "Posiciones que sube porque un rival paró." },
  { id: "pista", nombre: "Pista", color: "var(--causa-pista)", ayuda: "Adelantamientos sin paradas ni banderas de por medio." },
  { id: "bandera", nombre: "Bajo bandera", color: "var(--causa-bandera)", ayuda: "Cambios de orden bajo Safety Car, VSC o bandera roja, sin paradas involucradas." },
  { id: "otros", nombre: "Otros", color: "var(--causa-otros)", ayuda: "Abandonos (propios y de rivales) y ajustes de clasificación final." },
];
const NIVELES = [["carrera", "Carrera"], ["equipo", "Equipo"], ["year", "Año"], ["piloto", "Piloto"], ["circuito", "Circuito"]];
const ESCALA_BARRA = 40; // % del ancho total que ocupa la mitad más larga; el resto deja espacio a los valores del final

const clase = (v) => (v > 0.05 ? "pos" : v < -0.05 ? "neg" : "cero");

function valores(r) {
  return {
    salida: r.salida || 0,
    parada_propia: r.parada_propia || 0,
    parada_ajena: r.parada_ajena || 0,
    pista: r.pista || 0,
    bandera: r.bandera || 0,
    otros: (r.otros || 0) + (r.abandono || 0),
  };
}

function dominante(vals) {
  return CAUSAS.map((c) => ({ c, v: vals[c.id] || 0 })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
}

// Barra que parte de un eje central: lo que gana va a la derecha y lo que pierde a la izquierda, coloreado por causa.
// Al final de cada lado se muestra el total de posiciones ganadas / perdidas.
function BarraCausas({ vals, escala, props, decimales = 0 }) {
  let der = 0;
  let izq = 0;
  const trozos = [];
  CAUSAS.forEach((c) => {
    const v = vals[c.id] || 0;
    if (!v) return;
    const ancho = (Math.abs(v) / escala) * ESCALA_BARRA;
    if (v > 0) {
      trozos.push({ c, v, left: 50 + der, ancho, lado: "d" });
      der += ancho;
    } else {
      izq += ancho;
      trozos.push({ c, v, left: 50 - izq, ancho, lado: "i" });
    }
  });
  const sumaPos = CAUSAS.reduce((a, c) => a + Math.max(0, vals[c.id] || 0), 0);
  const sumaNeg = CAUSAS.reduce((a, c) => a + Math.min(0, vals[c.id] || 0), 0);
  const descripcion = CAUSAS.filter((c) => vals[c.id]).map((c) => `${c.nombre} ${con(vals[c.id])}`).join(", ");
  return (
    <div className="dg-barra" role="img" aria-label={descripcion ? `Causas: ${descripcion}` : "Sin cambios de posición"}>
      <div className="dg-eje" />
      {trozos.map((t) => (
        <div
          key={t.c.id}
          className={`dg-trozo ${t.lado}`}
          style={{ left: `${t.left}%`, width: `${t.ancho}%`, background: t.c.color }}
          {...props(
            <>
              <b>{t.c.nombre}</b>
              <div className="tip-fila"><span>Posiciones</span><span>{con(t.v)}</span></div>
              <span>{t.c.ayuda}</span>
            </>
          )}
        />
      ))}
      {sumaPos > 0.04 && <span className="dg-fin der" style={{ left: `calc(${50 + der}% + 4px)` }}>{con(sumaPos, decimales)}</span>}
      {sumaNeg < -0.04 && <span className="dg-fin izq" style={{ right: `calc(${50 + izq}% + 4px)` }}>{con(sumaNeg, decimales)}</span>}
    </div>
  );
}

export default function Diagnostico() {
  const { datos, error } = useApi("/diagnostico");
  const [nivel, setNivel] = useState("carrera");
  const [year, setYear] = useState("todos");
  const [equipo, setEquipo] = useState("todos");
  const [circuito, setCircuito] = useState("todos");
  const [evento, setEvento] = useState("todos");
  const [sk, setSk] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [orden, setOrden] = useState({ col: "ganadas", dir: -1 });
  const [minN, setMinN] = useState(5);
  const { tip, props } = useTip();
  const refTabla = useRef(null);
  const refPeso = useRef(null);

  const filas = useMemo(() => (datos ?? []).map((r) => ({ ...r, v: valores(r) })), [datos]);

  const filtradas = useMemo(
    () =>
      filas.filter((r) => {
        if (year !== "todos" && r.year !== Number(year)) return false;
        if (equipo !== "todos" && r.equipo !== equipo) return false;
        if (circuito !== "todos" && r.circuito !== circuito) return false;
        const hayNeutra = (r.n_sc || 0) > 0 || (r.n_vsc || 0) > 0;
        if (evento === "neutra" && !hayNeutra) return false;
        if (evento === "limpia" && hayNeutra) return false;
        if (evento === "mojada" && !r.mojada) return false;
        if (evento === "seca" && r.mojada) return false;
        return true;
      }),
    [filas, year, equipo, circuito, evento]
  );

  const limpiar = () => {
    setYear("todos");
    setEquipo("todos");
    setCircuito("todos");
    setEvento("todos");
  };

  const anios = useMemo(() => [...new Set(filas.map((r) => r.year))].sort(), [filas]);
  const equipos = useMemo(
    () => [...new Set(filas.filter((r) => year === "todos" || r.year === Number(year)).map((r) => r.equipo).filter(Boolean))].sort(),
    [filas, year]
  );
  const circuitos = useMemo(() => [...new Set(filas.map((r) => r.circuito))].sort(), [filas]);

  // Equipo más frecuente de cada piloto (para el color de equipo en el nivel Piloto).
  const equipoDePiloto = useMemo(() => {
    const m = new Map();
    for (const r of filtradas) {
      const c = m.get(r.piloto) ?? new Map();
      c.set(r.equipo, (c.get(r.equipo) ?? 0) + 1);
      m.set(r.piloto, c);
    }
    return new Map([...m].map(([p, c]) => [p, [...c].sort((a, b) => b[1] - a[1])[0][0]]));
  }, [filtradas]);

  // ---- Nivel carrera ----
  const carreras = useMemo(() => {
    const m = new Map();
    for (const r of filtradas) if (!m.has(r.session_key)) m.set(r.session_key, { sk: r.session_key, year: r.year, circuito: r.circuito });
    return [...m.values()].sort((a, b) => b.year - a.year || a.circuito.localeCompare(b.circuito));
  }, [filtradas]);
  const skSel = carreras.some((c) => c.sk === sk) ? sk : carreras[0]?.sk;
  const pilotosCarrera = useMemo(
    () => filtradas.filter((r) => r.session_key === skSel).sort((a, b) => a.final - b.final),
    [filtradas, skSel]
  );
  const escalaCarrera = useMemo(() => {
    let mx = 1;
    for (const r of pilotosCarrera) {
      const pos = CAUSAS.reduce((a, c) => a + Math.max(0, r.v[c.id]), 0);
      const neg = CAUSAS.reduce((a, c) => a + Math.max(0, -r.v[c.id]), 0);
      mx = Math.max(mx, pos, neg);
    }
    return mx;
  }, [pilotosCarrera]);
  const resumenCarrera = useMemo(() => {
    if (!pilotosCarrera.length) return null;
    const terminan = pilotosCarrera.filter((r) => !r.dnf);
    const gana = [...terminan].sort((a, b) => b.ganadas - a.ganadas)[0];
    const pierde = [...terminan].sort((a, b) => a.ganadas - b.ganadas)[0];
    const ganador = pilotosCarrera.find((r) => r.final === 1);
    return { gana, pierde, ganador, n: pilotosCarrera.length, sc: pilotosCarrera[0].n_sc, vsc: pilotosCarrera[0].n_vsc };
  }, [pilotosCarrera]);

  // ---- Niveles agregados ----
  const agregado = useMemo(() => {
    if (nivel === "carrera") return [];
    const clave = { equipo: (r) => r.equipo || "s/d", year: (r) => String(r.year), piloto: (r) => r.piloto, circuito: (r) => r.circuito }[nivel];
    const m = new Map();
    for (const r of filtradas) {
      const k = clave(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    const out = [...m].map(([k, arr]) => {
      const f = { clave: k, n: arr.length, carreras: new Set(arr.map((x) => x.session_key)).size, ganadas: media(arr.map((x) => x.ganadas)) };
      CAUSAS.forEach((c) => {
        f[c.id] = media(arr.map((x) => x.v[c.id]));
      });
      return f;
    });
    return out.filter((f) => f.n >= minN).sort((a, b) => {
      const va = a[orden.col];
      const vb = b[orden.col];
      return typeof va === "string" ? orden.dir * va.localeCompare(vb) : orden.dir * (va - vb);
    });
  }, [filtradas, nivel, orden, minN]);
  const escalaAgr = useMemo(() => {
    let mx = 0.5;
    for (const f of agregado) {
      const pos = CAUSAS.reduce((a, c) => a + Math.max(0, f[c.id]), 0);
      const neg = CAUSAS.reduce((a, c) => a + Math.max(0, -f[c.id]), 0);
      mx = Math.max(mx, pos, neg);
    }
    return mx;
  }, [agregado]);

  const peso = useMemo(() => {
    const tot = {};
    CAUSAS.forEach((c) => {
      tot[c.id] = filtradas.reduce((a, r) => a + Math.abs(r.v[c.id]), 0);
    });
    const suma = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
    return CAUSAS.map((c) => ({ c, p: tot[c.id] / suma }));
  }, [filtradas]);

  const colorFila = (clave) => {
    if (nivel === "equipo") return colorEquipo(clave);
    if (nivel === "piloto") return colorEquipo(equipoDePiloto.get(clave));
    return "transparent";
  };

  const ordenar = (col) => setOrden((o) => (o.col === col ? { col, dir: -o.dir } : { col, dir: col === "clave" ? 1 : -1 }));
  const flecha = (col) => (orden.col === col ? (orden.dir > 0 ? " \u25B2" : " \u25BC") : "");
  const ariaOrden = (col) => (orden.col === col ? (orden.dir > 0 ? "ascending" : "descending") : "none");

  if (error) return <p className="error-caja">No pude cargar el diagnóstico: {error}. ¿Está corriendo el backend y existe /diagnostico?</p>;
  if (!datos) {
    return (
      <section className="pagina">
        <CabeceraTV etiqueta="Diagnóstico" titulo="¿Por qué se ganan o se pierden posiciones?" />
        <Esqueleto filas={3} grande />
        <Esqueleto filas={8} />
      </section>
    );
  }

  const nombreNivel = NIVELES.find(([id]) => id === nivel)[1];

  return (
    <section className="pagina dg">
      <CabeceraTV etiqueta="Diagnóstico de carrera" titulo="¿Por qué se ganan o se pierden posiciones?">
        Cada cambio de orden entre dos pilotos se asigna a una causa: la salida, sus paradas, las paradas de los rivales, un adelantamiento en pista o una neutralización. Se puede ver por carrera, equipo, año, piloto o circuito.
      </CabeceraTV>

      <div className="tarjeta dg-controles">
        <Segmentado etiqueta="Nivel de análisis" valor={nivel} onChange={setNivel} opciones={NIVELES} />
        <div className="filtros-barra">
          <label>Año
            <select value={year} onChange={(e) => { setYear(e.target.value); setEquipo("todos"); }}>
              <option value="todos">Todos</option>
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>Equipo
            <select value={equipo} onChange={(e) => setEquipo(e.target.value)}>
              <option value="todos">Todos</option>
              {equipos.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label>Circuito
            <select value={circuito} onChange={(e) => setCircuito(e.target.value)}>
              <option value="todos">Todos</option>
              {circuitos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Tipo de carrera
            <select value={evento} onChange={(e) => setEvento(e.target.value)}>
              <option value="todos">Todas</option>
              <option value="neutra">Con SC o VSC</option>
              <option value="limpia">Sin SC ni VSC</option>
              <option value="mojada">Mojadas</option>
              <option value="seca">Secas</option>
            </select>
          </label>
          {nivel === "carrera" && (
            <label>Carrera
              <select value={skSel ?? ""} onChange={(e) => { setSk(Number(e.target.value)); setAbierto(null); }}>
                {carreras.map((c) => <option key={c.sk} value={c.sk}>{c.year} · {c.circuito}</option>)}
              </select>
            </label>
          )}
          {nivel !== "carrera" && (
            <label>Mínimo de carreras-piloto
              <input type="number" min="1" max="200" value={minN} onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          )}
          <button type="button" className="boton suave" onClick={limpiar}>Limpiar filtros</button>
        </div>
      </div>

      <div className="leyenda-gr dg-leyenda">
        {CAUSAS.map((c) => (
          <span key={c.id} title={c.ayuda}><i style={{ background: c.color }} />{c.nombre}</span>
        ))}
        <small>A la derecha del eje central gana posiciones; a la izquierda, las pierde.</small>
      </div>

      {!filtradas.length && <Vacio mensaje="Ninguna carrera cumple esta combinación de filtros." onLimpiar={limpiar} />}

      {nivel === "carrera" && resumenCarrera && (
        <>
          <div className="kpis">
            <div className="kpi"><span className="et">Ganador</span><b className="num">{resumenCarrera.ganador ? resumenCarrera.ganador.piloto : "–"}</b><span className="sub2">{resumenCarrera.ganador ? `largó ${resumenCarrera.ganador.grid}°` : ""}</span></div>
            <div className="kpi" style={{ "--kpi-color": "var(--sube)" }}><span className="et">Más posiciones ganadas</span><b className="num">{resumenCarrera.gana ? `${resumenCarrera.gana.piloto} ${con(resumenCarrera.gana.ganadas, 0)}` : "–"}</b><span className="sub2">{resumenCarrera.gana ? `principalmente: ${dominante(resumenCarrera.gana.v).c.nombre.toLowerCase()}` : ""}</span></div>
            <div className="kpi" style={{ "--kpi-color": "var(--baja)" }}><span className="et">Más posiciones perdidas</span><b className="num">{resumenCarrera.pierde ? `${resumenCarrera.pierde.piloto} ${con(resumenCarrera.pierde.ganadas, 0)}` : "–"}</b><span className="sub2">{resumenCarrera.pierde ? `principalmente: ${dominante(resumenCarrera.pierde.v).c.nombre.toLowerCase()}` : ""}</span></div>
            <div className="kpi"><span className="et">Safety Car / VSC</span><b className="num">{resumenCarrera.sc ?? 0} / {resumenCarrera.vsc ?? 0}</b><span className="sub2">{resumenCarrera.n} pilotos</span></div>
          </div>

          <div className="tarjeta dg-tarjeta" ref={refTabla}>
            <div className="tarjeta-cab">
              <h3>Qué le pasó a cada piloto</h3>
              <BotonPNG objetivo={refTabla} nombre="diagnostico-carrera" />
            </div>
            <div className="dg-tabla" role="table" aria-label="Diagnóstico por piloto">
              <div className="dg-fila dg-cab-fila" role="row">
                <span role="columnheader">Final</span><span role="columnheader">Piloto</span><span role="columnheader">Parrilla → final</span><span role="columnheader">Δ</span><span role="columnheader">Qué pasó</span>
              </div>
              {pilotosCarrera.map((r) => (
                <div key={r.driver_number} className={`dg-bloque ${abierto === r.driver_number ? "abierto" : ""}`} style={{ "--equipo": colorEquipo(r.equipo) }}>
                  <button type="button" className="dg-fila dg-click" aria-expanded={abierto === r.driver_number} onClick={() => setAbierto(abierto === r.driver_number ? null : r.driver_number)}>
                    <span className="dg-pos">{r.final}</span>
                    <span className="dg-piloto"><b>{r.piloto}</b><small>{r.equipo}</small></span>
                    <span className="dg-pg">P{r.grid} → P{r.final}{r.dnf ? " (abandonó)" : ""}</span>
                    <span className={`dg-delta ${clase(r.ganadas)}`}>{con(r.ganadas, 0)}</span>
                    <BarraCausas vals={r.v} escala={escalaCarrera} props={props} />
                  </button>
                  {abierto === r.driver_number && (
                    <div className="dg-detalle">
                      <p>{r.texto}</p>
                      {(r.grid_estimado === 1 || r.final_estimado === 1) && (
                        <small>{r.grid_estimado === 1 ? "La parrilla de este piloto es estimada (largó desde boxes). " : ""}{r.final_estimado === 1 ? "Su posición final es estimada por vueltas completadas." : ""}</small>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {nivel !== "carrera" && filtradas.length > 0 && (
        <>
          <div className="tarjeta" ref={refPeso}>
            <div className="tarjeta-cab">
              <h3>Qué causa pesa más en lo filtrado</h3>
              <BotonPNG objetivo={refPeso} nombre="peso-de-las-causas" />
            </div>
            <div className="dg-peso-barra" role="img" aria-label={`Peso de cada causa: ${peso.map(({ c, p }) => `${c.nombre} ${dec(p * 100, 0)} %`).join(", ")}`}>
              {peso.map(({ c, p }) => (
                <div
                  key={c.id} className="dg-peso-trozo" style={{ width: `${p * 100}%`, background: c.color }}
                  {...props(<><b>{c.nombre}</b><div className="tip-fila"><span>Del movimiento total</span><span>{dec(p * 100, 0)} %</span></div></>)}
                >
                  {p >= 0.09 ? `${dec(p * 100, 0)} %` : ""}
                </div>
              ))}
            </div>
            <p className="nota-gr">Proporción del movimiento total de posiciones (suma de posiciones netas, sin signo) que viene de cada causa.</p>
          </div>

          <div className="tarjeta dg-tarjeta" ref={refTabla}>
            <div className="tarjeta-cab">
              <h3>Promedio de posiciones por {nombreNivel.toLowerCase()}</h3>
              <BotonPNG objetivo={refTabla} nombre={`diagnostico-por-${nivel}`} />
            </div>
            <div className="dg-scroll" tabIndex={0} aria-label="Tabla desplazable horizontalmente">
              <div className="dg-tabla dg-ancha" role="table" aria-label={`Diagnóstico por ${nombreNivel.toLowerCase()}`}>
                <div className="dg-fila dg-agr dg-cab-fila" role="row">
                  <span role="columnheader" aria-sort={ariaOrden("clave")}><button type="button" onClick={() => ordenar("clave")}>{nombreNivel}{flecha("clave")}</button></span>
                  <span role="columnheader" aria-sort={ariaOrden("n")}><button type="button" onClick={() => ordenar("n")}>N{flecha("n")}</button></span>
                  <span role="columnheader" aria-sort={ariaOrden("ganadas")}><button type="button" onClick={() => ordenar("ganadas")}>Δ medio{flecha("ganadas")}</button></span>
                  <span role="columnheader">Desglose</span>
                  {CAUSAS.map((c) => (
                    <span role="columnheader" key={c.id} aria-sort={ariaOrden(c.id)}>
                      <button type="button" className="dg-col-causa" onClick={() => ordenar(c.id)} title={c.ayuda}>{c.nombre}{flecha(c.id)}</button>
                    </span>
                  ))}
                </div>
                {agregado.map((f) => (
                  <div className="dg-fila dg-agr" role="row" key={f.clave} style={{ "--equipo": colorFila(f.clave) }}>
                    <span className="dg-clave" role="cell">{f.clave}</span>
                    <span className="dg-n" role="cell">{f.n}</span>
                    <span className={`dg-delta ${clase(f.ganadas)}`} role="cell">{con(f.ganadas)}</span>
                    <BarraCausas vals={f} escala={escalaAgr} props={props} decimales={1} />
                    {CAUSAS.map((c) => (
                      <span key={c.id} role="cell" className={`dg-num ${clase(f[c.id])}`}>{con(f[c.id])}</span>
                    ))}
                  </div>
                ))}
                {!agregado.length && (
                  <Vacio mensaje={`Ningún grupo llega al mínimo de ${minN} carreras-piloto.`} onLimpiar={() => { limpiar(); setMinN(1); }} />
                )}
              </div>
            </div>
            <p className="nota-gr">Promedio de posiciones por carrera. Pasa el mouse sobre cada tramo de color para ver el detalle. Haz clic en un encabezado para ordenar.</p>
          </div>
        </>
      )}
      <Tip tip={tip} />

      <footer className="pie-metodo">
        <h3>Cómo se calcula y qué límites tiene</h3>
        <ul>
          <li><b>Método:</b> se compara el orden de cada par de pilotos entre una vuelta y la siguiente. Si dos pilotos cambian de orden, el cambio se asigna a la salida (vuelta 1), a una parada (la vuelta en boxes y las anteriores dentro de una ventana elegida por los datos), a una neutralización o a un adelantamiento en pista.</li>
          <li><b>Parrilla:</b> es la clasificación. No incluye sanciones de parrilla ni largadas desde boxes, así que esos casos aparecen como cambios en la salida.</li>
          <li><b>Otros:</b> abandonos de rivales, el propio abandono y ajustes posteriores de la clasificación (el residuo para que todo cuadre con las posiciones ganadas).</li>
          <li><b>Estimaciones:</b> a los pilotos no clasificados se les estima la posición final por vueltas completadas, y a los que largan desde boxes se les ubica al final de la parrilla.</li>
          <li><b>Lectura:</b> es una atribución descriptiva, no causal. Un adelantamiento justo después de salir de boxes cuenta como parada, y bajo bandera casi no hay adelantamientos.</li>
        </ul>
      </footer>
    </section>
  );
}
