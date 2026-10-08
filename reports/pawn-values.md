# Valeur des pions selon leur case — 2026-10-07

Question : quelle valeur donner à un pion selon sa **rangée** (vertical, avancement) et sa **colonne** (horizontal) ?
Règle du projet : à colonne égale, un pion plus avancé ne vaut jamais moins (croissance avec l’avancement). Pion en a2 = 100.
Deux méthodes indépendantes, toutes deux sans Stockfish : estimation statistique sur des parties Truk contre Truk, puis arène de parties.

## 1. Estimation statistique (méthode Texel)

586 988 positions calmes issues de parties Truk contre Truk ; le reste de l’évaluation est figé, seule la contribution « position des pions » est réestimée pour prédire le résultat des parties. Erreur de validation (10 % des données mises de côté) : table actuelle 0.102765.

### rangée + colonne (libre) — erreur de validation 0.102633

| Rangée | a/h | b/g | c/f | d/e |
|---|---|---|---|---|
| 7 | +103 | +99 | +96 | +99 |
| 6 | +49 | +46 | +42 | +46 |
| 5 | +8 | +5 | +1 | +5 |
| 4 | +11 | +8 | +4 | +8 |
| 3 | +10 | +7 | +3 | +7 |
| 2 | +0 | -4 | -7 | -4 |

### rangée + colonne (monotone : règle des pions) — erreur de validation 0.102662

| Rangée | a/h | b/g | c/f | d/e |
|---|---|---|---|---|
| 7 | +104 | +100 | +96 | +99 |
| 6 | +50 | +46 | +42 | +45 |
| 5 | +12 | +8 | +4 | +8 |
| 4 | +12 | +8 | +4 | +7 |
| 3 | +11 | +7 | +3 | +6 |
| 2 | +0 | -4 | -8 | -4 |

### case par case (libre) — erreur de validation 0.103104

| Rangée | a/h | b/g | c/f | d/e |
|---|---|---|---|---|
| 7 | +140 | +35 | +97 | +114 |
| 6 | +54 | +58 | +32 | +37 |
| 5 | +10 | +18 | +0 | -0 |
| 4 | +8 | +3 | +10 | +10 |
| 3 | +11 | +4 | +4 | +11 |
| 2 | +0 | +2 | -9 | -11 |

### case par case (monotone : règle des pions) — erreur de validation 0.103268

| Rangée | a/h | b/g | c/f | d/e |
|---|---|---|---|---|
| 7 | +144 | +65 | +101 | +120 |
| 6 | +56 | +63 | +35 | +39 |
| 5 | +13 | +22 | +14 | +17 |
| 4 | +13 | +8 | +14 | +17 |
| 3 | +13 | +8 | +9 | +17 |
| 2 | +0 | +6 | -3 | -4 |

## 2. Arène (parties)

Un paramètre à la fois, 300 parties par valeur testée contre la référence, 4000 nœuds par coup, ouvertures figées, couleurs inversées. Valeurs en centipawns ajoutées à la valeur de base du pion (100).

| Paramètre | Référence | Valeurs testées (Elo vs référence) | Optimum estimé | IC95 | Retenu |
|---|---|---|---|---|---|
| Rangée 3 | 5 | 0 (+0 ± 34), 2 (+8 ± 34), 9 (+16 ± 33), 12 (-30 ± 34) | 3 | -9 – 19 | 3 |
| Rangée 4 | 12 | 5 (-1 ± 34), 8 (+3 ± 34), 18 (-9 ± 34), 25 (-19 ± 33) | 8 | -14 – 30 | 8 |
| Rangée 5 | 25 | 12 (+2 ± 34), 18 (-23 ± 34), 35 (+22 ± 34), 50 (-51 ± 34) | 26 | -25 – 33 | 26 |
| Rangée 6 | 50 | 25 (-27 ± 33), 35 (+0 ± 33), 70 (+3 ± 33), 100 (-12 ± 34) | 67 | -50 – 150 | 67 |
| Rangée 7 | 100 | 50 (-28 ± 33), 75 (-16 ± 34), 140 (+12 ± 34), 200 (+13 ± 35) | 171 | 120 – 300 | 171 |
| Colonnes a/h | 0 | -30 (-7 ± 34), -15 (+14 ± 33), 15 (-22 ± 34), 30 (-19 ± 35) | -14 | -60 – 55 | -14 |
| Colonnes b/g | 0 | -30 (-31 ± 35), -15 (-14 ± 33), 15 (-1 ± 33), 30 (-14 ± 35) | 6 | -11 – 60 | 6 |
| Colonnes c/f | 0 | -30 (-2 ± 34), -15 (+2 ± 34), 15 (+12 ± 35), 30 (-23 ± 35) | -9 | -60 – 60 | -9 |
| Colonnes d/e | 0 | -30 (+12 ± 35), -15 (-36 ± 34), 15 (+3 ± 34), 30 (-7 ± 34) | 7 | -60 – 60 | 7 |

## 3. Vérification des candidats contre la table actuelle

| Candidat | Avancement (rangées 2→7) | Colonnes a→h | Résultat | Elo (IC95) |
|---|---|---|---|---|
| arène | 0, 3, 8, 26, 67, 171 | -14, 6, -9, 7, 7, -9, 6, -14 | +370 =243 -387 (1000) | **-6 ± 19** |
| statistique (Texel) | 0, 11, 12, 12, 50, 104 | 0, -4, -8, -4, -4, -8, -4, 0 | +379 =234 -387 (1000) | **-3 ± 19** |
| 7e rangée seule à 170 (test ciblé) | 0, 5, 12, 25, 50, 170 | 0 × 8 | +356 =258 -386 (1000) | **-10 ± 19** |

## 4. Conclusion

**Vertical (rangée).** Les deux méthodes s'accordent sur la forme générale de la règle : un pion vaut un peu plus dès la 3e rangée,
reste à peu près au même niveau jusqu'à la 5e, puis sa valeur explose en 6e et en 7e. La table actuelle
(0, 5, 12, 25, 50, 100) se situe dans les intervalles de confiance pour chaque rangée, et aucune table alternative ne fait mieux en
parties (−3, −6 et −10 Elo, ± 19). Les erreurs coûteuses sont nettes : une 7e rangée à 50 au lieu de 100 coûte ≈ 28 Elo, une
5e rangée à 50 (trop tôt trop chère) ≈ 51 Elo, une 6e rangée à 25 ≈ 27 Elo. Les 3e et 4e rangées sont peu sensibles (± 10 cp sans effet).

**Horizontal (colonne).** Aucun effet mesurable : ni la statistique (écarts de 4 à 8 cp, dans le bruit) ni l'arène (tous les points
compatibles avec 0) ne justifient de valoriser un pion selon sa colonne. Ce que la colonne pourrait apporter est déjà capté par
d'autres composantes nommées : contrôle du centre (pions sur d4/e4/d5/e5), pions isolés, doublés, connectés et passés.

**Décision.** La table d'avancement actuelle est conservée ; le bonus de colonne reste à 0 (le paramètre existe désormais, éditable
dans l'onglet Paramètres, pour de futures expériences). Valeur totale d'un pion non passé : 100 (2e) · 105 (3e) · 112 (4e) · 125 (5e) ·
150 (6e) · 200 (7e), plus le bonus de pion passé et les autres composantes.

**Limites.** 4000 nœuds par coup ; un paramètre à la fois (300 parties par valeur, ± 34 Elo par point) ; les effets inférieurs à
≈ 15–20 Elo ne sont pas détectables avec ce volume.
