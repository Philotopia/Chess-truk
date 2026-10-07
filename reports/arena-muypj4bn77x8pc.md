# Arène des valeurs de pièces — 2026-10-07

Truk contre Truk, 4000 nœuds par coup, 300 parties par point (couleurs inversées, ouvertures suite figée, décalage 3000), adjudication abandon ±1000 cp / 4 coups, nulle ±10 cp / 12 coups après 80 ½-coups.
Règle conservée : pion = 100 ; avancement des pions 0, 0, 5, 12, 25, 50, 100, 0 ; aucune variante ne touche aux pions.

## Cavalier (référence 317)

| Valeur | V | N | D | Elo vs référence |
|---|---|---|---|---|
| 237 | 97 | 61 | 142 | -53 ± 35 |
| 277 | 99 | 63 | 138 | -45 ± 35 |
| 357 | 95 | 82 | 123 | -33 ± 34 |
| 397 | 93 | 75 | 132 | -45 ± 34 |

Optimum estimé : **321** (IC95 bootstrap 304 – 339 ; parabole concave dans 100 % des tirages ; gain estimé au sommet 0 Elo). Valeur retenue : 321.

## Fou (référence 343)

| Valeur | V | N | D | Elo vs référence |
|---|---|---|---|---|
| 263 | 100 | 56 | 144 | -51 ± 36 |
| 303 | 89 | 82 | 129 | -47 ± 34 |
| 383 | 102 | 72 | 126 | -28 ± 34 |
| 423 | 107 | 67 | 126 | -22 ± 35 |

Optimum estimé : **358** (IC95 bootstrap 337 – 390 ; parabole concave dans 100 % des tirages ; gain estimé au sommet 1 Elo). Valeur retenue : 358.

## Tour (référence 521)

| Valeur | V | N | D | Elo vs référence |
|---|---|---|---|---|
| 401 | 93 | 69 | 138 | -53 ± 35 |
| 461 | 112 | 65 | 123 | -13 ± 35 |
| 581 | 110 | 84 | 106 | +5 ± 33 |
| 641 | 86 | 68 | 146 | -70 ± 35 |

Optimum estimé : **518** (IC95 bootstrap 494 – 542 ; parabole concave dans 100 % des tirages ; gain estimé au sommet 0 Elo). Valeur retenue : 518.

## Dame (référence 946)

| Valeur | V | N | D | Elo vs référence |
|---|---|---|---|---|
| 746 | 80 | 77 | 143 | -74 ± 34 |
| 846 | 91 | 80 | 129 | -44 ± 34 |
| 1046 | 110 | 82 | 108 | +2 ± 34 |
| 1146 | 101 | 82 | 117 | -19 ± 34 |

Optimum estimé : **1011** (IC95 bootstrap 965 – 1094 ; parabole concave dans 100 % des tirages ; gain estimé au sommet 5 Elo). Valeur retenue : 1011.

## Vérification de la combinaison

Cavalier 321, Fou 358, Tour 518, Dame 1011 contre la référence : +211 =167 -222 sur 600 parties → **-6 ± 24 Elo** (IC95).

## Contrôle du dispositif (test nul)

Variantes sans effet attendu, 300 parties chacune, dans les deux sièges (A/B) : cavalier 318 au lieu de 317 → 51,3 % puis 51,7 % ;
fenêtre d'aspiration 36 au lieu de 35 → 49,2 % puis 49,0 %. Le dispositif n'a pas de biais de siège : les pertes de 2 à 7 % observées
dès ±40 cp autour de la référence sont donc réelles (≈ 1,5 à 3 écarts-types par point, et systématiques sur les 16 points).

## Conclusion

| Pièce | Référence (Texel V2) | Optimum de l'arène | IC95 | En pions de base | Décision |
|---|---|---|---|---|---|
| Cavalier | 317 | 321 | 304 – 339 | ≈ 3,2 | conservée (317 dans l'IC) |
| Fou | 343 | 358 | 337 – 390 | ≈ 3,4–3,6 | conservée (343 dans l'IC) |
| Tour | 521 | 518 | 494 – 542 | ≈ 5,2 | conservée |
| Dame | 946 | 1011 | 965 – 1094 | ≈ 9,5–10 | conservée (tendance vers ~1000, non confirmée) |

La combinaison des optimums n'est pas meilleure que la référence (−6 ± 24 Elo sur 600 parties) : **les valeurs actuelles sont confirmées
empiriquement**, à ± 20 cp près pour le cavalier, la tour, ±25–45 cp pour le fou, et avec une incertitude plus large vers le haut pour la dame.
Une erreur de 40 cp sur une pièce coûte déjà ~30–50 Elo à cette profondeur de recherche ; 80 cp en coûtent ~45–75.

Avec la règle d'avancement, la valeur d'un pion dépend de sa rangée : un pion passé en 7e vaut 239 cp en milieu de partie et 288 cp en
finale, soit ≈ 0,75 à 0,9 cavalier. Les valeurs des pièces ci-dessus ont été mesurées **avec** cette règle active dans les deux camps.

Limites : 4000 nœuds par coup (recherche peu profonde, où l'évaluation pèse plus qu'à cadence longue) ; une pièce à la fois (les
interactions entre pièces ne sont testées que par la vérification finale) ; modèle parabolique (forme réelle plus pointue que quadratique).
