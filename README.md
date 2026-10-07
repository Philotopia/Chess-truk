# Chess-truk Lab

Laboratoire local pour construire, régler et mesurer un moteur d’échecs **explicable** (« Truk ») face à Stockfish.

- Le moteur Truk choisit ses coups **seul** (règles, génération de coups, évaluation et recherche écrites dans ce dépôt).
- Stockfish (WASM, local) sert uniquement d’adversaire, de référence et d’outil d’analyse a posteriori.
- Aucune API externe : tout tourne dans le navigateur (Web Workers) ou en ligne de commande (Node.js).

## Démarrage

Prérequis : Node.js ≥ 20.

```bash
npm install          # copie aussi Stockfish WASM (paquet npm « stockfish ») dans public/stockfish
npm run dev          # http://localhost:5173
# ou version optimisée :
npm run build && npm run preview   # http://localhost:4173
```

Autres commandes :

| Commande | Rôle |
|---|---|
| `npm test` | Tests automatisés (Vitest) : perft, règles, évaluation, recherche, TT, UCI, statistiques, tournoi contre Stockfish |
| `npm run typecheck` | Vérification TypeScript |
| `npm run perft` | Perft complet, y compris les profondeurs > 5 M de nœuds (≈ 2 min) |
| `npm run bench` | Vitesse : perft, évaluations/s, recherche nœuds/s |
| `npm run match -- …` | Tournoi sans interface, en parallèle (`-j 4`), avec SPRT optionnel (résultats JSON + PGN dans `results/`) |
| `npm run texel-gen -- …` | Génère des positions étiquetées par self-play Truk (aucun Stockfish) |
| `npm run texel-tune -- …` | Réglage Texel des coefficients sous contraintes (écrit une config JSON) |
| `npm run gen-openings` | Régénère la suite figée de 1000 ouvertures équilibrées |
| `npm run arena -- …` | Arène des valeurs de pièces : centaines de parties par valeur testée, optimum estimé par ajustement + bootstrap, rapport dans `reports/` |
| `npm run e2e` | Test de fumée de l’interface dans Chromium (après `npm run build && npm run preview` ; nécessite Playwright et un Chromium) |

Exemples de tournois en ligne de commande :

```bash
npm run match -- --games 20 --nodes 5000                       # Truk 5000 nœuds/coup vs Stockfish 5000 nœuds/coup
npm run match -- --games 20 --truk-time 200 --sf-skill 0 --sf-depth 5
npm run match -- --games 20 --truk-time 200 --sf-elo 1320 --sf-time 100
npm run match -- --ladder 1000,10000,100000 --games 10          # échelle en nœuds
npm run match -- --games 40 --nodes 5000 --b-config autre.json  # Truk A vs Truk B (config exportée depuis l’interface)
npm run match -- --b-config configs/truk-v1.json --truk-time 100 --openings random --games 200 -j 4   # V2 contre V1
npm run match -- --b-set "search.lmr=false" --truk-time 50 --openings random --sprt 0,10 --games 4000 -j 4 --quiet  # test A/B séquentiel
```

Options : `--truk-nodes/--truk-time/--truk-depth`, `--sf-nodes/--sf-time/--sf-depth`, `--sf-skill`, `--sf-elo`, `--a-config`,
`--b-config`, `--a-set/--b-set "chemin=valeur;…"`, `--b-search v1`, `-j N` (parties en parallèle), `--sprt elo0,elo1`, `--max-plies`,
`--openings book|random|startpos`, `--opening-offset`, `--seed`, `--adjudicate`, `--quiet`.

## Interface

Disposition : échiquier à gauche, analyse au centre, réglages du moteur à droite.

| Onglet | Contenu |
|---|---|
| **Jouer** | Mode A (humain vs Truk, les deux couleurs), B (Truk vs Stockfish), C (Stockfish vs Truk), calibration Stockfish vs Stockfish, Truk vs Truk. Échiquier interactif (clic ou glisser, promotion), coordonnées, dernier coup, coups légaux, échec, historique navigable, FEN, PGN (export/import), barre d’évaluation, infos de recherche en direct (profondeur, nœuds, NPS, temps, meilleur coup, PV, occupation TT), graphique d’évaluation, panneau « Pourquoi ? ». |
| **Analyse** | Mode E (analyse d’une FEN, coups libres) et F (comparaison directe : éval Truk / éval SF, meilleurs coups, Δ, « même coup : OUI/NON », flèches). Deux panneaux « Pourquoi ? » : la position, et la position au bout de la PV (son évaluation statique explique le score de recherche). |
| **Comparer une partie** | Analyse de chaque position d’un PGN par les deux moteurs : taux d’accord, Δ moyen, erreur absolue moyenne, perte en centipawns (ACPL) par camp, imprécisions/erreurs/gaffes, graphique. |
| **Tournoi** | Mode D : N parties, alternance des couleurs, ouvertures appariées, contraintes en temps, nœuds ou profondeur, budget identique en nœuds, préréglages Stockfish, adjudication optionnelle. V/N/D, score, Elo ± IC95, LOS, performance estimée (si UCI_Elo), durées, coups et nœuds moyens, PGN. |
| **Échelle** | Série de mini-tournois Truk(X×k nœuds) vs Stockfish(X nœuds), ou contre Stockfish profondeur 1, 2, 3… Conclusion « Truk ≥ 50 % jusqu’à X = … ». |
| **Lab A/B** | Deux configurations Truk, différences listées paramètre par paramètre, match A vs B, significativité (LOS). |
| **Dataset** | Import FEN / EPD (bm, am, id) / PGN (échantillonnage), analyse Truk + SF par position (éval statique, éval de recherche, coups, Δ, temps, nœuds, profondeur), taux de résolution, export CSV/JSON. |
| **Paramètres** | Toutes les valeurs d’évaluation (matériel, tables d’avancement et de pions passés, bonus/malus de structure, mobilité, roi, tours, avant-postes, menaces…), activation de chaque composante, éditeur des 12 PST (MG/EG), options de recherche, sauvegarde nommée, export/import JSON, liste des paramètres préparés pour l’optimisation. |
| **Historique** | Tournois enregistrés (configuration complète, environnement, statistiques, PGN), export/import de toute la base locale en JSON. |
| **Diagnostics** | Perft et banc de vitesse exécutés dans le navigateur, options UCI réellement exposées par Stockfish. |

## Architecture

```
src/
  core/        règles du jeu — indépendantes du moteur
    types.ts        codage pièces / cases 0x88 / coups (entier)
    zobrist.ts      clés de hachage 64 bits (2 × 32 bits), générateur déterministe
    position.ts     plateau 0x88, génération pseudo-légale, make/unmake, coup nul, échec,
                    répétition, matériel insuffisant
    fen.ts          FEN + validation (positions illégales rejetées)
    notation.ts     UCI, SAN (désambiguïsation, +/#), analyse SAN tolérante
    game.ts         partie, statut FIDE (mat, pat, 3 répétitions, 50 coups, matériel insuffisant)
    pgn.ts          export / import PGN (multi-parties, commentaires, variantes, NAG)
    perft.ts        perft + positions de référence
  engine/      moteur Truk
    params.ts       paramètres sérialisables JSON (EngineConfig), valeurs par défaut, diff, chemins optimisables
    evaluate.ts     évaluation explicable (composantes tracées), interpolation MG/EG par phase
    search.ts       negamax alpha-bêta, approfondissement itératif, quiescence, tri, killers, historique,
                    PVS, aspiration, null move, LMR, extension d'échec — chacun activable
    tt.ts           table de transposition (tableaux typés)
    see.ts          SEE (évaluation statique des échanges)
    tuning.ts       réglage Texel : décomposition linéaire de l'évaluation, contraintes, Adam
    engine.ts       façade : configuration + recherche sur (FEN de départ, coups)
  stockfish/   interface Stockfish
    uci.ts          client UCI générique (indépendant du transport)
    browserTransport.ts / nodeTransport.ts   Web Worker (navigateur) / module WASM (Node)
    presets.ts      réglages, préréglages (niveau, Elo, profondeur 1–15, nœuds, temps), limitations WASM
  match/       parties, tournois, benchmark
    runner.ts       déroulement d'une partie et arbitrage, adjudication optionnelle, PGN annoté
    tournament.ts   alternance des couleurs, ouvertures appariées, enregistrement reproductible
    openings.ts     40 ouvertures équilibrées
    stats.ts        V/N/D, score, Elo, IC95, LOS, moyennes par joueur
    sprt.ts         test séquentiel (SPRT) pour les comparaisons A/B
    parallel.ts     tournois en parallèle (processus fils) pour la CLI
    openingSuite.json  1000 ouvertures équilibrées figées (identiques pour toutes les versions)
    compare.ts      comparaison Truk/SF, perte en centipawns, classification des coups
    dataset.ts      import FEN/EPD/PGN, résultats par position, CSV
    players.ts, factoryNode.ts, factoryBrowser.ts   joueurs (Truk en worker ou en ligne, Stockfish)
  storage/db.ts   IndexedDB (tournois, configs, datasets, analyses), export/import JSON
  workers/        engine.worker.ts (recherche Truk), diag.worker.ts (perft/bench), engineClient.ts
  ui/             React : App, vues, composants (échiquier, barre d'éval, graphique, « Pourquoi ? »)
scripts/        perft.ts, bench.ts, match.ts (CLI), texel-gen.ts, texel-tune.ts, gen-openings.ts, copy-stockfish.mjs
configs/        truk-v1.json, truk-v2.json (configurations complètes reproductibles)
tests/          perft, règles (+ comparaison croisée chess.js), évaluation, recherche, match, e2e/
```

Choix techniques :

- **TypeScript + Vite + React** : léger, tout s’exécute localement ; le cœur (`core`, `engine`, `match`) n’a aucune dépendance et tourne aussi sous Node.
- **Représentation 0x88** simple et fiable, make/unmake incrémental, hachage Zobrist incrémental, tampons de coups préalloués (pas d’allocation dans la boucle de recherche). Pas de bitboards tant que les mesures ne montrent pas que la génération de coups est le goulot (aujourd’hui c’est l’évaluation : ~3,4 µs par position).
- **Bibliothèques** : `chess.js` n’est utilisée **que dans les tests** comme référence croisée des règles ; l’échiquier est un composant maison (glyphes Unicode) pour éviter toute dépendance au moteur. Stockfish provient du paquet npm `stockfish` (Stockfish 18 « lite », GPL-3.0).
- La page est servie avec les en-têtes COOP/COEP (cross-origin isolated) pour permettre la variante multi-thread de Stockfish.

## Évaluation explicable

`Eval = Σ composantes`, en centipawns, point de vue des blancs. Chaque composante calcule une valeur milieu de partie (MG) et finale (EG) ; le total est
`(MG × phase + EG × (24 − phase)) / 24`, avec `phase = Σ(C,F = 1 ; T = 2 ; D = 4)` plafonnée à 24.

Composantes : matériel · placement (PST) · mobilité · structure de pions (doublé, isolé, arriéré, connecté) · avancement des pions · pions passés
(par rangée + protégé) · centre · espace · sécurité du roi (bouclier, colonnes ouvertes, pression pondérée non linéaire) · activité du roi en finale
(proximité des rois aux pions passés) · paire de fous · tours (colonnes ouvertes/semi-ouvertes, 7e) · avant-postes · développement · menaces · trait.

Garanties vérifiées par les tests :

- le total est **exactement** la somme des composantes, et chaque composante est exactement la somme de ses contributions élémentaires
  (pièce, case, heuristique) : aucune contribution n’échappe au panneau « Pourquoi ? » ;
- `eval(position miroir couleurs inversées) = −eval(position)` sur ~300 positions ;
- désactiver une composante la met à zéro.

Prévention des doubles comptages : la PST des pions vaut 0 par défaut (avancement et centre ont leurs propres composantes), la PST des tours ne
contient pas de bonus de 7e (compté dans « Tours »), un pion doublé arrière n’est pas compté comme passé. Les recouvrements restants (ex. PST du
cavalier ↔ mobilité ↔ centre ; développement ↔ PST) sont **nommés** dans l’interface (`EVAL_TERM_NOTES`).

## Recherche

Negamax alpha-bêta, approfondissement itératif, table de transposition (scores de mat corrigés par le ply), tri des coups (coup TT, MVV-LVA,
promotions, killers, historique), quiescence (captures et promotions ; toutes les parades en échec, donc mats détectés), élagage par distance au
mat, nulles (répétition dès la 2e occurrence dans l’arbre, 50 coups, matériel insuffisant). Options activables séparément : TT, quiescence,
MVV-LVA, killers, historique, PVS, fenêtres d’aspiration, null move, LMR, extension d’échec, et (V2) LMR logarithmique ajustée par
l’historique, null move adaptatif, reverse futility pruning, futility pruning, late move pruning, razoring, SEE (tri et élagage des captures
perdantes, delta pruning), TT en quiescence, internal iterative reduction, contre-coup, extensions singulières (désactivées par défaut :
neutres en SPRT). Un cache d’évaluation évite de réévaluer les positions revues. `configs/truk-v1.json` reproduit la configuration V1.

Limites : profondeur, nœuds, temps (la première atteinte arrête ; la profondeur 1 est toujours terminée ; en cas d’arrêt en cours d’itération,
seul un coup racine entièrement évalué au-dessus d’alpha peut remplacer celui de l’itération précédente). Avec une limite en nœuds ou en
profondeur, la recherche est **déterministe** (test automatique).

## Reproductibilité

Chaque tournoi enregistre : configuration complète des deux joueurs (paramètres d’évaluation, options de recherche, réglages et limites
Stockfish), nombre de parties, ouvertures, adjudication, date de début/fin, version de l’application et de Stockfish, navigateur, toutes les
parties (coups, score, profondeur, nœuds, temps par coup, PGN annoté) et les statistiques. Export/import JSON (onglet Historique) ; la CLI écrit
`results/<id>.json` et `results/<id>.pgn`.

Avec des moteurs déterministes (limites en nœuds/profondeur, sans Skill Level ni UCI_Elo), au-delà de 80 parties le livre de 40 ouvertures se
répète et produit des parties identiques : l’interface l’indique.

## Tests

`npm test` exécute 8 fichiers / 93 tests (≈ 2 min) :

- **perft** : 6 positions de référence (initiale, Kiwipete, positions 3–6 et miroir), jusqu’à 4,9 M de nœuds, avec vérification que
  make/unmake restaure le hachage ; `npm run perft` va jusqu’à 194 M de nœuds ;
- **règles** : comparaison croisée avec chess.js sur 30 parties aléatoires (coups légaux, SAN, échec, mat, pat, matériel insuffisant, FEN),
  roques (cases attaquées, échec), en passant (y compris clouage horizontal), promotions, mat, pat, triple répétition, 50 coups (le mat prime),
  matériel insuffisant, FEN invalides/illégales rejetées, PGN aller-retour et multi-parties ;
- **évaluation** : symétrie, somme exacte des composantes, stabilité/déterminisme, désactivation, cas de pions (passé, doublé, isolé,
  arriéré, connecté), interpolation des PST ;
- **recherche** : alpha-bêta (+ killers, historique, PVS, aspiration) = minimax exact ; mats en 1 et 2 trouvés avec 8 combinaisons d’options ;
  scores de mat/pat ; évitement du pat ; gain de matériel ; nulle par répétition choisie par le camp perdant ; limites de nœuds/temps ;
  déterminisme ; PV légale ; TT (sonde, collisions, remplacement, réduction du nombre de nœuds) ;
- **SEE** : pièce non défendue, échanges, rayons X, roi ne reprenant pas sur une case défendue, promotion ;
- **réglage Texel** : la décomposition linéaire reproduit l’évaluation ; la règle des pions est verrouillée (avancement et PST pions non
  réglables, pions passés ≥ 0 et croissants) ;
- **conversion** : roi + dame / roi + tour contre roi seul sont matés ;
- **arène** : Elo ± écart-type, ajustement parabolique exact, intervalle bootstrap, courbe monotone détectée ;
- **match** : livre d’ouvertures légal, statistiques/Elo/IC, analyse des lignes UCI, perte en centipawns, import FEN/EPD/PGN, partie complète
  Truk vs Truk et mini-tournoi **contre Stockfish WASM réel**.

## Truk V2 : ce qui a été fait et mesuré

Règle imposée : **les pions les plus avancés valent beaucoup plus, en proportion de leur avancement.** La table d’avancement
(0, 5, 12, 25, 50, 100 de la 2e à la 7e rangée) n’est jamais modifiée par le réglage automatique ; la PST des pions (qui pourrait la compenser)
est figée ; les bonus de pion passé sont contraints ≥ 0 et croissants avec la rangée. Valeur effective d’un pion passé en finale (pion + avancement
+ bonus passé) : V1 110 / 115 / 127 / 150 / 190 / 260 → V2 126 / 131 / 153 / 192 / 238 / 288 cp (rangées 2 à 7).

Méthode : chaque changement est mesuré contre la version précédente par SPRT (H0 : 0 Elo, H1 : +10 Elo, α = β = 5 %), parties à 50 ms/coup en
parallèle sur 4 cœurs, ouvertures tirées d’une suite figée de 1000 positions équilibrées (`src/match/openingSuite.json`), couleurs inversées.

| Étape | Parties | Résultat | Décision |
|---|---|---|---|
| Recherche V2 (SEE, RFP, futility, LMP, razoring, LMR log, null move adaptatif, IIR, contre-coup, TT en quiescence) vs recherche V1 | 144 | +93 =24 −27, **+172 Elo [+119 ; +234]** | adoptée |
| Composante « finale gagnante » (roi adverse au bord) | 500 | 48,3 %, non significatif | gardée (corrige la non-conversion de R+D contre R observée ; testée unitairement) |
| Réglage Texel n° 1 *sans contraintes sur les tables pièce-case* | 150 | **−167 Elo** (surapprentissage : roi en a8 = +200…) | rejeté |
| Réglage Texel n° 1 : ~60 coefficients scalaires, contraintes de signe, positions calmes (quiescence) | 799 | **+42 Elo [+20 ; +65]** | adopté |
| Extensions singulières | 551 | 50,9 %, neutre | désactivées par défaut |
| Réglage Texel n° 2 (590 000 positions issues du moteur amélioré) | 789 | **+38 Elo [+17 ; +58]** | adopté |

Les données du réglage Texel proviennent **uniquement de parties Truk contre Truk** (résultat final de la partie comme étiquette) :
Stockfish n’intervient pas dans le choix des coups ni dans le réglage.

Mesures finales (100 ms/coup, mêmes 60 ouvertures pour chaque ligne ; V1 = code figé du commit 7189025) :

| Adversaire | V1 | V2 |
|---|---|---|
| Stockfish profondeur 6 | 35,8 % (−101 Elo) | **48,3 %** (−12 Elo, IC95 [−83 ; +59]) |
| Stockfish profondeur 8 | 6,7 % (−458 Elo) | **12,5 %** (−338 Elo) |
| Stockfish profondeur 10 | — | 1,7 % |
| Truk V2 contre configuration V1 (200 parties) | — | **86,3 %, +319 Elo [+267 ; +386]** |
| Stockfish pleine force, 200 ms/coup (30 parties) | 0/30 | 0/30 |

Lecture : environ +100 Elo contre l’étalon externe Stockfish à profondeur fixe (l’écart en self-play, +319, est comme toujours plus flatteur).
Contre Stockfish à pleine force, l’écart reste hors de portée de ces techniques.

## Arène des valeurs de pièces

`npm run arena` fait jouer, pour chaque pièce, 4 variantes de valeur (référence ± décalages) contre la configuration de référence,
300 parties par variante (4800 parties au total + 600 de vérification), avec la règle des pions active partout (pion = 100, avancement
inchangé). Elo(valeur) est ajusté par une parabole ; le sommet et son intervalle de confiance (bootstrap) estiment la valeur optimale.
Un test nul (variantes sans effet, dans les deux sièges) vérifie l'absence de biais du dispositif.

Résultat (rapport complet : `reports/arena-muypj4bn77x8pc.md`, données : `.json`) : cavalier 321 [304 – 339], fou 358 [337 – 390],
tour 518 [494 – 542], dame 1011 [965 – 1094]. Les valeurs V2 (317 / 343 / 521 / 946) sont toutes dans ces intervalles et la combinaison
des optimums n'apporte rien (−6 ± 24 Elo) : les valeurs actuelles sont conservées, désormais confirmées par l'arène.

## Premières mesures (V1, CLI, Stockfish 18 lite WASM, 1 thread)

Mesures réelles effectuées avec `npm run match` sur la machine de développement (ouvertures du livre, couleurs alternées, sans adjudication).
Échantillons petits : lire les intervalles de confiance.

| Expérience | Parties | Résultat Truk | Elo Truk − adv. (IC95) |
|---|---|---|---|
| Truk (toutes optimisations) vs Truk « baseline » (alpha-bêta + TT + quiescence + MVV-LVA seulement), 5 000 nœuds/coup | 40 | +23 =11 −6 (71,3 %) | +158 [+69 ; +272], LOS 99,9 % |
| Truk 200 ms/coup vs SF Skill Level 0, profondeur 5 | 20 | +20 =0 −0 | > +287 |
| Truk 200 ms/coup vs SF UCI_Elo 1320, 100 ms/coup | 20 | +20 =0 −0 | > +287 |
| Truk 1 000 nœuds vs SF 1 000 nœuds | 10 | +0 =0 −10 | < −166 |
| Truk 10 000 nœuds vs SF 10 000 nœuds | 10 | +0 =0 −10 | < −166 |
| Truk 100 000 nœuds vs SF 100 000 nœuds | 10 | +0 =0 −10 | < −166 |

Conclusion provisoire : Truk bat nettement les niveaux affaiblis de Stockfish (Skill 0, UCI_Elo 1320) mais perd systématiquement à budget de
nœuds égal (de 1 000 à 100 000 nœuds/coup) ; Stockfish atteint une profondeur nominale bien supérieure pour le même nombre de nœuds. Les
optimisations de recherche apportent un gain mesurable (+158 Elo à 5 000 nœuds).

Vitesse (Node 22, 1 cœur) : perft ≈ 6 M nœuds/s ; évaluation ≈ 3,4 µs (≈ 290 000 évals/s) ; recherche ≈ 150 000 à 260 000 nœuds/s.

## Limitations actuelles

- Force : le moteur est encore faible face à Stockfish, même à budget de nœuds égal (voir résultats ci-dessous) : évaluation manuelle simple,
  ~150 000 nœuds/s en JavaScript.
- Les nœuds Truk et Stockfish ne sont pas strictement comparables (Stockfish élague beaucoup plus et utilise un réseau NNUE).
- Stockfish WASM « lite » : réseau réduit, plus lent que le natif ; Skill Level / UCI_Elo ne sont pas reproductibles ; UCI_Elo ≥ 1320.
- Arrêt d’une recherche Truk en cours : réalisé en recréant le worker (la recherche est synchrone) ; la dernière itération terminée est conservée.
- Tournois de l’interface exécutés séquentiellement (la CLI joue en parallèle avec `-j`).
- Pas de livre d’ouvertures pour Truk en partie libre, pas de gestion de pendule (temps par coup uniquement), pas de pondération.
- L’adjudication est désactivée par défaut (les parties vont jusqu’au bout ou à la limite de demi-coups, comptée nulle).

## Prochaines améliorations (meilleur rapport gain de force / complexité)

1. **Plus de données de réglage** (self-play plus long et plus profond) et réglage des tables pièce-case avec régularisation : avec
   590 000 positions, les PST n’apportaient rien de mesurable.
2. **Vitesse** : l’évaluation représente ~50 % du temps ; évaluation incrémentale (matériel + PST), listes de pièces, table de hachage des pions.
3. **Réglage des constantes de recherche** (marges de futility/RFP, table LMR) par SPRT ou SPSA.
4. **Historique de continuation** et capture history pour le tri des coups.
5. **Connaissances de finale** : facteurs de nulle (fous de couleurs opposées, absence de pions), finales de pions.
6. Extensions singulières à retester à cadence plus longue (neutres à 50 ms/coup).
