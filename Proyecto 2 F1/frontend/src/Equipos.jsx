import { useMemo, useRef, useState } from "react";
import { BarrasRoles, BotonPNG, CabeceraTV, Esqueleto, Tip } from "./comun";
import { ROLES, colorEquipo, dec, media, useApi, useTip } from "./datos";

// Cada fila de la dispersión es un rol de parada: la franja es el rango entre circuitos y los puntos son los equipos.
export default function Equipos({ desde }) {
  const { datos, error } = useApi("/analisis");
  const [foco, setFoco] = useState(null);
  const { tip, props } = useTip();
  const refDisp = useRef(null);
  const refBarras = useRef(null);

  const calc = useMemo(() => {
    if (!datos) return null;
    const medias = (arr) => {
      const f = { n: arr.length };
      ROLES.forEach((r) => {
        f[r.id] = media(arr.map((p) => p[r.id] || 0));
      });
      f.total = ROLES.reduce((a, r) => a + f[r.id], 0);
      return f;
    };
    const agrupar = (lista, clave) => {
      const m = new Map();
      for (const p of lista) {
        const k = clave(p);
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(p);
      }
      return [...m].map(([k, arr]) => ({ clave: k, ...medias(arr) }));
    };
    const equipos = agrupar(datos.pilotos.filter((p) => p.year >= desde), (p) => p.equipo).sort((a, b) => a.clave.localeCompare(b.clave));
    const circuitos = agrupar(datos.pilotos, (p) => p.circuito);
    const rango = (filas, id) => {
      const v = filas.map((f) => f[id]);
      return [Math.min(...v), Math.max(...v)];
    };
    const maximo = Math.max(0.5, ...equipos.map((f) => Math.max(...ROLES.map((r) => f[r.id]))), ...circuitos.map((f) => Math.max(...ROLES.map((r) => f[r.id]))));
    const tope = Math.ceil(maximo * 4) / 4;
    return { equipos, circuitos, rango, tope };
  }, [datos, desde]);

  if (error) return <p className="error-caja">No pude cargar los datos: {error}</p>;
  if (!calc) {
    return (
      <section className="pagina">
        <CabeceraTV etiqueta="Equipos" titulo="Los equipos se parecen entre sí" />
        <Esqueleto filas={5} />
      </section>
    );
  }

  const { equipos, circuitos, rango, tope } = calc;
  const [lMinE, lMaxE] = rango(equipos, "paradas_libres");
  const [lMinC, lMaxC] = rango(circuitos, "paradas_libres");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tope);
  const maxTotal = Math.max(0.01, ...equipos.map((f) => f.total));

  return (
    <section className="pagina">
      <CabeceraTV etiqueta={`Equipos · desde ${desde}`} titulo="Los equipos se parecen entre sí">
        En paradas libres por piloto, de un equipo a otro hay <b>{dec(lMaxE - lMinE)}</b> de diferencia entre el que más y el que menos las usa. De un circuito a otro, <b>{dec(lMaxC - lMinC)}</b>. Por eso el equipo explica casi nada de la estrategia libre: la pista manda.
      </CabeceraTV>

      <div className="tarjeta" ref={refDisp}>
        <div className="tarjeta-cab">
          <h3>Equipos contra circuitos, por tipo de parada</h3>
          <BotonPNG objetivo={refDisp} nombre="equipos-vs-circuitos" />
        </div>
        <div className="dispersion" role="img" aria-label={`Paradas por piloto según rol. Paradas libres: equipos entre ${dec(lMinE)} y ${dec(lMaxE)}, circuitos entre ${dec(lMinC)} y ${dec(lMaxC)}.`}>
          <div className="disp-fila disp-eje" aria-hidden="true">
            <div />
            <div className="disp-pista">
              {ticks.map((t) => (
                <span key={t} style={{ left: `${(t / tope) * 100}%` }}>{dec(t, 1)}</span>
              ))}
            </div>
          </div>
          {ROLES.map((r) => {
            const [cMin, cMax] = rango(circuitos, r.id);
            const [eMin, eMax] = rango(equipos, r.id);
            return (
              <div className="disp-fila" key={r.id}>
                <div className="disp-nombre">
                  <span className="punto" style={{ background: r.color }} />
                  <span>
                    {r.nombre}
                    <small>Equipos {dec(eMin, 1)}–{dec(eMax, 1)} · circuitos {dec(cMin, 1)}–{dec(cMax, 1)}</small>
                  </span>
                </div>
                <div className="disp-pista">
                  <div className="disp-franja" style={{ left: `${(cMin / tope) * 100}%`, width: `${((cMax - cMin) / tope) * 100}%`, background: r.color }}
                    {...props(<><b>Entre circuitos · {r.nombre}</b><div className="tip-fila"><span>Mínimo</span><span>{dec(cMin)}</span></div><div className="tip-fila"><span>Máximo</span><span>{dec(cMax)}</span></div></>)} />
                  {equipos.map((f) => (
                    <span
                      key={f.clave}
                      className={`disp-punto ${foco === f.clave ? "foco" : foco ? "apagado" : ""}`}
                      style={{ left: `${(f[r.id] / tope) * 100}%`, background: colorEquipo(f.clave) }}
                      tabIndex={0}
                      aria-label={`${f.clave}: ${dec(f[r.id])} paradas ${r.nombre.toLowerCase()} por piloto`}
                      onMouseEnter={() => setFoco(f.clave)}
                      onMouseLeave={() => setFoco(null)}
                      onFocus={() => setFoco(f.clave)}
                      onBlur={() => setFoco(null)}
                      {...props(<><b>{f.clave}</b><div className="tip-fila"><span>{r.nombre} por piloto</span><span>{dec(f[r.id])}</span></div><div className="tip-fila"><span>Pilotos-carrera</span><span>{f.n}</span></div></>)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          <p className="disp-leyenda">
            <span><i className="ley-franja" /> Rango entre circuitos (2023–2026)</span>
            <span><i className="ley-punto" /> Cada equipo, desde {desde}. Pasa el mouse para ver el valor.</span>
          </p>
        </div>
        <p className="nota-gr">Eje: paradas por piloto y por carrera. Las paradas libres son las que reflejan decisión del equipo; las obligatorias las fija el reglamento.</p>
      </div>

      <div className="tarjeta" ref={refBarras}>
        <div className="tarjeta-cab">
          <h3>Detalle por equipo</h3>
          <BotonPNG objetivo={refBarras} nombre="paradas-por-equipo" />
        </div>
        <div className="leyenda-gr">
          {ROLES.map((r) => <span key={r.id}><i style={{ background: r.color }} />{r.nombre}</span>)}
        </div>
        <BarrasRoles
          grupos={[...equipos].sort((a, b) => b.total - a.total)}
          maxTotal={maxTotal}
          colorDe={colorEquipo}
        />
      </div>
      <Tip tip={tip} />
    </section>
  );
}
