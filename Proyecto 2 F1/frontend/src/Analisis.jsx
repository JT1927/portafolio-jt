import { useMemo, useRef, useState } from "react";
import "./Analisis.css";
import { BarrasRoles, BotonPNG, CabeceraTV, Esqueleto, PistaMini, Segmentado, Tip, Vacio } from "./comun";
import { ROLES, colorEquipo, con, dec, media, pct, useAncho, useApi, usePistas, useTip } from "./datos";

const COLOR_YEAR = { 2023: "#9a9aa8", 2024: "#5b8def", 2025: "#f5a623", 2026: "#ff5a52" };

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = media(xs);
  const my = media(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// Recta de mínimos cuadrados y = a + b x (null si no hay pendiente definida).
function regresion(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = media(xs);
  const my = media(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (!sxx) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

const anchoTexto = (t) => t.length * 5.4 + 4;
const choca = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// Decide qué etiquetas mostrar: todas si caben sin pisarse; si no, solo las destacadas y los puntos atípicos.
function elegirEtiquetas(pts, ancho, pad, residuos) {
  const cajaDe = (p) => {
    const w = anchoTexto(p.label);
    const derecha = p.px + 8 + w <= ancho - pad.d + 6;
    const x0 = derecha ? p.px + 8 : p.px - 8 - w;
    return { x0, x1: x0 + w, y0: p.py - 18, y1: p.py - 6, anchor: derecha ? "start" : "end", x: derecha ? p.px + 8 : p.px - 8 };
  };
  const cajas = pts.map(cajaDe);
  const circulos = pts.map((p) => ({ x0: p.px - 7, x1: p.px + 7, y0: p.py - 7, y1: p.py + 7 }));
  const libre = (i, colocadas) =>
    colocadas.every((j) => !choca(cajas[i], cajas[j])) && circulos.every((c, k) => k === i || !choca(cajas[i], c));

  const todas = pts.map((_, i) => i);
  const caben = todas.every((i) => libre(i, todas.filter((j) => j < i)));
  if (caben) return new Map(todas.map((i) => [i, cajas[i]]));

  const orden = todas
    .map((i) => ({ i, pri: pts[i].dest ? Infinity : residuos[i] }))
    .sort((a, b) => b.pri - a.pri)
    .slice(0, 6);
  const elegidas = [];
  for (const { i } of orden) {
    if (pts[i].dest || libre(i, elegidas)) elegidas.push(i);
  }
  return new Map(elegidas.map((i) => [i, cajas[i]]));
}

// Gráfico de dispersión en SVG, con tooltip propio, ejes con unidades y línea de tendencia opcional.
function Dispersion({ puntos, xEt, yEt, fmtX = (v) => dec(v, 2), fmtY = (v) => dec(v, 2), descripcion }) {
  const caja = useRef(null);
  const ancho = useAncho(caja);
  const [tendencia, setTendencia] = useState(false);
  const { tip, props } = useTip();
  const alto = ancho < 480 ? 280 : 340;
  const pad = { i: 56, d: 18, s: 14, b: 50 };

  const g = useMemo(() => {
    if (!puntos.length) return null;
    const xs = puntos.map((p) => p.x);
    const ys = puntos.map((p) => p.y);
    const rx = Math.max(...xs) - Math.min(...xs) || 1;
    const ry = Math.max(...ys) - Math.min(...ys) || 1;
    const mnx = Math.min(...xs) - rx * 0.06;
    const mxx = Math.max(...xs) + rx * 0.06;
    const mny = Math.min(...ys) - ry * 0.08;
    const mxy = Math.max(...ys) + ry * 0.08;
    const sx = (v) => pad.i + ((v - mnx) / (mxx - mnx)) * (ancho - pad.i - pad.d);
    const sy = (v) => alto - pad.b - ((v - mny) / (mxy - mny)) * (alto - pad.b - pad.s);
    const reg = regresion(xs, ys);
    const residuos = puntos.map((p) => (reg ? Math.abs(p.y - (reg.a + reg.b * p.x)) : 0));
    const pts = puntos.map((p) => ({ ...p, px: sx(p.x), py: sy(p.y) }));
    const etiquetas = elegirEtiquetas(pts, ancho, pad, residuos);
    return { mnx, mxx, mny, mxy, sx, sy, reg, pts, etiquetas, todas: etiquetas.size === pts.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puntos, ancho, alto]);

  if (!puntos.length) {
    return (
      <div ref={caja} className="an-grafico">
        <p className="an-vacio-chico">Sin datos para este filtro.</p>
      </div>
    );
  }

  return (
    <div ref={caja} className="an-grafico">
      <div className="an-grafico-barra" data-sin-png>
        <label className="an-check">
          <input type="checkbox" checked={tendencia} onChange={(e) => setTendencia(e.target.checked)} /> Línea de tendencia
        </label>
        {!g.todas && <span className="an-aviso-et">Se muestran solo los puntos destacados y atípicos; pasa el mouse por el resto.</span>}
      </div>
      <svg className="an-svg" width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={descripcion || `${yEt} según ${xEt}: ${puntos.length} puntos`}>
        {[0, 1, 2, 3, 4].map((t) => {
          const vx = g.mnx + ((g.mxx - g.mnx) * t) / 4;
          const vy = g.mny + ((g.mxy - g.mny) * t) / 4;
          return (
            <g key={t}>
              <line x1={pad.i} x2={ancho - pad.d} y1={g.sy(vy)} y2={g.sy(vy)} className="an-grilla" />
              <text x={pad.i - 8} y={g.sy(vy) + 4} textAnchor="end" className="an-eje">{fmtY(vy)}</text>
              <text x={g.sx(vx)} y={alto - pad.b + 18} textAnchor="middle" className="an-eje">{fmtX(vx)}</text>
            </g>
          );
        })}
        <line x1={pad.i} x2={pad.i} y1={pad.s} y2={alto - pad.b} className="an-eje-linea" />
        <line x1={pad.i} x2={ancho - pad.d} y1={alto - pad.b} y2={alto - pad.b} className="an-eje-linea" />
        <text x={(pad.i + ancho - pad.d) / 2} y={alto - 8} textAnchor="middle" className="an-eje-et">{xEt}</text>
        <text transform={`translate(14 ${(pad.s + alto - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="an-eje-et">{yEt}</text>

        {tendencia && g.reg && (
          <line
            x1={g.sx(g.mnx)} y1={g.sy(g.reg.a + g.reg.b * g.mnx)}
            x2={g.sx(g.mxx)} y2={g.sy(g.reg.a + g.reg.b * g.mxx)}
            className="an-tendencia"
          />
        )}

        {g.pts.map((p, i) => (
          <circle
            key={i} cx={p.px} cy={p.py} r={p.dest ? 7 : 5}
            fill={p.color || "#e10600"} fillOpacity={p.dest ? 1 : 0.8}
            stroke={p.dest ? "#fff" : "#0e0e14"} strokeWidth={p.dest ? 2 : 1}
            className="an-punto"
            {...props(
              <>
                <b>{p.label}</b>
                <div className="tip-fila"><span>{xEt}</span><span>{fmtX(p.x)}</span></div>
                <div className="tip-fila"><span>{yEt}</span><span>{fmtY(p.y)}</span></div>
              </>
            )}
          />
        ))}
        {[...g.etiquetas].map(([i, c]) => (
          <text key={i} x={c.x} y={g.pts[i].py - 8} textAnchor={c.anchor} className="an-punto-et">{g.pts[i].label}</text>
        ))}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// Barras que parten del cero hacia la izquierda (pierde) o la derecha (gana), con el valor al final de cada barra.
function Divergente({ filas, maximo }) {
  const { tip, props } = useTip();
  return (
    <div className="an-div" role="list">
      {filas.map((f) => (
        <div
          className="an-div-fila" role="listitem" key={f.et} tabIndex={0}
          aria-label={`${f.et}: ${con(f.mean)} posiciones en promedio, ${f.count} casos`}
          {...props(
            <>
              <b>{f.et}</b>
              <div className="tip-fila"><span>Posiciones ganadas</span><span>{con(f.mean)}</span></div>
              <div className="tip-fila"><span>Casos</span><span>{f.count}</span></div>
            </>
          )}
        >
          <span className="an-div-et">{f.et}</span>
          <div className="an-div-pista" aria-hidden="true">
            <div className="an-div-cero" />
            <div
              className={`an-div-barra ${f.mean >= 0 ? "gana" : "pierde"}`}
              style={{ width: `${(Math.abs(f.mean) / maximo) * 44}%`, [f.mean >= 0 ? "left" : "right"]: "50%" }}
            />
            <span
              className="an-div-num"
              style={{ [f.mean >= 0 ? "left" : "right"]: `calc(50% + ${(Math.abs(f.mean) / maximo) * 44}% + 4px)` }}
            >
              {con(f.mean)}
            </span>
          </div>
          <span className="an-div-n">n={f.count}</span>
        </div>
      ))}
      <Tip tip={tip} />
    </div>
  );
}

export default function Analisis() {
  const { datos, error } = useApi("/analisis");
  const pistas = usePistas();
  const [year, setYear] = useState("todos");
  const [equipo, setEquipo] = useState("todos");
  const [circuito, setCircuito] = useState("todos");
  const [agrupar, setAgrupar] = useState("year");

  const refRoles = useRef(null);
  const refDeg = useRef(null);
  const refPit = useRef(null);
  const refSC = useRef(null);
  const refVar = useRef(null);
  const refPos = useRef(null);

  const pilotos = useMemo(() => datos?.pilotos ?? [], [datos]);

  const filtrados = useMemo(
    () =>
      pilotos.filter(
        (p) =>
          (year === "todos" || p.year === Number(year)) &&
          (equipo === "todos" || p.equipo === equipo) &&
          (circuito === "todos" || p.circuito === circuito)
      ),
    [pilotos, year, equipo, circuito]
  );

  const limpiar = () => {
    setYear("todos");
    setEquipo("todos");
    setCircuito("todos");
  };

  const anios = useMemo(() => [...new Set(pilotos.map((p) => p.year))].sort(), [pilotos]);
  const equipos = useMemo(
    () => [...new Set(pilotos.filter((p) => year === "todos" || p.year === Number(year)).map((p) => p.equipo).filter(Boolean))].sort(),
    [pilotos, year]
  );
  const listaCircuitos = useMemo(() => [...new Set(pilotos.map((p) => p.circuito))].sort(), [pilotos]);

  const tot = useMemo(() => {
    const suma = (k) => filtrados.reduce((a, p) => a + (p[k] || 0), 0);
    const total = ROLES.reduce((a, r) => a + suma(r.id), 0);
    return {
      n: filtrados.length,
      carreras: new Set(filtrados.map((p) => p.session_key)).size,
      total,
      porRol: Object.fromEntries(ROLES.map((r) => [r.id, total ? suma(r.id) / total : 0])),
    };
  }, [filtrados]);

  const grupos = useMemo(() => {
    const clave = { year: (p) => p.year, circuito: (p) => p.circuito, equipo: (p) => p.equipo || "s/d" }[agrupar];
    const m = new Map();
    for (const p of filtrados) {
      const k = clave(p);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    const filas = [...m].map(([k, arr]) => {
      const f = { clave: String(k), n: arr.length };
      ROLES.forEach((r) => {
        f[r.id] = media(arr.map((p) => p[r.id] || 0));
      });
      f.total = ROLES.reduce((a, r) => a + f[r.id], 0);
      return f;
    });
    return agrupar === "year" ? filas.sort((a, b) => a.clave.localeCompare(b.clave)) : filas.sort((a, b) => b.total - a.total);
  }, [filtrados, agrupar]);
  const maxTotal = Math.max(0.01, ...grupos.map((g) => g.total));

  const circuitos = useMemo(() => datos?.circuitos ?? [], [datos]);
  const puntosDeg = useMemo(
    () =>
      circuitos
        .filter((c) => c.degradacion_s_por_vuelta != null && c.libres_por_piloto != null)
        .map((c) => ({
          x: c.degradacion_s_por_vuelta,
          y: c.libres_por_piloto,
          label: c.circuit_short_name,
          dest: circuito === c.circuit_short_name,
          color: circuito === c.circuit_short_name ? "#ff5a52" : "#5b8def",
        })),
    [circuitos, circuito]
  );
  const rDeg = pearson(puntosDeg.map((p) => p.x), puntosDeg.map((p) => p.y));

  const pit = useMemo(
    () => circuitos.filter((c) => c.tiempo_pit_lane_s != null).sort((a, b) => b.tiempo_pit_lane_s - a.tiempo_pit_lane_s),
    [circuitos]
  );
  const maxPit = Math.max(1, ...pit.map((c) => c.tiempo_pit_lane_s));
  const tipPit = useTip();

  const carrerasMap = useMemo(() => new Map((datos?.carreras ?? []).map((c) => [c.session_key, c])), [datos]);
  const puntosSC = useMemo(() => {
    const m = new Map();
    for (const p of filtrados) {
      if (!m.has(p.session_key)) m.set(p.session_key, []);
      m.get(p.session_key).push(p);
    }
    const out = [];
    for (const [sk, arr] of m) {
      const c = carrerasMap.get(sk);
      if (!c || c.pct_vueltas_bandera == null) continue;
      out.push({
        x: c.pct_vueltas_bandera,
        y: media(arr.map((p) => p.paradas_reactivas || 0)),
        label: `${c.circuito} ${c.year}`,
        color: COLOR_YEAR[c.year] || "#ff5a52",
        dest: false,
      });
    }
    return out;
  }, [filtrados, carrerasMap]);
  const rSC = pearson(puntosSC.map((p) => p.x), puntosSC.map((p) => p.y));

  const varianza = (datos?.varianza ?? []).filter((v) => v.objetivo === "paradas_libres");
  const mejorModelo = useMemo(() => {
    const filas = (datos?.modelo ?? []).filter((m) => m.objetivo === "libres");
    return filas.length ? filas.reduce((a, b) => (b.R2_vs_promedio > a.R2_vs_promedio ? b : a)) : null;
  }, [datos]);
  const coefLibres = (datos?.posiciones_coef ?? []).find((c) => c.variable === "libres_rel");
  const coefReact = (datos?.posiciones_coef ?? []).find((c) => c.variable === "reactivas_rel");

  const gruposPos = useMemo(() => {
    const filas = datos?.posiciones_grupos ?? [];
    const orden = ["menos que el resto", "igual", "más que el resto"];
    const por = new Map();
    for (const f of filas) {
      if (!por.has(f.grupo_parrilla)) por.set(f.grupo_parrilla, []);
      por.get(f.grupo_parrilla).push({ et: f.libres_vs_resto, mean: f.mean, count: f.count });
    }
    return [...por].map(([g, arr]) => ({ grupo: g, filas: arr.sort((a, b) => orden.indexOf(a.et) - orden.indexOf(b.et)) }));
  }, [datos]);
  const maxPos = Math.max(1, ...gruposPos.flatMap((g) => g.filas.map((f) => Math.abs(f.mean))));

  if (error) return <p className="error-caja">No pude cargar el análisis: {error}. ¿Está corriendo el backend y existe /analisis?</p>;
  if (!datos) {
    return (
      <section className="pagina">
        <CabeceraTV etiqueta="Análisis" titulo="Análisis de estrategia" />
        <Esqueleto filas={3} grande />
        <Esqueleto filas={6} />
      </section>
    );
  }

  const carrerasSecas = datos.modelo?.[0]?.carreras;
  const sinDatos = filtrados.length === 0;
  const desc = ROLES.map((r) => `${r.nombre.toLowerCase()} ${pct(tot.porRol[r.id])}`).join(", ");

  return (
    <section className="pagina an">
      <CabeceraTV etiqueta="Análisis · reglamento FIA" titulo="Análisis de estrategia">
        Cada parada se clasifica según el reglamento deportivo de la FIA. Filtra y mira qué parte de la estrategia es decisión y qué parte es obligación o reacción.
      </CabeceraTV>

      <div className="tarjeta an-filtros-caja">
        <div className="filtros-barra">
          <label>Año
            <select value={year} onChange={(e) => { setYear(e.target.value); setEquipo("todos"); }}>
              <option value="todos">Todos</option>
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>Equipo
            <select value={equipo} onChange={(e) => setEquipo(e.target.value)} disabled={!equipos.length}>
              <option value="todos">Todos</option>
              {equipos.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label>Circuito
            <select value={circuito} onChange={(e) => setCircuito(e.target.value)}>
              <option value="todos">Todos</option>
              {listaCircuitos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button type="button" className="boton suave" onClick={limpiar}>Limpiar filtros</button>
          {circuito !== "todos" && pistas?.[circuito] && (
            <div className="an-pista-filtro"><PistaMini pista={pistas[circuito]} etiqueta={circuito} ancho={110} alto={64} /><span>{circuito}</span></div>
          )}
        </div>
      </div>

      <div className="kpis" aria-label="Resumen del filtro">
        <div className="kpi"><span className="et">Carreras</span><b className="num">{tot.carreras}</b></div>
        <div className="kpi"><span className="et">Pilotos-carrera</span><b className="num">{tot.n}</b></div>
        <div className="kpi"><span className="et">Paradas por piloto</span><b className="num">{tot.n ? dec(tot.total / tot.n) : "–"}</b></div>
        {ROLES.map((r) => (
          <div className="kpi" key={r.id} style={{ "--kpi-color": r.color }} title={r.ayuda}>
            <span className="et">{r.nombre}</span>
            <b className="num">{pct(tot.porRol[r.id])}</b>
            <span className="sub2">de las paradas</span>
          </div>
        ))}
      </div>

      {sinDatos ? (
        <Vacio mensaje="Ninguna carrera cumple esta combinación de filtros." onLimpiar={limpiar} />
      ) : (
        <>
          <div className="tarjeta" ref={refRoles}>
            <div className="tarjeta-cab">
              <h3>¿Qué tipo de paradas se hacen?</h3>
              <div className="an-acciones">
                <Segmentado etiqueta="Agrupar paradas por" valor={agrupar} onChange={setAgrupar} opciones={[["year", "Por año"], ["circuito", "Por circuito"], ["equipo", "Por equipo"]]} />
                <BotonPNG objetivo={refRoles} nombre="paradas-por-rol" />
              </div>
            </div>
            <div className="leyenda-gr">
              {ROLES.map((r) => <span key={r.id}><i style={{ background: r.color }} />{r.nombre}</span>)}
            </div>
            <BarrasRoles grupos={grupos} maxTotal={maxTotal} colorDe={agrupar === "equipo" ? colorEquipo : null} />
            <p className="nota-gr">Paradas por piloto en cada grupo ({desc}). Pasa el mouse sobre un tramo para ver el detalle. Las carreras con lluvia aumentan las paradas de clima.</p>
          </div>

          <div className="dos-col">
            <div className="tarjeta" ref={refDeg}>
              <div className="tarjeta-cab">
                <h3>Degradación y paradas libres por circuito</h3>
                <BotonPNG objetivo={refDeg} nombre="degradacion-vs-libres" />
              </div>
              <Dispersion
                puntos={puntosDeg}
                xEt="Degradación (s por vuelta, relativa)" yEt="Paradas libres por piloto"
                fmtX={(v) => `${dec(v, 2)} s`} fmtY={(v) => dec(v, 1)}
                descripcion={`Dispersión de ${puntosDeg.length} circuitos: degradación del neumático contra paradas libres por piloto${rDeg != null ? `, correlación ${dec(rDeg)}` : ""}`}
              />
              <p className="nota-gr">
                {rDeg != null && <>Correlación entre circuitos: <b>{dec(rDeg)}</b>. </>}
                Donde el neumático se degrada más, hay más estrategia real. La degradación es relativa: depende de una corrección de combustible fija y de la evolución de la pista.
              </p>
            </div>

            <div className="tarjeta" ref={refPit}>
              <div className="tarjeta-cab">
                <h3>Tiempo en pit lane (bandera verde)</h3>
                <BotonPNG objetivo={refPit} nombre="tiempo-pit-lane" />
              </div>
              <div className="an-pit" role="list" aria-label="Tiempo en pit lane por circuito">
                {pit.map((c) => (
                  <div
                    className={`an-pit-fila ${circuito === c.circuit_short_name ? "dest" : ""}`} key={c.circuit_short_name}
                    role="listitem" tabIndex={0}
                    aria-label={`${c.circuit_short_name}: ${dec(c.tiempo_pit_lane_s, 1)} segundos`}
                    {...tipPit.props(
                      <>
                        <b>{c.circuit_short_name}</b>
                        <div className="tip-fila"><span>Mediana en pit lane</span><span>{dec(c.tiempo_pit_lane_s, 1)} s</span></div>
                        <div className="tip-fila"><span>Largo de pista</span><span>{dec(c.longitud_km, 2)} km</span></div>
                      </>
                    )}
                  >
                    <span>{c.circuit_short_name}</span>
                    <div aria-hidden="true"><i style={{ width: `${(c.tiempo_pit_lane_s / maxPit) * 100}%` }} /></div>
                    <b>{dec(c.tiempo_pit_lane_s, 1)} s</b>
                  </div>
                ))}
              </div>
              <Tip tip={tipPit.tip} />
              <p className="nota-gr">Mediana de la duración en pit lane. Es un proxy de lo que cuesta parar, no la pérdida exacta.</p>
            </div>
          </div>

          <div className="tarjeta" ref={refSC}>
            <div className="tarjeta-cab">
              <h3>Efecto de Safety Car, VSC y bandera roja</h3>
              <BotonPNG objetivo={refSC} nombre="efecto-bandera" />
            </div>
            <Dispersion
              puntos={puntosSC}
              xEt="Vueltas con SC, VSC o roja (% de la carrera)" yEt="Paradas reactivas por piloto"
              fmtX={(v) => `${dec(v, 0)} %`} fmtY={(v) => dec(v, 1)}
              descripcion={`Dispersión de ${puntosSC.length} carreras: porcentaje de vueltas neutralizadas contra paradas reactivas por piloto${rSC != null ? `, correlación ${dec(rSC)}` : ""}`}
            />
            <div className="leyenda-gr">
              {Object.entries(COLOR_YEAR).map(([y, c]) => <span key={y}><i style={{ background: c }} />{y}</span>)}
            </div>
            <p className="nota-gr">
              Cada punto es una carrera.{rSC != null && <> Correlación: <b>{dec(rSC)}</b>.</>} Más vueltas neutralizadas significa más paradas aprovechadas bajo bandera, que no son una decisión de estrategia sino una reacción.
            </p>
          </div>

          <div className="dos-col">
            <div className="tarjeta" ref={refVar}>
              <div className="tarjeta-cab">
                <h3>¿Qué explica las paradas libres?</h3>
                <BotonPNG objetivo={refVar} nombre="que-explica-paradas-libres" />
              </div>
              {varianza.length ? (
                <div className="an-var" role="list" aria-label="Porcentaje de variación explicado por factor">
                  {varianza.map((v) => (
                    <div className="an-var-fila" key={v.factor} role="listitem" aria-label={`${v.factor}: ${pct(v.R2aj_solo)} de la variación`}>
                      <span>{v.factor === "año" ? "año" : v.factor}</span>
                      <div aria-hidden="true"><i style={{ width: `${Math.max(0, v.R2aj_solo) * 100}%` }} /></div>
                      <b>{pct(v.R2aj_solo)}</b>
                    </div>
                  ))}
                </div>
              ) : <p className="an-vacio-chico">Sin datos del modelo.</p>}
              <p className="nota-gr">
                Porcentaje de la variación explicado por cada factor (R² ajustado, pilotos que terminan en carreras secas).
                {mejorModelo && <> Para un circuito que el modelo nunca vio, las variables físicas de la pista predicen las paradas libres con R² {dec(mejorModelo.R2_vs_promedio)}: el error baja de {dec(mejorModelo.MAE_promedio)} a {dec(mejorModelo.MAE_modelo)} paradas.</>}
              </p>
            </div>

            <div className="tarjeta" ref={refPos}>
              <div className="tarjeta-cab">
                <h3>¿Parar más gana posiciones?</h3>
                <BotonPNG objetivo={refPos} nombre="parar-mas-gana-posiciones" />
              </div>
              {coefLibres && (
                <p className="an-dato">
                  Cada parada libre extra respecto al resto de la carrera se asocia a <b>{dec(coefLibres.coeficiente, 1)} posiciones</b>
                  <small> (IC 95 %: {dec(coefLibres["IC95_bajo"], 1)} a {dec(coefLibres["IC95_alto"], 1)})</small>
                  {coefReact && <>; con una reactiva extra, {dec(coefReact.coeficiente, 1)}.</>}
                </p>
              )}
              {gruposPos.map((g) => (
                <div key={g.grupo} className="an-pos-grupo">
                  <h4>Parrilla {g.grupo}</h4>
                  <Divergente filas={g.filas} maximo={maxPos} />
                </div>
              ))}
              <p className="nota-gr">Posiciones ganadas = clasificación menos resultado (la clasificación es proxy de la parrilla). Es una asociación, no una causa: quien para más suele tener un problema, y solo se cuentan los que terminan.</p>
            </div>
          </div>
        </>
      )}

      <footer className="pie-metodo">
        <h3>Cómo se clasificó y qué límites tiene</h3>
        <ul>
          <li><b>Reglamento:</b> FIA Sporting Regulations Sección B (2026), artículo B6.3.6: en carrera seca hay que usar dos especificaciones de neumático seco distintas. Reglas especiales: Mónaco 2025 (mínimo 2 paradas) y Lusail 2023 y 2025 (límite de vueltas por set).</li>
          <li><b>Contexto de cada parada:</b> se decide por la hora de la parada contra las ventanas de SC, VSC y bandera roja de Race Control, no por el número de vuelta.</li>
          <li><b>Datos de neumáticos:</b> los stints de OpenF1 vienen fragmentados; se fusionan los que son el mismo juego (mismo compuesto y edad de neumático continua).</li>
          <li><b>Límites:</b> sin sanciones de parrilla, degradación con corrección de combustible fija{carrerasSecas ? `, ${carrerasSecas} carreras secas` : ""} y {circuitos.length} circuitos para el modelo.</li>
        </ul>
      </footer>
    </section>
  );
}
