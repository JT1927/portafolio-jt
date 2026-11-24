import { useMemo, useRef } from "react";
import "./PorQue.css";
import { BotonPNG, CabeceraTV, Esqueleto, Tip } from "./comun";
import { con, dec, pct, useApi, useTip } from "./datos";

const VARIABLES = {
  longitud_km: "Largo de la pista",
  tiempo_pit_lane_s: "Tiempo en pit lane",
  degradacion_s_por_vuelta: "Degradación del neumático",
  temp_pista_media: "Temperatura de pista",
  spearman_grid_final: "Orden parrilla–meta (correlación)",
  cambio_posiciones_medio: "Cambios de posición medios",
  pct_vueltas_bandera: "% de vueltas neutralizadas",
  n_roja: "Banderas rojas",
  n_sc_vsc: "Safety Car y VSC",
};
const OBJETIVOS = {
  libres: "Paradas libres por piloto",
  planificadas: "Paradas planificadas (obligatorias + libres)",
};
const FACTORES = { circuito: "Circuito", equipo: "Equipo", año: "Temporada" };

export default function PorQue({ onIr }) {
  const { datos, error } = useApi("/por-que");
  const { tip, props } = useTip();
  const refModelos = useRef(null);
  const refImp = useRef(null);
  const refVar = useRef(null);

  const calc = useMemo(() => {
    if (!datos) return null;
    const porObjetivo = (o) => datos.modelos.filter((m) => m.objetivo === o);
    const mejor = (o) => porObjetivo(o).reduce((a, b) => (b.R2_vs_promedio > a.R2_vs_promedio ? b : a), { R2_vs_promedio: -Infinity });
    const maxImp = Math.max(...datos.importancias.map((i) => i.importancia_rf), 0.01);
    const factor = (objetivo, f) => datos.varianza.find((v) => v.objetivo === objetivo && v.factor === f);
    return { porObjetivo, mejor, maxImp, factor };
  }, [datos]);

  if (error) return <p className="error-caja">No pude cargar los datos: {error}</p>;
  if (!calc) {
    return (
      <section className="pagina">
        <CabeceraTV etiqueta="Método" titulo="¿Por qué hacen las paradas que hacen?" />
        <Esqueleto filas={5} grande />
      </section>
    );
  }

  const { porObjetivo, mejor, maxImp, factor } = calc;
  const mLibres = mejor("libres");
  const mPlan = mejor("planificadas");
  const circ = factor("paradas_libres", "circuito");
  const eq = factor("paradas_libres", "equipo");
  const coef = datos.posiciones_coef.find((c) => c.variable === "libres_rel");
  const carrerasModelo = datos.modelos[0]?.carreras;

  return (
    <section className="pagina pq">
      <CabeceraTV etiqueta="Método" titulo="¿Por qué hacen las paradas que hacen?">
        Cada parada se clasifica como obligatoria, libre, reactiva o de clima según el reglamento. Después se mide qué explica las libres, que son la estrategia real: ¿la pista, el equipo, la temporada?
      </CabeceraTV>

      <div className="kpis">
        {circ && <div className="kpi" style={{ "--kpi-color": "var(--rol-libre)" }}><span className="et">Circuito explica</span><b className="num">{pct(circ.R2aj_solo)}</b><span className="sub2">de las paradas libres</span></div>}
        {eq && <div className="kpi" style={{ "--kpi-color": "var(--rol-clima)" }}><span className="et">Equipo explica</span><b className="num">{pct(Math.max(0, eq.R2aj_solo))}</b><span className="sub2">de las paradas libres</span></div>}
        {Number.isFinite(mLibres.R2_vs_promedio) && <div className="kpi"><span className="et">Circuito nunca visto</span><b className="num">R² {dec(mLibres.R2_vs_promedio)}</b><span className="sub2">error {dec(mLibres.MAE_promedio)} → {dec(mLibres.MAE_modelo)} paradas</span></div>}
        {coef && <div className="kpi" style={{ "--kpi-color": "var(--alerta)" }}><span className="et">Una libre extra</span><b className="num">{con(coef.coeficiente)} pos.</b><span className="sub2">asociación, no causa</span></div>}
      </div>

      <div className="dos-col">
        <div className="tarjeta" ref={refVar}>
          <div className="tarjeta-cab">
            <h3>¿Qué factor explica la estrategia?</h3>
            <BotonPNG objetivo={refVar} nombre="factores-que-explican" />
          </div>
          {Object.entries(OBJETIVOS).map(([o, nombre]) => (
            <div key={o} className="pq-bloque">
              <h4>{nombre}</h4>
              {["circuito", "equipo", "año"].map((f) => {
                const v = factor(o === "libres" ? "paradas_libres" : o, f);
                if (!v) return null;
                const x = Math.max(0, v.R2aj_solo);
                return (
                  <div
                    className="pq-fila" key={f} tabIndex={0}
                    aria-label={`${FACTORES[f]}: explica ${pct(x)} de la variación; aporte único ${pct(Math.max(0, v.aporte_unico))}`}
                    {...props(<><b>{FACTORES[f]}</b><div className="tip-fila"><span>Explica por sí solo</span><span>{pct(v.R2aj_solo, 1)}</span></div><div className="tip-fila"><span>Aporte único</span><span>{pct(v.aporte_unico, 1)}</span></div><div className="tip-fila"><span>Los tres juntos</span><span>{pct(v.R2aj_todos, 1)}</span></div></>)}
                  >
                    <span>{FACTORES[f]}</span>
                    <div className="pq-pista" aria-hidden="true"><i className={f === "circuito" ? "top" : ""} style={{ width: `${x * 100}%` }} /></div>
                    <b>{pct(x)}</b>
                  </div>
                );
              })}
            </div>
          ))}
          <p className="nota-gr">R² ajustado de cada factor por separado, en pilotos que terminan carreras secas. Una cifra baja significa que ese factor casi no distingue unas carreras de otras.</p>
        </div>

        <div className="tarjeta" ref={refImp}>
          <div className="tarjeta-cab">
            <h3>Qué rasgos de la pista pesan más</h3>
            <BotonPNG objetivo={refImp} nombre="rasgos-de-la-pista" />
          </div>
          <div role="list" aria-label="Importancia de cada variable en el Random Forest">
            {datos.importancias.map((i, k) => (
              <div
                className="pq-fila ancha" key={i.variable} role="listitem" tabIndex={0}
                aria-label={`${VARIABLES[i.variable] ?? i.variable}: importancia ${pct(i.importancia_rf)}, correlación ${dec(i.spearman_con_planificadas)}`}
                {...props(<><b>{VARIABLES[i.variable] ?? i.variable}</b><div className="tip-fila"><span>Importancia en el modelo</span><span>{pct(i.importancia_rf)}</span></div><div className="tip-fila"><span>Correlación con las paradas</span><span>{dec(i.spearman_con_planificadas)}</span></div></>)}
              >
                <span>{VARIABLES[i.variable] ?? i.variable}</span>
                <div className="pq-pista" aria-hidden="true"><i className={k === 0 ? "top" : ""} style={{ width: `${(i.importancia_rf / maxImp) * 100}%` }} /></div>
                <b>{pct(i.importancia_rf)}</b>
              </div>
            ))}
          </div>
          <p className="nota-gr">Importancia en un Random Forest que predice las paradas planificadas por carrera. Dice cuánto usa el modelo cada dato, no hacia dónde empuja: la correlación está en el detalle.</p>
        </div>
      </div>

      <div className="tarjeta" ref={refModelos}>
        <div className="tarjeta-cab">
          <h3>¿Se puede predecir un circuito que el modelo no vio?</h3>
          <BotonPNG objetivo={refModelos} nombre="modelo-circuito-no-visto" />
        </div>
        <p className="pq-texto">
          Se entrena con todos los circuitos menos uno y se predice ese. R² mide cuánto mejora el modelo frente a decir siempre el promedio: 0 es igual de malo que el promedio, 1 es perfecto.
        </p>
        <div className="dos-col">
          {Object.entries(OBJETIVOS).map(([o, nombre]) => (
            <div key={o}>
              <h4>{nombre}</h4>
              <div className="pq-modelos" role="list" aria-label={`R² por modelo, ${nombre}`}>
                {porObjetivo(o).map((m) => {
                  const mejorFila = m === mejor(o);
                  return (
                    <div
                      className={`pq-fila modelo ${mejorFila ? "mejor" : ""}`} key={`${m.variables}-${m.modelo}`} role="listitem" tabIndex={0}
                      aria-label={`${m.variables}, ${m.modelo}: R² ${dec(m.R2_vs_promedio)}`}
                      {...props(<><b>{m.variables} · {m.modelo}</b><div className="tip-fila"><span>R²</span><span>{dec(m.R2_vs_promedio, 3)}</span></div><div className="tip-fila"><span>Error del modelo</span><span>{dec(m.MAE_modelo, 3)} paradas</span></div><div className="tip-fila"><span>Error del promedio</span><span>{dec(m.MAE_promedio, 3)} paradas</span></div></>)}
                    >
                      <span>{m.variables}<small>{m.modelo}</small></span>
                      <div className="pq-pista" aria-hidden="true"><i className={mejorFila ? "top" : ""} style={{ width: `${Math.max(0, m.R2_vs_promedio) / 0.5 * 100}%` }} /></div>
                      <b>{dec(m.R2_vs_promedio)}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="nota-gr">
          Las paradas libres se predicen mucho mejor (mejor R² {dec(mLibres.R2_vs_promedio)}) que las planificadas en total (mejor R² {dec(mPlan.R2_vs_promedio)}), porque las obligatorias vienen del reglamento y no dependen de la pista.
        </p>
        <button type="button" className="boton suave" onClick={() => onIr("analisis")}>Ver el análisis interactivo</button>
      </div>
      <Tip tip={tip} />

      <footer className="pie-metodo">
        <h3>Límites del análisis</h3>
        <ul>
          <li><b>Reglamento:</b> FIA Sporting Regulations Sección B (2026), art. B6.3.6: en carrera seca se usan al menos dos especificaciones de neumático seco distintas.</li>
          <li><b>Parrilla:</b> es la clasificación, así que no incluye sanciones de parrilla ni largadas desde boxes.</li>
          <li><b>Degradación:</b> se estima con una corrección de combustible fija; es un índice relativo entre circuitos, no una medida exacta.</li>
          <li><b>Neumáticos:</b> los stints de OpenF1 vienen fragmentados y se fusionan por edad de neumático continua.</li>
          <li><b>Muestra:</b> {carrerasModelo ? `${carrerasModelo} carreras secas` : "solo carreras secas"} para el modelo y pilotos que terminan. Con pocas carreras por circuito, los resultados son descriptivos, no definitivos.</li>
        </ul>
      </footer>
    </section>
  );
}
