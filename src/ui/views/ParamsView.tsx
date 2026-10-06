import { useRef, useState } from 'react';
import { TUNABLE_PARAMS, defaultEngineConfig, diffConfigs, getByPath, normalizeConfig } from '../../engine/params';
import { downloadText } from '../../storage/db';
import { ParamsEditor } from '../components/ParamsEditor';
import { SearchOptionsEditor } from '../components/Settings';
import { useLab } from '../state';
import { useSavedConfigs } from '../useSavedConfigs';

/** Onglet Paramètres : édition complète, sauvegarde nommée, export/import JSON. */
export function ParamsView() {
  const lab = useLab();
  const saved = useSavedConfigs();
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const c = lab.config;
  const diff = diffConfigs(defaultEngineConfig(c.name), c).filter((d) => d.path !== 'name');

  return (
    <div className="params-view">
      <div className="panel">
        <div className="row">
          <label className="field grow">
            <span>Nom de la configuration</span>
            <input value={c.name} onChange={(e) => lab.setConfig({ ...c, name: e.target.value })} />
          </label>
          <button className="btn primary" onClick={() => saved.save(c).then(() => setMsg(`« ${c.name} » enregistrée.`))}>
            Enregistrer
          </button>
          <button className="btn" onClick={() => downloadText(`${c.name.replace(/\s+/g, '_')}.json`, JSON.stringify(c, null, 2))}>
            Exporter JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importer JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                lab.setConfig(normalizeConfig(JSON.parse(await f.text())));
                setMsg(`Configuration importée depuis ${f.name}.`);
              } catch (err) {
                setMsg(`Import impossible : ${(err as Error).message}`);
              }
              e.target.value = '';
            }}
          />
          <button className="btn" onClick={() => confirm('Revenir aux valeurs par défaut ?') && lab.setConfig(defaultEngineConfig(c.name))}>
            Réinitialiser
          </button>
        </div>
        {msg && <div className="muted small">{msg}</div>}
        <div className="row wrap">
          <span className="muted small">Configurations enregistrées :</span>
          {saved.items.length === 0 && <span className="muted small">aucune</span>}
          {saved.items.map((s) => (
            <span key={s.id} className="chip">
              <button className="link" onClick={() => lab.setConfig(s.config)}>
                {s.name}
              </button>
              <button className="link" title="Supprimer" onClick={() => confirm(`Supprimer « ${s.name} » ?`) && saved.remove(s.id)}>
                ✕
              </button>
            </span>
          ))}
        </div>
        <details>
          <summary>Différences avec la configuration par défaut ({diff.length})</summary>
          <table className="table small">
            <tbody>
              {diff.map((d) => (
                <tr key={d.path}>
                  <td className="mono">{d.path}</td>
                  <td className="num">{String(d.a)}</td>
                  <td className="num">→ {String(d.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <details>
          <summary>Paramètres préparés pour l’optimisation automatique ({TUNABLE_PARAMS.length})</summary>
          <table className="table small">
            <thead>
              <tr>
                <th>Paramètre</th>
                <th>Chemin JSON</th>
                <th className="num">Valeur</th>
                <th className="num">Plage</th>
              </tr>
            </thead>
            <tbody>
              {TUNABLE_PARAMS.map((p) => (
                <tr key={p.path}>
                  <td>{p.label}</td>
                  <td className="mono">{p.path}</td>
                  <td className="num">{String(getByPath(c, p.path))}</td>
                  <td className="num">
                    {p.min} … {p.max} (pas {p.step})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
      <div className="panel">
        <h3>Recherche</h3>
        <SearchOptionsEditor opts={c.search} onChange={(search) => lab.setConfig({ ...c, search })} />
      </div>
      <ParamsEditor config={c} onChange={lab.setConfig} />
    </div>
  );
}
