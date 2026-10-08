# Arène contre Stockfish — 2026-10-08

Truk (4000 nœuds par coup) contre Stockfish 18 lite WASM à profondeur 5 (déterministe). Stockfish n'est qu'un adversaire étalon : Truk choisit seul ses coups.
400 parties par variante, 800 pour la référence, mêmes ouvertures pour tous, couleurs inversées. Règle des pions conservée (pion = 100, avancement croissant).

**Référence** (valeurs actuelles) : 35.3 % contre Stockfish, soit -106 ± 22 Elo (800 parties).

| Paramètre | Actuel | Valeurs testées : Elo contre Stockfish (score) | Optimum | IC95 | Écart vs référence au sommet |
|---|---|---|---|---|---|
| Cavalier | 317 | 237 : -143 (30.5 %) · 277 : -90 (37.4 %) · 357 : -97 (36.4 %) · 397 : -124 (32.9 %) | 324 | 292 – 395 | +9 |
| Fou | 343 | 263 : -140 (30.9 %) · 303 : -126 (32.6 %) · 383 : -131 (32.0 %) · 423 : -95 (36.6 %) | 457 | 335 – 503 | +4 |
| Tour | 521 | 401 : -142 (30.6 %) · 461 : -109 (34.8 %) · 581 : -100 (36.0 %) · 641 : -131 (32.0 %) | 532 | 488 – 630 | +4 |
| Dame | 946 | 746 : -112 (34.4 %) · 846 : -117 (33.8 %) · 1046 : -119 (33.5 %) · 1146 : -117 (33.8 %) | 907 | 546 – 1346 | -4 |
| Pion en 5e rangée | 25 | 12 : -95 (36.6 %) · 18 : -82 (38.4 %) · 35 : -99 (36.1 %) · 50 : -116 (33.9 %) | -64 | -25 – 45 | +33 |
| Pion en 6e rangée | 50 | 25 : -111 (34.5 %) · 35 : -112 (34.4 %) · 70 : -120 (33.4 %) · 100 : -125 (32.8 %) | 41 | -50 – 150 | -4 |
| Pion en 7e rangée | 100 | 50 : -105 (35.4 %) · 75 : -109 (34.8 %) · 140 : -80 (38.6 %) · 200 : -112 (34.4 %) | 131 | -100 – 300 | +10 |

## Vérification (mêmes ouvertures)

| Configuration | Valeurs (C, F, T, D) | Avancement (rangées 2→7) | Résultat contre Stockfish | Elo vs SF |
|---|---|---|---|---|
| Référence | 317, 343, 521, 946 | 0, 5, 12, 25, 50, 100 | +241 =244 -515 (36.3 %) | -98 ± 19 |
| Optimums de l’arène | 324, 423, 532, 907 | 0, 5, 12, 12, 41, 131 | +219 =235 -546 (33.6 %) | -118 ± 20 |

**Écart optimums − référence contre Stockfish : -20 ± 27 Elo.**
Test ciblé complémentaire, mêmes 1000 ouvertures : pion en 5e rangée à 12 au lieu de 25 (indice commun à l'estimation statistique et à cette arène)
→ +237 =262 −501 (36,8 %), −94 Elo contre Stockfish, contre −98 pour la référence : **+4 ± 27 Elo, aucune différence**.

## Conclusion

- **Contre Stockfish aussi, les valeurs actuelles sont les meilleures mesurées.** Aucune variante ni combinaison ne fait mieux de façon
  significative : combinaison des optimums −20 ± 27 Elo, 5e rangée à 12 : +4 ± 27 Elo.
- **Ce qui concorde avec l'arène en self-play** : cavalier ≈ 320 (optimum 324), tour ≈ 520–530 (optimum 532) ; les erreurs
  importantes coûtent cher (cavalier à 237 ou tour à 401 : ≈ −40 Elo contre Stockfish).
- **Ce qui est peu sensible contre Stockfish** : la dame (746 à 1146 : tous entre −112 et −119 Elo), la 6e rangée (25 à 100 : −111 à −125)
  et la 7e rangée (50 à 200 : −80 à −112, sans tendance nette). Contre un adversaire plus fort, l'issue des parties dépend davantage de la
  tactique et de la profondeur que de ces réglages fins d'évaluation.
- **Le fou** est la mesure la plus bruitée (points en dents de scie) : l'optimum extrapolé (457) n'est pas fiable, et le fou à 423 inclus dans la
  combinaison n'a pas amélioré le résultat.
- **Règle des pions** : la croissance de la valeur avec l'avancement est conservée ; contre Stockfish, aucune pente différente (plus raide en 7e
  ou plus plate en 5e) n'a apporté de gain mesurable.

Limites : Truk à 4000 nœuds par coup contre Stockfish à profondeur 5 (Truk ≈ 36 %) ; 400 parties par variante (± 35 Elo par point), donc
seuls les effets de plus de ~25 Elo sont détectables ; un paramètre à la fois.
